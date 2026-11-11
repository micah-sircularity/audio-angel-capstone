import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Platform } from "react-native";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import {
  buildAudioFlags,
  buildReviewItems,
  flagsToPlan,
  neededQuestionKeys,
  rulesSignature,
  type AudioFlag,
  type TranscriptSegment,
} from "@audio-angel/filters/audio-plan";
import {
  FilterScheduler,
  type FilterSnapshot,
} from "../filtering/filter-scheduler";
import { AudioFilePlayer } from "./audio-file-player";
import {
  loadAutoFilterAll,
  loadPlanCache,
  rememberAudioTitle,
  saveAutoFilterAll,
  savePlanCache,
} from "./approvals";
import { accountConfigured } from "../account";
import { useApp } from "../../state/app-state";
import {
  useSpotifyPlayer,
  type FilterActivity,
} from "../spotify/player-provider";

/** A pickable audio source; matches the `source` arg of api.listen.requestProcessing. */
export type AudioPick =
  | { kind: "audius"; trackId: string }
  | { kind: "podcast"; feedUrl: string; guid: string };

/** Display + stream metadata gathered where the user picked the source. */
export type AudioMeta = {
  title: string;
  artist: string;
  artworkUrl?: string | null;
  durationMs?: number | null;
  enclosureUrl?: string | null;
  /** Present on Audius search rows and podcast episode rows. */
  sourceKey?: string;
};

export type AudioLaneStage =
  | "idle"
  | "processing"
  | "review"
  | "ready"
  | "playing";

export type AudioLane = {
  pick: (pick: AudioPick, meta: AudioMeta) => void;
  sourceKey: string | null;
  meta: AudioMeta | null;
  jobStatus: string | null;
  jobError: string | null;
  progressDone: number | null;
  progressTotal: number | null;
  stage: AudioLaneStage;
  /** True while a committed plan is filtering playback (false = unfiltered). */
  filtered: boolean;
  flags: AudioFlag[];
  /** flagId -> filtered; non-ignored flags default to true. */
  approvals: Record<string, boolean>;
  setApproval: (flagId: string, filtered: boolean) => void;
  autoFilterAll: boolean;
  setAutoFilterAll: (value: boolean) => void;
  submitReview: () => void;
  playUnfiltered: () => void;
  retryProcessing: () => void;
  play: () => void;
  pause: () => void;
  seekTo: (positionMs: number) => void;
  snapshot: FilterSnapshot;
  mode: "gain" | "element-muted" | null;
  fault: string | null;
  warning: string | null;
  isAuthenticated: boolean;
  filterEvents: readonly FilterActivity[];
  clearFilterEvents: () => void;
};

const AudioLaneContext = createContext<AudioLane | null>(null);

const idleSnapshot: FilterSnapshot = {
  status: "idle",
  track: null,
  positionMs: 0,
  durationMs: 0,
  paused: true,
  error: null,
  needsUserGesture: false,
};

const audiusStreamUrl = (trackId: string) =>
  `https://api.audius.co/v1/tracks/${encodeURIComponent(trackId)}/stream?app_name=audio-angel`;

