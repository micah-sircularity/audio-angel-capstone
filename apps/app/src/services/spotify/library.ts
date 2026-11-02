import * as Schema from "effect/Schema";
export type LibraryFetch = (input: string, init?: RequestInit) => Promise<Response>;
export type LibraryKind = "tracks" | "albums" | "playlists" | "artists" | "shows" | "episodes";
export type Collection = { kind: "album" | "playlist" | "show"; id: string; name: string; url: string };
export type LibraryItem = {
  id: string; name: string; subtitle: string; imageUrl: string | null;
  uri: string; url: string; kind: "track" | "episode" | "album" | "playlist" | "show" | "artist";
  playable: boolean; durationMs: number | null; explicit:boolean; albumName:string;
};
export type LibraryPage = { items: LibraryItem[]; nextOffset: number | null; total: number };
const ObjectValue = Schema.Record({key: Schema.String, value: Schema.Unknown});
const object = (value: unknown): Record<string, unknown> => Schema.is(ObjectValue)(value) ? value : {};
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const string = (value: unknown): string => typeof value === "string" ? value : "";
const kinds = ["track", "episode", "album", "playlist", "show", "artist"] as const;
export function parseLibraryItem(value: unknown, fallback?: LibraryItem["kind"]): LibraryItem | null {
  const raw = object(value);
  const data = kinds.some(k => raw.type === k) ? raw : object(raw.track ?? raw.item ?? raw.album ?? raw.show ?? raw.episode ?? raw);
  const kind = kinds.find(k => data.type === k) ?? fallback;
  const id = string(data.id);
  if (!kind || !/^[A-Za-z0-9]{22}$/.test(id)) return null;
  const album = object(data.album);
  const show = object(data.show);
  const artists = array(data.artists).map(a => string(object(a).name)).filter(Boolean).join(", ");
  const image = string(object(array(data.images ?? album.images ?? show.images)[0]).url);
  const duration = typeof data.duration_ms === "number" ? data.duration_ms : null;
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const dateParts = kind === "episode" ? /^(\d{4})-(\d{2})-(\d{2})/.exec(string(data.release_date)) : null;
  const releaseDate =
    dateParts && Number(dateParts[2]) >= 1 && Number(dateParts[2]) <= 12
      ? `Episode · ${months[Number(dateParts[2]) - 1]} ${Number(dateParts[3])}, ${dateParts[1]}`
      : "";
  return {
    id, kind, name: string(data.name) || "Untitled", uri: `spotify:${kind}:${id}`,
    url: `https://open.spotify.com/${kind}/${id}`,
    subtitle: artists || string(data.publisher) || string(object(data.owner).display_name) || string(show.name) || releaseDate || (kind === "playlist" ? "Spotify playlist" : kind === "artist" ? "Artist" : ""),
    imageUrl: /^https:\/\//.test(image) ? image : null,
    playable: (kind === "track" || kind === "episode") && data.is_playable !== false && data.is_local !== true && !object(data.restrictions).reason,
    durationMs: duration, explicit:data.explicit===true, albumName:string(album.name),
  };
}
export class LibraryError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}
export function libraryPath(kind: LibraryKind, offset: number, collection?: Collection): string {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 100_000) throw new Error("Invalid library page.");
  if (collection && !/^[A-Za-z0-9]{22}$/.test(collection.id)) throw new Error("Invalid collection.");
  const base = collection ? collection.kind === "album" ? `/albums/${collection.id}/tracks` : collection.kind === "show" ? `/shows/${collection.id}/episodes` : `/playlists/${collection.id}/items` : kind === "artists" ? "/me/following?type=artist" : `/me/${kind}`;
  return `${base}${base.includes("?") ? "&" : "?"}limit=30${kind === "artists" && !collection ? "" : `&offset=${offset}`}`;
}
export async function fetchLibraryPage(options: {
  kind: LibraryKind; offset?: number; after?: string; collection?: Collection;
  getToken: () => Promise<string>; signal?: AbortSignal; fetch?: LibraryFetch;
}): Promise<LibraryPage & { after: string | null }> {
  const { kind, collection, signal } = options;
  let path = libraryPath(kind, options.offset ?? 0, collection);
  if (kind === "artists" && options.after) path += `&after=${encodeURIComponent(options.after)}`;
  const response = await (options.fetch ?? fetch)(`https://api.spotify.com/v1${path}`, {
    headers: { Authorization: `Bearer ${await options.getToken()}` }, signal,
  });
  if (!response.ok) {
    const message = response.status === 401 ? "Your Spotify connection expired. Reconnect in Settings."
      : response.status === 403 ? "Spotify did not allow access to this content. Check permissions or open it in Spotify."
      : response.status === 429 ? `Spotify is limiting requests. Try again ${response.headers.get("Retry-After") ? `in ${response.headers.get("Retry-After")} seconds` : "shortly"}.`
      : "Your Spotify library could not be loaded. Try again.";
    throw new LibraryError(message, response.status);
  }
  const payload = object(await response.json());
  const page = kind === "artists" && !collection ? object(payload.artists) : payload;
  if (!Array.isArray(page.items)) throw new LibraryError("Spotify returned an unreadable library page. Try again.", 502);
  const fallback = collection?.kind === "show" ? "episode" : collection?.kind === "album" ? "track" : undefined;
  const items = page.items.map(value => parseLibraryItem(value, fallback)).filter((v): v is LibraryItem => v !== null);
  const offset = options.offset ?? 0;
  return {
    items,
    nextOffset: page.next ? offset + page.items.length : null,
    total: typeof page.total === "number" ? page.total : items.length,
    after: page.next ? string(object(page.cursors).after) || null : null,
  };
}

