import { useEffect, useMemo, useState } from "react";
import * as Schema from "effect/Schema";
import type { PlaybackSnapshot } from "./spotify/playback";

export type RecentItem = {
  uri: string;
  kind: "track" | "episode";
  name: string;
  subtitle: string;
  imageUrl: string | null;
  playedAt: number;
};

const Item = Schema.Struct({
  uri: Schema.String,
  kind: Schema.Literal("track", "episode"),
  name: Schema.String,
  subtitle: Schema.String,
  imageUrl: Schema.NullOr(Schema.String),
  playedAt: Schema.Int,
});
const Stored = Schema.Array(Item);
const MAX = 30;
const keyFor = (accountId: string) => `audio-angel:recent:v1:${accountId}`;

const storage = () =>
  typeof localStorage === "undefined" ? null : localStorage;

export function readRecent(accountId: string): RecentItem[] {
  const raw = storage()?.getItem(keyFor(accountId));
  if (!raw) return [];
  try {
    return Schema.decodeUnknownSync(Stored)(JSON.parse(raw)) as RecentItem[];
  } catch {
    return [];
  }
}

export function recordRecent(
  items: readonly RecentItem[],
  next: Omit<RecentItem, "playedAt">,
  playedAt: number,
): RecentItem[] {
  const rest = items.filter((item) => item.uri !== next.uri);
  return [{ ...next, playedAt }, ...rest].slice(0, MAX);
}

export function writeRecent(accountId: string, items: readonly RecentItem[]) {
  storage()?.setItem(keyFor(accountId), JSON.stringify(items));
}

export function clearRecent(accountId: string) {
  storage()?.removeItem(keyFor(accountId));
}

export function relativeTime(playedAt: number, now: number): string {
  const diff = Math.max(0, now - playedAt);
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "Yesterday";
  return `${days} days ago`;
}

/** Records a track/episode the first time its uri reaches a non-paused state. */
export function useRecentlyPlayed(
  snapshot: PlaybackSnapshot,
  accountId: string | null,
): { items: RecentItem[]; clear: () => void } {
  const scope = accountId ?? "anonymous";
  const [items, setItems] = useState<RecentItem[]>([]);
  const [seenScope, setSeenScope] = useState(scope);
  if (seenScope !== scope) {
    setSeenScope(scope);
    setItems(readRecent(scope));
  }
  const track = snapshot.track;
  useEffect(() => {
    if (!track || snapshot.paused || !track.uri) return;
    const kind = track.uri.startsWith("spotify:episode:")
      ? ("episode" as const)
      : track.uri.startsWith("spotify:track:")
        ? ("track" as const)
        : null;
    if (!kind) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- persistence keyed to first unpaused state; updater is pure.
    setItems((current) => {
      const next = recordRecent(
        current,
        {
          uri: track.uri,
          kind,
          name: track.name,
          subtitle: `${track.artist} · ${track.album}`,
          imageUrl: track.imageUrl,
        },
        Date.now(),
      );
      if (next !== current) writeRecent(scope, next);
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- record on first unpaused state per uri.
  }, [track?.uri, snapshot.paused, scope]);
  return useMemo(
    () => ({
      items: items.filter((item) => item.uri !== track?.uri),
      clear: () => {
        clearRecent(scope);
        setItems([]);
      },
    }),
    [items, scope, track?.uri],
  );
}
