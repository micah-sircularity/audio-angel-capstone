import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  audioTitleFor,
  loadAutoFilterAll,
  loadPlanCache,
  rememberAudioTitle,
  saveAutoFilterAll,
  savePlanCache,
} from "./approvals";

const store = new Map<string, string>();

beforeEach(() => {
  store.clear();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  });
});

describe("plan cache", () => {
  it("returns null for missing or foreign keys", () => {
    expect(loadPlanCache("aud:x", "sig")).toBeNull();
    savePlanCache("aud:x", "sig", { approvals: { f1: true }, auto: false });
    expect(loadPlanCache("aud:x", "other-sig")).toBeNull();
    expect(loadPlanCache("aud:y", "sig")).toBeNull();
  });

  it("round-trips approvals and the auto flag", () => {
    savePlanCache("pod:abc", "rules:1", {
      approvals: { w1: true, s2: false },
      auto: true,
    });
    expect(loadPlanCache("pod:abc", "rules:1")).toEqual({
      approvals: { w1: true, s2: false },
      auto: true,
    });
  });

  it("survives corrupt values", () => {
    store.set("audio-angel:plan:v2:aud:x:sig", "{not json");
    expect(loadPlanCache("aud:x", "sig")).toBeNull();
    store.set("audio-angel:plan:v2:aud:x:sig", "42");
    expect(loadPlanCache("aud:x", "sig")).toBeNull();
  });
});

describe("auto-filter-all flag", () => {
  it("defaults off and round-trips", () => {
    expect(loadAutoFilterAll()).toBe(false);
    saveAutoFilterAll(true);
    expect(loadAutoFilterAll()).toBe(true);
    saveAutoFilterAll(false);
    expect(loadAutoFilterAll()).toBe(false);
  });
});

describe("audio titles", () => {
  it("resolves remembered titles and misses unknown keys", () => {
    expect(audioTitleFor("aud:none")).toBeNull();
    rememberAudioTitle("aud:t1", "Song", "Artist");
    expect(audioTitleFor("aud:t1")).toEqual({ title: "Song", artist: "Artist" });
  });

  it("dedupes by sourceKey and keeps the newest ~30", () => {
    for (let i = 0; i < 35; i++) {
      rememberAudioTitle(`aud:t${i}`, `Title ${i}`, "A");
    }
    rememberAudioTitle("aud:t34", "Renamed", "B");
    expect(audioTitleFor("aud:t34")).toEqual({ title: "Renamed", artist: "B" });
    expect(audioTitleFor("aud:t0")).toBeNull(); // evicted oldest
    expect(audioTitleFor("aud:t5")).not.toBeNull();
    const raw = JSON.parse(
      store.get("audio-angel:titles:v1") ?? "[]",
    ) as unknown[];
    expect(raw.length).toBeLessThanOrEqual(30);
  });
});
