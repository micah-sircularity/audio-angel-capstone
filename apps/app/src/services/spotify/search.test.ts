import { describe, expect, it, vi } from "vitest";
import { searchSpotify, type LibraryFetch } from "./library";
const id = "0fuLRqMU6IaRoNAFIUdjPx";
const getToken = async () => "fixture";
const send = (data: unknown) => vi.fn<LibraryFetch>().mockResolvedValue(new Response(JSON.stringify(data), { status: 200 }));
describe("Spotify catalog search", () => {
  it("requests all six types at once with limit 10 and offset 0", async () => {
    const fetcher = send({ tracks: { items: [], total: 0, next: null } });
    await searchSpotify({ query: "Podnews", type: "all", offset: 40, getToken, fetch: fetcher });
    const url = new URL(String(fetcher.mock.calls[0][0]));
    expect(url.searchParams.get("type")).toBe("track,episode,show,album,playlist,artist");
    expect(url.searchParams.get("limit")).toBe("10");
    expect(url.searchParams.get("offset")).toBe("0");
  });
  it("honors offset for a single type", async () => {
    const fetcher = send({ tracks: { items: [{ type: "track", id, name: "Creep", artists: [{ name: "Radiohead" }], album: { name: "Pablo Honey" }, explicit: true }], next: "next", total: 40 } });
    const result = await searchSpotify({ query: "Creep & Radiohead", type: "track", offset: 10, getToken, fetch: fetcher });
    const url = new URL(String(fetcher.mock.calls[0][0]));
    expect(url.searchParams.get("type")).toBe("track");
    expect(url.searchParams.get("offset")).toBe("10");
    expect(result.groups.track?.items[0]).toMatchObject({ kind: "track", explicit: true, albumName: "Pablo Honey" });
    expect(result.groups.track?.nextOffset).toBe(20);
  });
  it("parses every group key and skips null playlist entries", async () => {
    const base = { items: [], total: 0, next: null };
    const fetcher = send({
      tracks: { items: [{ type: "track", id, name: "Song", artists: [{ name: "A" }] }], total: 1, next: null },
      episodes: { items: [{ type: "episode", id: "1111111111111111111112", name: "Ep", release_date: "2025-03-07" }], total: 1, next: null },
      shows: { items: [{ type: "show", id: "1111111111111111111113", name: "Pod", publisher: "Pub" }], total: 1, next: null },
      albums: { items: [{ type: "album", id: "1111111111111111111114", name: "Alb", artists: [{ name: "A" }] }], total: 1, next: null },
      playlists: { items: [null, { type: "playlist", id: "1111111111111111111115", name: "Pl", owner: { display_name: "Owner" } }], total: 2, next: null },
      artists: { items: [{ type: "artist", id: "1111111111111111111116", name: "Ar" }], total: 1, next: null },
    });
    void base;
    const result = await searchSpotify({ query: "x", type: "all", getToken, fetch: fetcher });
    expect(Object.keys(result.groups).sort()).toEqual(["album", "artist", "episode", "playlist", "show", "track"]);
    expect(result.groups.episode?.items[0].subtitle).toBe("Episode · Mar 7, 2025");
    expect(result.groups.show?.items[0].subtitle).toBe("Pub");
    expect(result.groups.playlist?.items).toHaveLength(1);
    expect(result.groups.playlist?.items[0].subtitle).toBe("Owner");
  });
  it("does not issue a request for empty or invalid queries", async () => {
    const fetcher = vi.fn<LibraryFetch>();
    await expect(searchSpotify({ query: " ", type: "all", getToken, fetch: fetcher })).rejects.toThrow("Enter something to search");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([401, 403, 429, 500])("surfaces Spotify status %s", async (status) => {
    const fetcher = vi.fn<LibraryFetch>().mockResolvedValue(new Response(null, { status }));
    await expect(searchSpotify({ query: "Creep", type: "track", getToken, fetch: fetcher })).rejects.toMatchObject({ status });
  });
});
