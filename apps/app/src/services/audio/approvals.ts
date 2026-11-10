/**
 * Small persistence helpers for the audio-native lane.
 *
 * Web uses localStorage; native falls back to an in-memory Map (the lane
 * is web-only for now, so losing the cache across native sessions is
 * acceptable).
 */

export type PlanCache = {
  /** flagId -> filtered (true keeps the flag in the plan; false keeps the audio). */
  approvals: Record<string, boolean>;
  /** This profile/source pair was reviewed with "skip review" on. */
  auto: boolean;
};

export type AudioTitle = { title: string; artist: string };

const PLAN_PREFIX = "audio-angel:plan:v2:";
const AUTO_KEY = "audio-angel:autofilter:v1";
const TITLES_KEY = "audio-angel:titles:v1";
const MAX_TITLES = 30;

const memory = new Map<string, string>();

const storage = (): Pick<Storage, "getItem" | "setItem"> | null =>
  typeof localStorage === "undefined"
    ? null
    : localStorage;

const read = (key: string): string | null =>
  storage()?.getItem(key) ?? memory.get(key) ?? null;

const write = (key: string, value: string) => {
  const store = storage();
  if (store) store.setItem(key, value);
  else memory.set(key, value);
};

const planKey = (sourceKey: string, rulesSig: string) =>
  `${PLAN_PREFIX}${sourceKey}:${rulesSig}`;

export function loadPlanCache(
  sourceKey: string,
  rulesSig: string,
): PlanCache | null {
  const raw = read(planKey(sourceKey, rulesSig));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<PlanCache> | null;
    if (!parsed || typeof parsed !== "object") return null;
    const approvals =
      parsed.approvals && typeof parsed.approvals === "object"
        ? parsed.approvals
        : {};
    return { approvals, auto: parsed.auto === true };
  } catch {
    return null;
  }
}

export function savePlanCache(
  sourceKey: string,
  rulesSig: string,
  cache: PlanCache,
) {
  write(planKey(sourceKey, rulesSig), JSON.stringify(cache));
}

export function loadAutoFilterAll(): boolean {
  return read(AUTO_KEY) === "1";
}

export function saveAutoFilterAll(enabled: boolean) {
  write(AUTO_KEY, enabled ? "1" : "0");
}

type StoredTitle = AudioTitle & { sourceKey: string; at: number };

const readTitles = (): StoredTitle[] => {
  const raw = read(TITLES_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is StoredTitle =>
        item !== null &&
        typeof item === "object" &&
        typeof (item as StoredTitle).sourceKey === "string" &&
        typeof (item as StoredTitle).title === "string" &&
        typeof (item as StoredTitle).artist === "string",
    );
  } catch {
    return [];
  }
};

/** Keeps the last ~30 picked audio sources so `aud:`/`pod:` keys resolve to names. */
export function rememberAudioTitle(
  sourceKey: string,
  title: string,
  artist: string,
) {
  if (!sourceKey) return;
  const next: StoredTitle = { sourceKey, title, artist, at: Date.now() };
  const rest = readTitles().filter((item) => item.sourceKey !== sourceKey);
  write(TITLES_KEY, JSON.stringify([next, ...rest].slice(0, MAX_TITLES)));
}

export function audioTitleFor(sourceKey: string): AudioTitle | null {
  const found = readTitles().find((item) => item.sourceKey === sourceKey);
  return found ? { title: found.title, artist: found.artist } : null;
}
