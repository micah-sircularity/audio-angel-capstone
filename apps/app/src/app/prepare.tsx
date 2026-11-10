import React, { useCallback, useEffect, useRef, useState } from "react";
import { Platform, TextInput, View } from "react-native";
import { useAction, useConvexAuth, useMutation, useQuery } from "convex/react";
import { useLocalSearchParams, useRouter } from "expo-router";
import type { FunctionReturnType } from "convex/server";
import type { Id } from "../../../../convex/_generated/dataModel";
import { api } from "../../../../convex/_generated/api";
import {
  DEFAULT_BLOCKED_WORDS,
  normalizeWord,
  planWords,
} from "../../../../convex/lib/mediaPlan";
import { accountConfigured } from "../services/account";
import { useAudioLane } from "../services/audio/audio-lane-provider";
import { useSpotifyPlayer } from "../services/spotify/player-provider";
import { Button, Chip, Label, Title } from "../ui/components";
import { fonts, useTheme } from "../ui/theme";

const labels: Record<string, string> = {
  queued: "Waiting to prepare",
  resolving: "Finding the recording",
  downloading: "Saving this recording",
  separating: "Separating vocals and music",
  transcribing: "Finding words and timestamps",
  review: "Ready to review",
  failed: "Preparation stopped",
};
const clock = (ms: number) =>
  `${Math.floor(ms / 60000)}:${((ms % 60000) / 1000).toFixed(1).padStart(4, "0")}`;
type Episode = FunctionReturnType<
  typeof api.listen.listEpisodes
>["episodes"][number];

