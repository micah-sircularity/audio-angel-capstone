import type {
  Capabilities,
  LyricSpan,
  PlannedAction,
  Profile,
} from "@audio-angel/contracts";

// Deliberately limited vocabulary for the first live line-skipping test.
// It is not a comprehensive content classifier.
const categories: Record<string, readonly string[]> = {
  profanity: ["damn", "hell", "fuck", "fuckin", "fucking", "fucked", "shit", "shitty", "bitch", "bitches", "bastard", "asshole"],
  slurs: [],
  sexual: [],
  drugs: ["cocaine"],
  violence: [],
  blasphemy: [],
};
const normalize = (text: string) =>
  text.normalize("NFKC").toLocaleLowerCase("en").replace(/[’']/g, "");
export function matchesTerm(text: string, term: string): boolean {
  const tokens = normalize(text).match(/[\p{L}\p{N}]+/gu) ?? [];
  const terms = normalize(term).match(/[\p{L}\p{N}]+/gu) ?? [];
  if (!terms.length) return false;
  return tokens.some((_, i) =>
    terms.every((word, j) => {
      const actual = tokens[i + j];
      return (
        actual === word ||
        (j === terms.length - 1 &&
          (actual === word + "s" || actual === word + "es"))
      );
    }),
  );
}
export function buildPlan(
  profile: Profile,
  spans: readonly LyricSpan[],
  capabilities: Capabilities,
  durationMs: number,
): PlannedAction[] {
  const raw: PlannedAction[] = [];
  for (const rule of profile.rules) {
    if (!rule.enabled || rule.kind === "topic") continue; // Topics require a future authorized provider.
    const terms =
      rule.kind === "term" ? [rule.value] : (categories[rule.value] ?? []);
    for (const span of spans) {
      if (!terms.some((term) => matchesTerm(span.text, term))) continue;
      const action =
        rule.action === "mute" && !capabilities.canMute
          ? "skip-section"
          : rule.action;
      // If a requested action is unavailable, stop the track rather than silently play it.
      const resolved =
        action === "skip-section" && !capabilities.canSeek
          ? "skip-song"
          : action;
      raw.push({
        startMs: resolved === "skip-song" ? 0 : Math.max(0, span.startMs - 200),
        endMs:
          resolved === "skip-song"
            ? durationMs
            : Math.min(durationMs, span.endMs + 200),
        action: resolved,
        reasons: [rule.label],
      });
    }
  }
  if (raw.some((a) => a.action === "skip-song"))
    return [
      {
        startMs: 0,
        endMs: durationMs,
        action: "skip-song",
        reasons: [...new Set(raw.flatMap((a) => a.reasons))],
      },
    ];
  const merged: PlannedAction[] = [];
  for (const item of raw.sort((a, b) => a.startMs - b.startMs)) {
    const last = merged.at(-1);
    if (last && item.startMs - last.endMs <= 1500)
      merged[merged.length - 1] = {
        startMs: last.startMs,
        endMs: Math.max(last.endMs, item.endMs),
        action:
          last.action === "skip-section" || item.action === "skip-section"
            ? "skip-section"
            : "mute",
        reasons: [...new Set([...last.reasons, ...item.reasons])],
      };
    else merged.push(item);
  }
  return merged;
}
export { parseLrc, toLyricSpans } from "./lrc";
export type { LrcLine } from "./lrc";
export { parseSrt, parseVtt, parsePodcastJson } from "./subtitles";

export function unsupportedRules(profile: Profile): string[] {
  return profile.rules.filter(rule => rule.enabled && (rule.kind === "topic" || (rule.kind === "category" && !(categories[rule.value]?.length)))).map(rule=>rule.label);
}

/** Estimated word positions within a lyric line; never claimed as provider word timing. */
export function estimateWords(line: LyricSpan): LyricSpan[] {
  const tokens=Array.from(line.text.matchAll(/[\p{L}\p{N}]+(?:[’'][\p{L}\p{N}]+)*[’']?/gu),match=>match[0]);
  const weights=tokens.map(token=>Math.max(1,(token.toLowerCase().replace(/e$/, "").match(/[aeiouy]+/g)??[]).length));
  const total=weights.reduce((sum,n)=>sum+n,0);
  let offset=0;
  return tokens.map((text,index)=>{
    const startMs=Math.round(line.startMs+(line.endMs-line.startMs)*offset/total);
    offset+=weights[index];
    return {text,startMs,endMs:Math.round(line.startMs+(line.endMs-line.startMs)*offset/total),timing:"estimated" as const};
  });
}
/** Estimated word timing is imprecise, so word mutes start and end this far around the estimate. */
export const WORD_MUTE_PAD_MS=1500;
/** Mute rules target estimated words on supported browsers; seeks retain whole-line timing. */
export function buildLivePlan(profile:Profile,lines:readonly LyricSpan[],capabilities:Capabilities,durationMs:number):PlannedAction[] {
  const plans:PlannedAction[]=[];
  for(const rule of profile.rules) {
    if(rule.action!=="mute" || !capabilities.canMute) {
      plans.push(...buildPlan({...profile,rules:[rule]},lines,capabilities,durationMs));
      continue;
    }
    if(!rule.enabled || rule.kind==="topic") continue;
    const terms=rule.kind==="term"?[rule.value]:(categories[rule.value]??[]);
    for(const line of lines) {
      const words=estimateWords(line);
      for(const term of terms) {
        const count=(normalize(term).match(/[\p{L}\p{N}]+/gu)??[]).length;
        if(!count) continue;
        for(let i=0;i+count<=words.length;i++) {
          const slice=words.slice(i,i+count);
          if(matchesTerm(slice.map(w=>w.text).join(" "),term)) plans.push({startMs:Math.max(0,slice[0].startMs-WORD_MUTE_PAD_MS),endMs:Math.min(durationMs,slice[count-1].endMs+WORD_MUTE_PAD_MS),action:"mute",reasons:[rule.label]});
        }
      }
    }
  }
  if(plans.some(p=>p.action==="skip-song")) return [{startMs:0,endMs:durationMs,action:"skip-song",reasons:[...new Set(plans.flatMap(p=>p.reasons))]}];
  const merged:PlannedAction[]=[];
  for(const item of plans.sort((a,b)=>a.startMs-b.startMs)) {
    const last=merged.at(-1);
    // Avoid silencing the music between separate words; only small gaps are bridged.
    if(last && item.startMs-last.endMs<=150) merged[merged.length-1]={startMs:last.startMs,endMs:Math.max(last.endMs,item.endMs),action:last.action==="skip-section"||item.action==="skip-section"?"skip-section":"mute",reasons:[...new Set([...last.reasons,...item.reasons])]};
    else merged.push(item);
  }
  return merged;
}
