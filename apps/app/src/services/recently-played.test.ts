import { beforeEach, describe, expect, it } from "vitest";
import { clearRecent, readRecent, recordRecent, relativeTime, writeRecent, type RecentItem } from "./recently-played";

const item = (uri: string, playedAt = 1): Omit<RecentItem, "playedAt"> => ({
  uri, kind: uri.includes("episode") ? "episode" : "track", name: `N-${uri.slice(-3)}`, subtitle: "S", imageUrl: null,
});
const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  (globalThis as { localStorage?: Storage }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  } as Storage;
});

describe("recently played", () => {
  it("records unpaused entries once and dedupes to the top", () => {
    let items: RecentItem[] = [];
    items = recordRecent(items, item("spotify:track:aaa1111111111111111111"), 100);
    items = recordRecent(items, item("spotify:episode:bbb2222222222222222222"), 200);
    items = recordRecent(items, item("spotify:track:aaa1111111111111111111"), 300);
    expect(items.map((i) => i.uri)).toEqual([
      "spotify:track:aaa1111111111111111111",
      "spotify:episode:bbb2222222222222222222",
    ]);
    expect(items[0].playedAt).toBe(300);
  });
  it("caps at 30 entries", () => {
    let items: RecentItem[] = [];
    for (let i = 0; i < 35; i++)
      items = recordRecent(items, item(`spotify:track:${String(i).padStart(22, "0")}`), i);
    expect(items).toHaveLength(30);
    expect(items[0].playedAt).toBe(34);
  });
  it("persists per account and reads back", () => {
    writeRecent("acc-1", recordRecent([], item("spotify:track:aaa1111111111111111111"), 5));
    writeRecent("acc-2", recordRecent([], item("spotify:track:ccc3333333333333333333"), 7));
    expect(readRecent("acc-1")[0].uri).toBe("spotify:track:aaa1111111111111111111");
    expect(readRecent("acc-2")[0].uri).toBe("spotify:track:ccc3333333333333333333");
    clearRecent("acc-1");
    expect(readRecent("acc-1")).toEqual([]);
    expect(readRecent("acc-2")).toHaveLength(1);
  });
  it("returns empty on corrupt storage", () => {
    store.set("audio-angel:recent:v1:acc", "not json{");
    expect(readRecent("acc")).toEqual([]);
    store.set("audio-angel:recent:v1:acc", JSON.stringify([{ bad: 1 }]));
    expect(readRecent("acc")).toEqual([]);
  });
  it("formats relative times", () => {
    expect(relativeTime(0, 30_000)).toBe("Just now");
    expect(relativeTime(0, 5 * 60_000)).toBe("5 min ago");
    expect(relativeTime(0, 2 * 3_600_000)).toBe("2 hr ago");
    expect(relativeTime(0, 25 * 3_600_000)).toBe("Yesterday");
    expect(relativeTime(0, 3 * 86_400_000)).toBe("3 days ago");
  });
});