function Preparation() {
  const t = useTheme(),
    router = useRouter();
  const lane = useAudioLane(),
    spotify = useSpotifyPlayer();
  const { isAuthenticated } = useConvexAuth();
  const params = useLocalSearchParams<{
    trackId?: string;
    feedUrl?: string;
    guid?: string;
    title?: string;
  }>();
  const [pickedGuid, setPickedGuid] = useState(params.guid ?? "");
  const start = useMutation(api.media.start),
    requestMix = useMutation(api.media.requestMix),
    getEpisodes = useAction(api.listen.listEpisodes);
  const [kind, setKind] = useState<"music" | "podcast">(
    params.feedUrl ? "podcast" : "music",
  );
  const [input, setInput] = useState(
      params.feedUrl ?? params.trackId ?? "m7AlvqA",
    ),
    [episodes, setEpisodes] = useState<Episode[]>([]),
    [episode, setEpisode] = useState<Episode | null>(null);
  const [assetId, setAssetId] = useState<Id<"mediaAssets"> | null>(null),
    [mixId, setMixId] = useState<Id<"mediaMixes"> | null>(null);
  const [custom, setCustom] = useState(""),
    [profanity, setProfanity] = useState(true),
    [fault, setFault] = useState<string | null>(null),
    [pending, setPending] = useState(false);
  const [playing, setPlaying] = useState(false),
    [position, setPosition] = useState(0),
    [original, setOriginal] = useState(false);
  const player = useRef<HTMLAudioElement | null>(null);
  const assignPlayer = useCallback((node: HTMLAudioElement | null) => {
    if (!node) player.current?.pause();
    player.current = node;
  }, []);
  const resumePosition = useRef(0);
  const resumePlayback = useRef(false);
  const compare = (value: boolean) => {
    resumePosition.current = player.current?.currentTime ?? 0;
    resumePlayback.current = !!player.current && !player.current.paused;
    setOriginal(value);
  };
  const data = useQuery(
    api.media.read,
    assetId ? { assetId, ...(mixId ? { mixId } : {}) } : "skip",
  );
  const words = [
    ...new Set([
      ...(profanity ? DEFAULT_BLOCKED_WORDS : []),
      ...custom
        .split(/[,\s]+/)
        .map(normalizeWord)
        .filter(Boolean),
    ]),
  ].sort();
  const asset = data?.asset,
    mix = data?.mix;
  const plan = asset?.words
    ? planWords(asset.words, words, asset.durationMs ?? 0)
    : null;
  const changed =
    !!mix && JSON.stringify([...mix.words].sort()) !== JSON.stringify(words);
  const canRender =
    asset?.stage === "review" &&
    !pending &&
    mix?.stage !== "rendering" &&
    mix?.stage !== "queued";
  const url = original ? data?.originalUrl : data?.mixUrl;
  useEffect(() => {
    if (!lane.snapshot.paused || !spotify.snapshot.paused)
      player.current?.pause();
  }, [lane.snapshot.paused, spotify.snapshot.paused]);
  const source = () =>
    kind === "music"
      ? { kind: "audius" as const, trackId: input.trim() }
      : {
          kind: "podcast" as const,
          feedUrl: input.trim(),
          guid: episode?.guid ?? pickedGuid,
        };
  async function prepare() {
    setPending(true);
    setFault(null);
    try {
      if (kind === "podcast" && !episode && !pickedGuid)
        throw Error("Choose an episode first.");
      const id = await start({ source: source() });
      setAssetId(id);
      setMixId(null);
      setOriginal(false);
    } catch (e) {
      setFault(e instanceof Error ? e.message : "Could not prepare recording.");
    } finally {
      setPending(false);
    }
  }
  async function render() {
    if (!assetId) return;
    setPending(true);
    setFault(null);
    try {
      const id = await requestMix({ assetId, words });
      setMixId(id);
      setOriginal(false);
    } catch (e) {
      setFault(e instanceof Error ? e.message : "Could not render mix.");
    } finally {
      setPending(false);
    }
  }
  const fieldStyle = {
    color: t.text,
    fontFamily: fonts.regular,
    borderWidth: 1,
    borderColor: t.border,
    borderRadius: 12,
    padding: 14,
    minHeight: 48,
  };
  const panel = {
    gap: 14,
    paddingVertical: 22,
    borderBottomWidth: 1,
    borderColor: t.border,
  };
  return (
    <View style={{ maxWidth: 760, width: "100%", alignSelf: "center", gap: 8 }}>
      <Button secondary onPress={() => router.push("/listen")}>
        Back to Listen
      </Button>
      <Title>Prepare a filtered recording.</Title>
      <Label muted>
        Music keeps its accompaniment. Podcasts use short silences. Both keep
        the recording’s timing.
      </Label>
      {!isAuthenticated && (
        <Label style={{ color: t.danger }}>
          Sign in through your account to prepare and render audio.
        </Label>
      )}
      <View style={panel}>
        <View style={{ flexDirection: "row", gap: 10 }}>
          {(["music", "podcast"] as const).map((k) => (
            <Chip
              key={k}
              selected={kind === k}
              onPress={() => {
                setKind(k);
                setInput(k === "music" ? "m7AlvqA" : "");
                setEpisodes([]);
                setEpisode(null);
                setPickedGuid("");
                setAssetId(null);
                setMixId(null);
                player.current?.pause();
              }}
            >
              {k === "music" ? "Music" : "Podcasts"}
            </Chip>
          ))}
        </View>
        <Label bold>{pickedGuid ? params.title : null}</Label>
        <Label bold>
          {kind === "music" ? "Audius track ID" : "Podcast RSS feed URL"}
        </Label>
        <TextInput
          accessibilityLabel={
            kind === "music" ? "Audius track ID" : "Podcast RSS feed URL"
          }
          value={input}
          onChangeText={(value) => {
            setInput(value);
            setEpisodes([]);
            setEpisode(null);
            setPickedGuid("");
          }}
          autoCapitalize="none"
          style={fieldStyle}
        />
        {kind === "podcast" && (
          <>
            <Button
              secondary
              disabled={!input.trim() || pending}
              onPress={async () => {
                setPending(true);
                setFault(null);
                try {
                  const feed = await getEpisodes({ feedUrl: input.trim() });
                  setEpisodes(feed.episodes);
                } catch (e) {
                  setFault(
                    e instanceof Error ? e.message : "Could not load feed.",
                  );
                } finally {
                  setPending(false);
                }
              }}
            >
              Load episodes
            </Button>
            {episodes.slice(0, 12).map((e) => (
              <Chip
                key={e.guid}
                selected={episode?.guid === e.guid}
                onPress={() => setEpisode(e)}
              >
                {e.title}
              </Chip>
            ))}
          </>
        )}
        <Button
          disabled={
            !isAuthenticated ||
            pending ||
            !input.trim() ||
            (kind === "podcast" && !episode && !pickedGuid)
          }
          onPress={prepare}
        >
          {asset?.stage === "failed"
            ? "Retry preparation"
            : "Prepare recording"}
        </Button>
        <Label muted>
          {kind === "podcast"
            ? "Long episodes are prepared as a preview of the first 30 minutes. The rest of the episode is not processed."
            : "Music recordings can be up to 30 minutes and 24 MiB."}{" "}
          Saved recordings and word lists are scoped to your account.
        </Label>
      </View>
      {(fault || asset?.error || mix?.error) && (
        <Label accessibilityLiveRegion="polite" style={{ color: t.danger }}>
          {fault ?? mix?.error ?? asset?.error}
        </Label>
      )}
      {asset && (
        <View style={panel}>
          <Label bold size={20}>
            {asset.title ?? "Your recording"}
          </Label>
          {asset.isPreview && (
            <Label bold>
              First 30 minutes only · full episode{" "}
              {clock(asset.sourceDurationMs ?? 0)}
            </Label>
          )}
          <Label bold accessibilityLiveRegion="polite">
            {labels[asset.stage] ?? asset.stage}
          </Label>
          <Label muted>
            {asset.stage === "failed"
              ? "Preparation has stopped. Retry preparation to continue."
              : asset.stage === "separating"
                ? "A GPU is extracting aligned vocals and accompaniment."
                : asset.stage === "transcribing"
                  ? "The saved vocal stem (music) or recording (podcast) is being transcribed."
                  : asset.stage === "review"
                    ? "Your saved recording and timestamps are ready. Choose the words to remove."
                    : "Preparation continues if you leave this screen."}
          </Label>
          {asset.stage === "review" && (
            <>
              <Chip
                selected={profanity}
                onPress={() => setProfanity(!profanity)}
              >
                Use the test profanity list
              </Chip>
              <Label bold>Also remove these words</Label>
              <TextInput
                accessibilityLabel="Custom words to mute"
                value={custom}
                onChangeText={setCustom}
                placeholder="Comma-separated words"
                placeholderTextColor={t.muted}
                style={fieldStyle}
              />
              <Label muted>
                {plan?.matches.length ?? 0} recognized occurrences selected.
                Transcription can miss words; listen to review the results.
              </Label>
              {plan?.matches.slice(0, 30).map((word, i) => (
                <Label key={i}>
                  {word.text} · {clock(word.startMs)}–{clock(word.endMs)}
                </Label>
              ))}
              <Button disabled={!canRender} onPress={render}>
                {mix?.stage === "failed"
                  ? "Retry render"
                  : changed
                    ? "Render updated word list"
                    : "Render filtered recording"}
              </Button>
            </>
          )}
        </View>
      )}
      {mix && (
        <View style={panel}>
          <Label bold size={20}>
            {mix.stage === "ready"
              ? "Ready to listen"
              : mix.stage === "failed"
                ? "Rendering stopped"
                : "Preparing your mix"}
          </Label>
          <Label muted>
            {mix.stage === "ready"
              ? "This MP3 is saved. Requesting the same settings reuses it."
              : mix.stage === "rendering"
                ? "Editing selected intervals and encoding one MP3. Your original remains saved."
                : "Waiting for the render worker."}
          </Label>
          {changed && (
            <Label style={{ color: t.danger }}>
              Your word list has changed. The player still uses the previous
              rendered settings until you render again.
            </Label>
          )}
          {mix.stage === "ready" && (
            <>
              <View style={{ flexDirection: "row", gap: 10 }}>
                <Chip selected={!original} onPress={() => compare(false)}>
                  Filtered recording
                </Chip>
                <Chip selected={original} onPress={() => compare(true)}>
                  {asset?.isPreview
                    ? "Unfiltered preview"
                    : "Original recording"}
                </Chip>
              </View>
              {Platform.OS === "web" &&
                url &&
                React.createElement("audio", {
                  src: url,
                  controls: true,
                  preload: "metadata",
                  ref: assignPlayer,
                  style: { width: "100%" },
                  onEmptied: () => {
                    setPlaying(false);
                    setPosition(0);
                  },
                  onLoadedMetadata: () => {
                    if (player.current) {
                      player.current.currentTime = Math.min(
                        resumePosition.current,
                        Math.max(0, player.current.duration - 0.05),
                      );
                      resumePosition.current = 0;
                      if (resumePlayback.current) {
                        resumePlayback.current = false;
                        void player.current
                          .play()
                          .catch(() =>
                            setFault("Tap Play to start listening."),
                          );
                      }
                    }
                  },
                  onPlay: () => {
                    lane.pause();
                    void spotify.service?.pause().catch(() => {});
                    setPlaying(true);
                  },
                  onPause: () => setPlaying(false),
                  onTimeUpdate: () =>
                    setPosition((player.current?.currentTime ?? 0) * 1000),
                  onError: () =>
                    setFault(
                      "Audio could not load. Request this mix again to refresh the playback link.",
                    ),
                })}
              <Label accessibilityLiveRegion="polite">
                {original
                  ? asset?.isPreview
                    ? "Unfiltered preview"
                    : "Original audio"
                  : playing
                    ? mix.intervals.some(
                        (i) =>
                          position >= i.start * 1000 && position < i.end * 1000,
                      )
                      ? asset?.kind === "music"
                        ? "Selected vocals muted; accompaniment continues."
                        : "Selected word muted; playback continues."
                      : "Playing your filtered recording."
                    : "Paused · tap Play to listen"}
              </Label>
              {mix.matches.slice(0, 60).map((word, i) => (
                <Button
                  key={i}
                  secondary
                  onPress={() => {
                    if (player.current) {
                      player.current.currentTime = Math.max(
                        0,
                        word.startMs / 1000 - 2,
                      );
                      void player.current
                        .play()
                        .catch(() => setFault("Tap Play to start listening."));
                    }
                  }}
                >
                  {word.text} · {clock(word.startMs)} · Replay
                </Button>
              ))}
              {mix.matches.length === 0 && (
                <Label muted>
                  No recognized words matched. This mix contains no word edits.
                </Label>
              )}
            </>
          )}
        </View>
      )}
      {asset && (
        <View style={panel}>
          <Label bold>Measured work for this recording</Label>
          {Object.entries(asset.timings).map(([name, s]) => (
            <Label key={name} muted>
              {name.replaceAll("_", " ")} · {s.toFixed(2)} s
            </Label>
          ))}
          {mix &&
            Object.entries(mix.timings).map(([name, s]) => (
              <Label key={name} muted>
                {name.replaceAll("_", " ")} · {s.toFixed(2)} s
              </Label>
            ))}
          <Label muted>
            These are historical completed-job timings. Reusing a cached
            recording or mix does not repeat that work. Cold starts and
            transfers appear in request timings.
          </Label>
        </View>
      )}
      <Label muted>
        Word muting only. Topic classification, section skipping, automatic
        subscriptions and native background playback are separate features.
        Music separation may leave faint vocal leakage or affect overlapping
        voices.
      </Label>
    </View>
  );
}
export default function PrepareScreen() {
  return accountConfigured ? (
    <Preparation />
  ) : (
    <View>
      <Title>Connect your account</Title>
      <Label>
        Configure the Convex account connection to prepare recordings.
      </Label>
    </View>
  );
}
