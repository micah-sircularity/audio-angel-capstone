import { describe, expect, it } from "vitest";
import { buildPlan, buildLivePlan, estimateWords, matchesTerm } from "./index";
import type { Profile, LyricSpan } from "@audio-angel/contracts";
const profile: Profile = {
  id: "kids",
  name: "Kids",
  rules: [
    {
      id: "term",
      label: "Flagged term",
      kind: "term",
      value: "dang",
      action: "mute",
      enabled: true,
    },
  ],
};
const caps = {
  canMute: true,
  canSeek: true,
  background: "unverified" as const,
};
const spans: LyricSpan[] = [
  { text: "dang", startMs: 1000, endMs: 1400, timing: "estimated" },
];
describe("matching", () => {
  it("matches whole words and plural variants without matching substrings", () => {
    expect(matchesTerm("DANG!", "dang")).toBe(true);
    expect(matchesTerm("dangling", "dang")).toBe(false);
    expect(matchesTerm("cats", "cat")).toBe(true);
    expect(matchesTerm("anything", "")).toBe(false);
  });
});
describe("action plans", () => {
  it("pads and downgrades mute to seek on iPhone", () => {
    expect(
      buildPlan(profile, spans, { ...caps, canMute: false }, 10000),
    ).toEqual([
      {
        startMs: 800,
        endMs: 1600,
        action: "skip-section",
        reasons: ["Flagged term"],
      },
    ]);
  });
  it("merges nearby spans and clamps track boundaries", () => {
    const plan = buildPlan(
      profile,
      [...spans, { ...spans[0], startMs: 1800, endMs: 2100 }],
      caps,
      2200,
    );
    expect(plan).toHaveLength(1);
    expect(plan[0].endMs).toBe(2200);
  });
  it("ignores disabled rules and unresolved topics", () => {
    expect(
      buildPlan(
        {
          ...profile,
          rules: profile.rules.map((r) => ({ ...r, enabled: false })),
        },
        spans,
        caps,
        10000,
      ),
    ).toEqual([]);
    expect(
      buildPlan(
        {
          ...profile,
          rules: profile.rules.map((r) => ({ ...r, kind: "topic" })),
        },
        spans,
        caps,
        10000,
      ),
    ).toEqual([]);
  });
  it("gives skip-song precedence", () => {
    const plan = buildPlan(
      {
        ...profile,
        rules: [
          ...profile.rules,
          { ...profile.rules[0], id: "skip", action: "skip-song" },
        ],
      },
      spans,
      caps,
      10000,
    );
    expect(plan).toEqual([
      {
        startMs: 0,
        endMs: 10000,
        action: "skip-song",
        reasons: ["Flagged term"],
      },
    ]);
  });
});
describe("first live song vocabulary",()=>{
  it("finds abbreviated profanity in line-timed lyrics and skips the entire line",()=>{
    const plan=buildPlan({id:"test",name:"Test",rules:[{id:"cuss",kind:"category",value:"profanity",label:"Cuss words",enabled:true,action:"mute"}]},[{text:"fuckin'",startMs:55120,endMs:59000,timing:"line"}],{canMute:false,canSeek:true,background:"unsupported"},239000);
    expect(plan).toEqual([{startMs:54920,endMs:59200,action:"skip-section",reasons:["Cuss words"]}]);
  });
});

describe("live word estimates",()=>{
  const line:LyricSpan={text:"one dang two",startMs:1000,endMs:4000,timing:"line"};
  it("targets only a matched word and labels the timing estimated",()=>{
    expect(estimateWords(line)).toEqual([{text:"one",startMs:1000,endMs:2000,timing:"estimated"},{text:"dang",startMs:2000,endMs:3000,timing:"estimated"},{text:"two",startMs:3000,endMs:4000,timing:"estimated"}]);
    expect(buildLivePlan(profile,[line],caps,10000)).toEqual([{startMs:500,endMs:4500,action:"mute",reasons:["Flagged term"]}]);
  });
  it("pads word mutes by 1.5s on each side, clamped to the track",()=>{
    expect(buildLivePlan(profile,[{...line,text:"dang",startMs:600,endMs:1000}],caps,1800)).toEqual([{startMs:0,endMs:1800,action:"mute",reasons:["Flagged term"]}]);
  });
  it("retains whole-line seeks without volume support",()=>expect(buildLivePlan(profile,[line],{...caps,canMute:false},10000)).toEqual([{startMs:800,endMs:4200,action:"skip-section",reasons:["Flagged term"]}]));
  it("matches phrases and gives overlapping section skips precedence",()=>{
    const phrase={...profile,rules:[{...profile.rules[0],value:"dang two"}]};
    expect(buildLivePlan(phrase,[line],caps,10000)[0]).toMatchObject({startMs:500,endMs:5500,action:"mute"});
    expect(buildLivePlan({...profile,rules:[...profile.rules,{...profile.rules[0],id:"section",action:"skip-section"}]},[line],caps,10000)).toEqual([{startMs:500,endMs:4500,action:"skip-section",reasons:["Flagged term"]}]);
  });
  it("does not merge distant word mutes or match substrings",()=>{
    const plan=buildLivePlan(profile,[{...line,text:"dang one two dang",endMs:13000}],caps,20000);expect(plan).toHaveLength(2);
    expect(buildLivePlan(profile,[{...line,text:"dangling"}],caps,10000)).toEqual([]);
  });
});