/** Same digest as convex/lib/rss.ts podcastSourceKey: pod: + sha256(feed|guid)[:32]. */
async function podcastSourceKey(feedUrl: string, guid: string) {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error("crypto.subtle unavailable");
  const digest = await subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${feedUrl}|${guid}`),
  );
  const hex = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return `pod:${hex.slice(0, 32)}`;
}

const friendlyMutationError = (caught: unknown) =>
  caught instanceof Error && caught.message
    ? caught.message
    : "Audio processing could not be requested. Try again.";

function AudioLaneInner({ children }: React.PropsWithChildren) {
  const app = useApp();
  const live = useSpotifyPlayer();
  const { isAuthenticated } = useConvexAuth();
  const requestProcessing = useMutation(api.listen.requestProcessing);

  const [selected, setSelected] = useState<{
    pick: AudioPick;
    meta: AudioMeta;
  } | null>(null);
  const [sourceKey, setSourceKey] = useState<string | null>(null);
  const [phase, setPhase] = useState<
    "idle" | "processing" | "review" | "committed"
  >("idle");
  const [filtered, setFiltered] = useState(false);
  const [approvals, setApprovals] = useState<Record<string, boolean>>({});
  const [autoFilterAll, setAutoFilterAllState] = useState<boolean>(() =>
    loadAutoFilterAll(),
  );
  const [snapshot, setSnapshot] = useState<FilterSnapshot>(idleSnapshot);
  const [fault, setFault] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [filterEvents, setFilterEvents] = useState<FilterActivity[]>([]);
  const [retryNonce, setRetryNonce] = useState(0);

  const [player] = useState(() => new AudioFilePlayer());
  const schedulerRef = useRef<FilterScheduler | null>(null);
  const filteredCommitted = useRef(false);
  const planSigRef = useRef("");
  const requestedRef = useRef("");
  const warnedRef = useRef<string | null>(null);

  // One scheduler + player subscription per mount; mirrors the Spotify lane.
  useEffect(() => {
    const scheduler = new FilterScheduler(player, {
      playerLabel: "Audio",
      onEvent: (event) =>
        setFilterEvents((events) =>
          [{ ...event, at: Date.now() }, ...events].slice(0, 25),
        ),
      onFault: setFault,
    });
    schedulerRef.current = scheduler;
    const unsubscribe = player.subscribe(() =>
      // Spread: graph-only notifications reuse the same snapshot object.
      setSnapshot({ ...player.getSnapshot() }),
    );
    const visibility = () =>
      scheduler.setVisible(document.visibilityState === "visible");
    if (Platform.OS === "web") {
      visibility();
      document.addEventListener("visibilitychange", visibility);
    }
    return () => {
      scheduler.dispose();
      schedulerRef.current = null;
      unsubscribe();
      player.dispose();
      if (Platform.OS === "web")
        document.removeEventListener("visibilitychange", visibility);
    };
  }, [player]);

  const profile = app.active;
  const questionKeys = useMemo(() => neededQuestionKeys(profile), [profile]);
  const rulesSig = useMemo(() => rulesSignature(profile), [profile]);

  const status = useQuery(
    api.listen.status,
    sourceKey ? { sourceKey } : "skip",
  );
  const transcript = useQuery(
    api.listen.transcript,
    sourceKey ? { sourceKey } : "skip",
  );
  const decisions = useQuery(
    api.listen.decisions,
    sourceKey ? { sourceKey, questionKeys } : "skip",
  );

  const job = status?.job ?? null;
  const jobStatus = job?.status ?? null;

  const segments = useMemo<TranscriptSegment[]>(
    () =>
      transcript
        ? [...transcript.chunks]
            .sort((a, b) => a.chunkIndex - b.chunkIndex)
            .flatMap((chunk) => chunk.segments)
        : [],
    [transcript],
  );

  const flatDecisions = useMemo<Record<string, number[]>>(() => {
    if (!decisions) return {};
    const flat: Record<string, number[]> = {};
    for (const [key, chunks] of Object.entries(decisions.byQuestion)) {
      flat[key] = [...chunks]
        .sort((a, b) => a.chunkIndex - b.chunkIndex)
        .flatMap((chunk) => chunk.probs);
    }
    return flat;
  }, [decisions]);

  const kind: "music" | "speech" =
    selected?.pick.kind === "podcast" ? "speech" : "music";

  const jobReady =
    jobStatus === "ready" && transcript !== undefined && decisions !== undefined;

  const flags = useMemo<AudioFlag[]>(() => {
    if (!selected || !jobReady) return [];
    return buildAudioFlags(profile, segments, flatDecisions, kind);
  }, [selected, jobReady, profile, segments, flatDecisions, kind]);

  const reviewFlags = useMemo(() => buildReviewItems(flags), [flags]);

  const sourceDurationMs =
    status?.source?.durationMs && status.source.durationMs > 0
      ? status.source.durationMs
      : (selected?.meta.durationMs ?? 0);

  const streamUrl = (): string | null => {
    if (!selected) return null;
    if (selected.pick.kind === "audius")
      return audiusStreamUrl(selected.pick.trackId);
    return (
      status?.source?.enclosureUrl ?? selected.meta.enclosureUrl ?? null
    );
  };

  const pauseSpotify = () => {
    if (live.service && !live.snapshot.paused)
      void live.service.pause().catch(() => {});
  };

  /** Commit a reviewed/auto-approved flag set into plan + playback. */
  const commitPlan = (next: Record<string, boolean>, auto: boolean) => {
    if (!selected || !sourceKey) return;
    savePlanCache(sourceKey, rulesSig, { approvals: next, auto });
    setApprovals(next);
    setFiltered(true);
    const durationMs =
      sourceDurationMs > 0 ? sourceDurationMs : Number.MAX_SAFE_INTEGER;
    const plan = flagsToPlan(flags, new Map(Object.entries(next)), durationMs);
    filteredCommitted.current = true;
    setFault(null);
    schedulerRef.current?.configure({
      enabled: true,
      uri: sourceKey,
      plan,
      ready: true,
    });
    const url = streamUrl();
    if (!url) {
      setFault("This source has no playable stream yet. Try again shortly.");
      return;
    }
    player.load({
      streamUrl: url,
      sourceKey,
      durationHint: sourceDurationMs > 0 ? sourceDurationMs : null,
    });
    setPhase("committed");
    pauseSpotify();
    void player.play().catch(() => {});
  };

  const pickSource = (next: AudioPick, meta: AudioMeta) => {
    setSelected({ pick: next, meta });
    setFault(null);
    setWarning(null);
    setPhase("processing");
    setFiltered(false);
    planSigRef.current = "";
    filteredCommitted.current = false;
    schedulerRef.current?.configure({
      enabled: false,
      uri: null,
      plan: [],
      ready: false,
    });
    void player.pause();
    const key =
      meta.sourceKey ??
      (next.kind === "audius" ? `aud:${next.trackId}` : null);
    if (key) {
      setSourceKey(key);
      rememberAudioTitle(key, meta.title, meta.artist);
    } else if (next.kind === "podcast") {
      void podcastSourceKey(next.feedUrl, next.guid)
        .then((computed) => {
          setSourceKey(computed);
          rememberAudioTitle(computed, meta.title, meta.artist);
        })
        .catch(() => {});
    }
  };

  // Request (or re-request, when the profile's question keys grow) the
  // processing job. The mutation dedupes, so repeats are harmless.
  useEffect(() => {
    if (!selected || !sourceKey || !isAuthenticated) return;
    const signature = `${sourceKey}|${questionKeys.join(",")}|${retryNonce}`;
    if (requestedRef.current === signature) return;
    requestedRef.current = signature;
    void requestProcessing({
      source: selected.pick,
      questionKeys,
    })
      .then((result) => {
        if (result?.sourceKey) {
          setSourceKey(result.sourceKey);
          rememberAudioTitle(
            result.sourceKey,
            selected.meta.title,
            selected.meta.artist,
          );
        }
      })
      .catch((caught: unknown) => setFault(friendlyMutationError(caught)));
  }, [
    selected,
    sourceKey,
    isAuthenticated,
    questionKeys,
    requestProcessing,
    retryNonce,
  ]);

  /** Pause (when a stale plan was playing) and open the review list. */
  const enterReview = (next: Record<string, boolean>) => {
    if (phase === "committed") void player.pause();
    setApprovals(next);
    setPhase("review");
  };

  // When the job is ready and transcript + decisions have arrived, apply
  // stored approvals or enter review once per (source, rules, ready-run).
  useEffect(() => {
    if (!selected || !sourceKey || !jobReady) return;
    const signature = `${sourceKey}:${rulesSig}:${job?.updatedAt ?? 0}`;
    if (planSigRef.current === signature) return;
    if (phase === "committed" && !filteredCommitted.current) return; // unfiltered playback: leave it alone
    planSigRef.current = signature;
    const cache = loadPlanCache(sourceKey, rulesSig);
    const next: Record<string, boolean> = {};
    for (const flag of reviewFlags) {
      next[flag.flagId] = cache?.approvals[flag.flagId] !== false;
    }
    if (cache?.auto || loadAutoFilterAll()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- committing the plan is the state transition this effect exists to perform.
      commitPlan(next, true);
    } else {
      enterReview(next);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- commitPlan/enterReview are stable closures over current state.
  }, [
    selected,
    sourceKey,
    jobReady,
    job?.updatedAt,
    rulesSig,
    reviewFlags,
    phase,
    player,
  ]);

  // Mutual exclusion: Spotify starting playback pauses the audio lane.
  const spotifyPausedRef = useRef(live.snapshot.paused);
  useEffect(() => {
    const wasPaused = spotifyPausedRef.current;
    spotifyPausedRef.current = live.snapshot.paused;
    if (wasPaused && !live.snapshot.paused) void player.pause();
  }, [live.snapshot.paused, player]);

  // Duration sanity check once the element reports metadata.
  useEffect(() => {
    if (!selected || !sourceKey || !sourceDurationMs) return;
    if (!snapshot.durationMs || warnedRef.current === sourceKey) return;
    const diff = Math.abs(snapshot.durationMs - sourceDurationMs);
    if (diff > 30_000 || diff / sourceDurationMs > 0.05) {
      warnedRef.current = sourceKey;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot notice derived from the element's loaded metadata.
      setWarning(
        "Episode audio may have changed since processing (ads can be re-inserted); timing could drift.",
      );
    }
  }, [snapshot.durationMs, sourceDurationMs, selected, sourceKey]);

  const submitReview = () => {
    if (!sourceKey) return;
    commitPlan(approvals, autoFilterAll);
  };

  const playUnfiltered = () => {
    if (!selected) return;
    const url = streamUrl();
    if (!url) {
      setFault("This source has no playable stream yet. Try again shortly.");
      return;
    }
    filteredCommitted.current = false;
    setFiltered(false);
    setFault(null);
    schedulerRef.current?.configure({
      enabled: false,
      uri: null,
      plan: [],
      ready: false,
    });
    player.load({
      streamUrl: url,
      sourceKey: sourceKey ?? selected.meta.sourceKey ?? selected.meta.title,
      durationHint: sourceDurationMs > 0 ? sourceDurationMs : null,
    });
    setPhase("committed");
    pauseSpotify();
    void player.play().catch(() => {});
  };

  const stage: AudioLaneStage = !selected
    ? "idle"
    : phase === "committed"
      ? snapshot.paused
        ? "ready"
        : "playing"
      : phase;

  const value: AudioLane = {
    pick: pickSource,
    sourceKey,
    meta: selected?.meta ?? null,
    jobStatus,
    jobError: job?.error ?? null,
    progressDone: job?.progressDone ?? null,
    progressTotal: job?.progressTotal ?? null,
    stage,
    filtered,
    flags: reviewFlags,
    approvals,
    setApproval: (flagId, filtered) =>
      setApprovals((current) => ({ ...current, [flagId]: filtered })),
    autoFilterAll,
    setAutoFilterAll: (value) => {
      setAutoFilterAllState(value);
      saveAutoFilterAll(value);
    },
    submitReview,
    playUnfiltered,
    retryProcessing: () => {
      setFault(null);
      requestedRef.current = "";
      setRetryNonce((n) => n + 1);
    },
    play: () => {
      pauseSpotify();
      void player.play().catch(() => {});
    },
    pause: () => void player.pause(),
    seekTo: (positionMs) => void player.seek(positionMs),
    snapshot,
    mode: player.mode,
    fault,
    warning,
    isAuthenticated,
    filterEvents,
    clearFilterEvents: () => setFilterEvents([]),
  };
  return (
    <AudioLaneContext.Provider value={value}>
      {children}
    </AudioLaneContext.Provider>
  );
}

const stubLane: AudioLane = {
  pick: () => {},
  sourceKey: null,
  meta: null,
  jobStatus: null,
  jobError: null,
  progressDone: null,
  progressTotal: null,
  stage: "idle",
  filtered: false,
  flags: [],
  approvals: {},
  setApproval: () => {},
  autoFilterAll: false,
  setAutoFilterAll: () => {},
  submitReview: () => {},
  playUnfiltered: () => {},
  retryProcessing: () => {},
  play: () => {},
  pause: () => {},
  seekTo: () => {},
  snapshot: idleSnapshot,
  mode: null,
  fault: null,
  warning: null,
  isAuthenticated: false,
  filterEvents: [],
  clearFilterEvents: () => {},
};

export function AudioLaneProvider({ children }: React.PropsWithChildren) {
  // Convex hooks require the account provider; without configuration the
  // lane degrades to an inert stub.
  if (!accountConfigured) {
    return (
      <AudioLaneContext.Provider value={stubLane}>
        {children}
      </AudioLaneContext.Provider>
    );
  }
  return <AudioLaneInner>{children}</AudioLaneInner>;
}

export function useAudioLane(): AudioLane {
  const value = useContext(AudioLaneContext);
  if (!value) throw new Error("AudioLaneProvider is missing.");
  return value;
}