export type SearchType = "all" | "track" | "episode" | "show" | "album" | "playlist" | "artist";
const searchGroups = ["track", "episode", "show", "album", "playlist", "artist"] as const;
type SearchGroup = (typeof searchGroups)[number];
const spotifyType: Record<SearchGroup, string> = {
  track: "track", episode: "episode", show: "show", album: "album", playlist: "playlist", artist: "artist",
};
const responseKey: Record<SearchGroup, string> = {
  track: "tracks", episode: "episodes", show: "shows", album: "albums", playlist: "playlists", artist: "artists",
};

/** Catalog search is independent of the user's saved library. Dev Mode allows 10 results per page. */
export async function searchSpotify(options: {
  query: string; type: SearchType; offset?: number; getToken: () => Promise<string>; signal?: AbortSignal; fetch?: LibraryFetch;
}): Promise<{ groups: Partial<Record<SearchGroup, LibraryPage>> }> {
  const query = options.query.trim();
  const type = options.type;
  const offset = type === "all" ? 0 : options.offset ?? 0;
  if (!query || query.length > 200 || !Number.isSafeInteger(offset) || offset < 0 || offset > 990) throw new LibraryError("Enter something to search (up to 200 characters).", 400);
  const typeParam = type === "all" ? searchGroups.map(g => spotifyType[g]).join(",") : spotifyType[type as SearchGroup] ?? type;
  const params = new URLSearchParams({q: query, type: typeParam, limit: "10", offset: String(offset)});
  const response = await (options.fetch ?? fetch)(`https://api.spotify.com/v1/search?${params}`, {
    headers: {Authorization: `Bearer ${await options.getToken()}`}, signal: options.signal,
  });
  if (!response.ok) throw new LibraryError(response.status === 401 ? "Reconnect Spotify in Settings to search." : response.status === 429 ? "Spotify is limiting searches. Wait a moment, then retry." : response.status === 403 ? "Spotify did not allow catalog search for this account. Check developer-app access." : "Spotify search failed. Try again.", response.status);
  const payload = object(await response.json());
  const groups: Partial<Record<SearchGroup, LibraryPage>> = {};
  for (const group of searchGroups) {
    const data = object(payload[responseKey[group]]);
    if (!Array.isArray(data.items)) continue;
    groups[group] = {
      items: data.items.map(value => parseLibraryItem(value, group)).filter((value): value is LibraryItem => value !== null),
      total: typeof data.total === "number" ? data.total : data.items.length,
      nextOffset: data.next && offset < 990 ? offset + 10 : null,
    };
  }
  return { groups };
}
