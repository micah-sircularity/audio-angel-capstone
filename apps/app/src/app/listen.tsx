import { TactilePressable } from "../ui/tactile-pressable";
import React, { useEffect, useState } from "react";
import { Image, Platform, Pressable, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useAction, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "../../../../convex/_generated/api";
import type { AudioFlag } from "@audio-angel/filters/audio-plan";
import {
  Button,
  Chip,
  Field,
  Group,
  IconButton,
  Label,
  Notice,
  Row,
  Title,
  Toggle,
} from "../ui/components";
import {
  IconChevronDown,
  IconChevronRight,
  IconHeadphones,
  IconMusic,
  IconPlayerPause,
  IconPlayerPlay,
} from "../ui/icons";
import { useTheme, fonts } from "../ui/theme";
import {
  useAudioLane,
  type AudioMeta,
} from "../services/audio/audio-lane-provider";
import { audioTitleFor } from "../services/audio/approvals";
import { accountConfigured } from "../services/account";
import { time } from "../data/defaults";

type AudiusResult = FunctionReturnType<typeof api.listen.searchAudius>[number];
type PodcastResult = FunctionReturnType<
  typeof api.listen.searchPodcasts
>[number];
type FeedResult = FunctionReturnType<typeof api.listen.listEpisodes>;
type EpisodeResult = FeedResult["episodes"][number];

const SOURCE_PARAM = /^(aud:[A-Za-z0-9_-]{1,80}|pod:[a-f0-9]{32})$/;

/** Returns the segment text trimmed to ~`max` chars centered on the match, in display coords. */
function excerpt(text: string, match: string, max = 120) {
  let shown = text;
  if (shown.length > max) {
    const hit = shown.toLowerCase().indexOf(match.toLowerCase());
    const start = Math.max(
      0,
      Math.min(shown.length - max, (hit < 0 ? 0 : hit) - 24),
    );
    shown = `${start > 0 ? "…" : ""}${shown.slice(start, start + max)}${start + max < text.length ? "…" : ""}`;
  }
  const at = shown.toLowerCase().indexOf(match.toLowerCase());
  return {
    before: at < 0 ? shown : shown.slice(0, at),
    match: at < 0 ? "" : shown.slice(at, at + match.length),
    after: at < 0 ? "" : shown.slice(at + match.length),
  };
}

function SeparationTestLink() {
  const router = useRouter();
  return (
    <View style={{ gap: 10 }}>
      <Button onPress={() => router.push("/prepare")}>
        Prepare music or a podcast
      </Button>
      <Button
        secondary
        onPress={() => window.location.assign("/spleeter-test.html")}
      >
        Try the vocal muting listening test
      </Button>
    </View>
  );
}

function FlagBadge({ label }: { label: string }) {
  const t = useTheme();
  return (
    <Label
      size={10}
      style={{
        borderWidth: 1,
        borderColor: t.primary,
        color: t.primary,
        paddingHorizontal: 7,
        paddingVertical: 2,
        borderRadius: 5,
      }}
    >
      {label}
    </Label>
  );
}

function FlagRow({
  flag,
  filtered,
  onChange,
  last,
}: {
  flag: AudioFlag;
  filtered: boolean;
  onChange: (value: boolean) => void;
  last: boolean;
}) {
  const t = useTheme();
  const parts = excerpt(flag.segmentText, flag.matchedText);
  return (
    <Row
      style={{
        minHeight: 64,
        paddingVertical: 12,
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: t.border,
        alignItems: "flex-start",
        gap: 12,
      }}
    >
      <Label muted size={11} style={{ width: 40, paddingTop: 3 }}>
        {time(flag.startMs)}
      </Label>
      <View style={{ flex: 1, minWidth: 0, gap: 5 }}>
        <Text
          style={{
            color: t.text,
            fontFamily: fonts.regular,
            fontSize: 13,
            lineHeight: 19,
          }}
        >
          {parts.before}
          {parts.match ? (
            <Text style={{ fontFamily: fonts.bold }}>{parts.match}</Text>
          ) : null}
          {parts.after}
        </Text>
        <Row style={{ justifyContent: "flex-start", gap: 8 }}>
          <FlagBadge label={flag.ruleLabel} />
          {flag.probability !== null && (
            <Label muted size={11}>
              {Math.round(flag.probability * 100)}% match
            </Label>
          )}
        </Row>
      </View>
      <Toggle
        label={`Filter line at ${time(flag.startMs)}`}
        value={filtered}
        onChange={onChange}
      />
    </Row>
  );
}

function ResultRow({
  artworkUrl,
  title,
  subtitle,
  durationMs,
  selected,
  affordance,
  onPress,
  icon,
}: {
  artworkUrl?: string | null;
  title: string;
  subtitle: string;
  durationMs?: number | null;
  selected?: boolean;
  affordance: "play" | "expand" | "expanded";
  onPress: () => void;
  icon?: "music" | "headphones";
}) {
  const t = useTheme();
  const Icon = icon === "headphones" ? IconHeadphones : IconMusic;
  return (
    <TactilePressable
      feedback="highlight"
      accessibilityRole="button"
      accessibilityLabel={`${affordance === "play" ? "Play" : "Open"} ${title}`}
      onPress={onPress}
      style={{
        minHeight: 64,
        paddingVertical: 10,
        borderBottomWidth: 1,
        borderBottomColor: t.border,
      }}
    >
      <Row>
        {artworkUrl ? (
          <Image
            source={{ uri: artworkUrl }}
            accessibilityLabel={`Artwork for ${title}`}
            style={{ width: 44, height: 44, borderRadius: 6 }}
          />
        ) : (
          <View
            style={{
              width: 44,
              height: 44,
              borderRadius: 6,
              backgroundColor: t.grouped,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Icon size={20} color={t.muted} />
          </View>
        )}
        <View style={{ flex: 1, minWidth: 0 }}>
          <Label bold>{title}</Label>
          <Label muted size={12}>
            {subtitle}
          </Label>
        </View>
        {durationMs ? (
          <Label muted size={11}>
            {time(durationMs)}
          </Label>
        ) : null}
        {selected ? (
          <FlagBadge label="SELECTED" />
        ) : affordance === "play" ? (
          <IconPlayerPlay size={20} color={t.text} />
        ) : affordance === "expanded" ? (
          <IconChevronDown size={20} color={t.muted} />
        ) : (
          <IconChevronRight size={20} color={t.muted} />
        )}
      </Row>
    </TactilePressable>
  );
}

function ListenScreen() {
  const t = useTheme();
  const lane = useAudioLane();
  const router = useRouter();
  const params = useLocalSearchParams<{ source?: string }>();
  const searchAudius = useAction(api.listen.searchAudius);
  const searchPodcasts = useAction(api.listen.searchPodcasts);
  const listEpisodes = useAction(api.listen.listEpisodes);

  const deepKey =
    typeof params.source === "string" && SOURCE_PARAM.test(params.source)
      ? params.source
      : null;
  const [deepHandled, setDeepHandled] = useState<string | null>(null);
  const deepStatus = useQuery(
    api.listen.status,
    deepKey && deepHandled !== deepKey ? { sourceKey: deepKey } : "skip",
  );

  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<"music" | "podcasts">("music");
  // Empty music query = Audius trending, loaded on first view.
  const [submitted, setSubmitted] = useState<{
    q: string;
    mode: "music" | "podcasts";
    retry: number;
  } | null>({ q: "", mode: "music", retry: 0 });
  const [tracks, setTracks] = useState<{
    key: string;
    items: AudiusResult[];
  } | null>(null);
  const [shows, setShows] = useState<{
    key: string;
    items: PodcastResult[];
  } | null>(null);
  const [searchError, setSearchError] = useState<{
    key: string;
    message: string;
  } | null>(null);
  const [expandedFeed, setExpandedFeed] = useState<string | null>(null);
  const [feedResult, setFeedResult] = useState<{
    feedUrl: string;
    data: FeedResult | null;
    error: string | null;
  } | null>(null);
  const [barWidth, setBarWidth] = useState(0);

  const searchKey = submitted ? JSON.stringify(submitted) : "";

  // Run the submitted search against the right action.
  useEffect(() => {
    if (!submitted) return;
    let active = true;
    const run = async () => {
      try {
        if (submitted.mode === "music") {
          const items = await searchAudius({ query: submitted.q });
          if (active) setTracks({ key: searchKey, items });
        } else {
          const items = await searchPodcasts({ query: submitted.q });
          if (active) setShows({ key: searchKey, items });
        }
      } catch (caught) {
        if (active)
          setSearchError({
            key: searchKey,
            message:
              caught instanceof Error
                ? caught.message
                : "Search failed. Try again.",
          });
      }
    };
    void run();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- searchKey captures the submitted tuple.
  }, [searchKey]);

  // Expand a podcast row into its episode list.
  useEffect(() => {
    if (!expandedFeed) return;
    let active = true;
    void listEpisodes({ feedUrl: expandedFeed })
      .then((data) => {
        if (active) setFeedResult({ feedUrl: expandedFeed, data, error: null });
      })
      .catch((caught: unknown) => {
        if (active)
          setFeedResult({
            feedUrl: expandedFeed,
            data: null,
            error:
              caught instanceof Error
                ? caught.message
                : "Episodes could not be loaded.",
          });
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expandedFeed]);

  // Honor ?source=aud:… / pod:… once, then clear the param.
  const applyDeepLink = (key: string) => {
    const finish = () => {
      setDeepHandled(key);
      router.setParams({ source: undefined });
    };
    if (key.startsWith("aud:")) {
      const source = deepStatus?.source;
      const saved = audioTitleFor(key);
      lane.pick(
        { kind: "audius", trackId: key.slice(4) },
        {
          title: source?.title ?? saved?.title ?? "Audius track",
          artist: source?.artist ?? saved?.artist ?? "Audius",
          artworkUrl: source?.artworkUrl ?? null,
          durationMs: source?.durationMs ?? null,
          sourceKey: key,
        },
      );
      finish();
      return;
    }
    const source = deepStatus?.source;
    if (source === null) {
      finish(); // unknown pod: key; nothing to pick
      return;
    }
    if (
      !source ||
      source.kind !== "podcast" ||
      !source.feedUrl ||
      !source.episodeGuid
    )
      return;
    lane.pick(
      { kind: "podcast", feedUrl: source.feedUrl, guid: source.episodeGuid },
      {
        title: source.title,
        artist: source.artist,
        artworkUrl: source.artworkUrl ?? null,
        durationMs: source.durationMs,
        enclosureUrl: source.enclosureUrl ?? null,
        sourceKey: key,
      },
    );
    finish();
  };
  useEffect(() => {
    if (deepKey && deepHandled !== deepKey) applyDeepLink(deepKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deepKey, deepHandled, deepStatus]);

  const submitSearch = (nextMode = mode) => {
    if (nextMode === "podcasts" && !query.trim()) return;
    setSubmitted({
      q: nextMode === "music" ? query : query.trim(),
      mode: nextMode,
      retry: (submitted?.retry ?? 0) + 1,
    });
  };

  const selectMode = (next: "music" | "podcasts") => {
    setMode(next);
    if (submitted && submitted.mode !== next)
      setSubmitted({ q: query, mode: next, retry: submitted.retry + 1 });
  };

  const pickTrack = (track: AudiusResult) => {
    lane.pick(
      { kind: "audius", trackId: track.trackId },
      {
        title: track.title,
        artist: track.artist,
        artworkUrl: track.artworkUrl ?? null,
        durationMs: track.durationMs,
        sourceKey: track.sourceKey,
      },
    );
  };

  const pickEpisode = (
    feedUrl: string,
    feed: FeedResult,
    episode: EpisodeResult,
  ) => {
    lane.pick({ kind: "podcast", feedUrl, guid: episode.guid }, {
      title: episode.title,
      artist: feed.title,
      artworkUrl: feed.imageUrl ?? null,
      durationMs: episode.durationMs,
      enclosureUrl: episode.enclosureUrl,
      sourceKey: episode.sourceKey,
    } satisfies AudioMeta);
  };

  const busySearch =
    submitted !== null &&
    (submitted.mode === "music" ? tracks?.key : shows?.key) !== searchKey &&
    searchError?.key !== searchKey;
  const jobLine = (() => {
    switch (lane.jobStatus) {
      case "queued":
      case "resolving":
        return "Finding audio…";
      case "transcribing":
        return "Listening to the audio…";
      case "classifying":
        return lane.progressTotal
          ? `Checking lines… ${lane.progressDone ?? 0}/${lane.progressTotal}`
          : "Checking lines…";
      default:
        return null;
    }
  })();
  const progress =
    lane.snapshot.durationMs > 0
      ? Math.min(
          100,
          (lane.snapshot.positionMs / lane.snapshot.durationMs) * 100,
        )
      : 0;
  const playable = lane.stage === "ready" || lane.stage === "playing";

  return (
    <View style={{ gap: 16 }}>
      <View>
        <Title>Listen.</Title>
        <Label muted size={12}>
          Audius tracks and podcasts with word-level filtering.
        </Label>
      </View>

      <SeparationTestLink />

      <Field
        value={query}
        onChangeText={setQuery}
        label="Search Audius or podcasts"
        placeholder={
          mode === "music"
            ? "Search Audius (empty = trending)"
            : "Search podcasts"
        }
        onSubmitEditing={() => submitSearch()}
      />
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        <Chip selected={mode === "music"} onPress={() => selectMode("music")}>
          Music
        </Chip>
        <Chip
          selected={mode === "podcasts"}
          onPress={() => selectMode("podcasts")}
        >
          Podcasts
        </Chip>
      </View>
      <Button
        disabled={mode === "podcasts" && !query.trim()}
        onPress={() => submitSearch()}
      >
        Search
      </Button>

      {searchError?.key === searchKey ? (
        <Notice>
          <Label size={12}>{searchError.message}</Label>
          <View style={{ marginTop: 12 }}>
            <Button
              secondary
              onPress={() =>
                setSubmitted((s) => (s ? { ...s, retry: s.retry + 1 } : s))
              }
            >
              Retry search
            </Button>
          </View>
        </Notice>
      ) : null}
      {busySearch && submitted ? (
        <Label muted size={12}>
          {submitted.q
            ? `Searching for “${submitted.q}”…`
            : "Loading trending Audius tracks…"}
        </Label>
      ) : null}

      {mode === "music" && tracks?.key === searchKey && (
        <View>
          {!submitted?.q ? (
            <Label muted size={12} style={{ marginBottom: 4 }}>
              Trending on Audius
            </Label>
          ) : null}
          {tracks.items.length === 0 ? (
            <Notice>
              <Label>No Audius results. Try a different search.</Label>
            </Notice>
          ) : (
            tracks.items.map((track) => (
              <View key={track.trackId}>
                <ResultRow
                  artworkUrl={track.artworkUrl}
                  title={track.title}
                  subtitle={track.artist}
                  durationMs={track.durationMs}
                  selected={lane.sourceKey === track.sourceKey}
                  affordance="play"
                  onPress={() => pickTrack(track)}
                />
                <Button
                  secondary
                  onPress={() =>
                    router.push({
                      pathname: "/prepare",
                      params: { trackId: track.trackId, title: track.title },
                    })
                  }
                >
                  Prepare word edits
                </Button>
              </View>
            ))
          )}
        </View>
      )}

      {mode === "podcasts" && shows?.key === searchKey && (
        <View>
          {shows.items.length === 0 ? (
            <Notice>
              <Label>No podcasts found. Try a different search.</Label>
            </Notice>
          ) : (
            shows.items.map((show) => (
              <View key={show.feedUrl}>
                <ResultRow
                  artworkUrl={show.artworkUrl}
                  title={show.name}
                  subtitle={show.author}
                  affordance={
                    expandedFeed === show.feedUrl ? "expanded" : "expand"
                  }
                  icon="headphones"
                  onPress={() =>
                    setExpandedFeed(
                      expandedFeed === show.feedUrl ? null : show.feedUrl,
                    )
                  }
                />
                {expandedFeed === show.feedUrl && (
                  <View
                    style={{
                      paddingLeft: 56,
                      borderBottomWidth: 1,
                      borderBottomColor: t.border,
                    }}
                  >
                    {(() => {
                      const feed =
                        feedResult?.feedUrl === show.feedUrl
                          ? feedResult
                          : null;
                      if (!feed || (!feed.data && !feed.error)) {
                        return (
                          <Label
                            muted
                            size={12}
                            style={{ paddingVertical: 12 }}
                          >
                            Loading episodes…
                          </Label>
                        );
                      }
                      if (feed.error || !feed.data) {
                        return (
                          <Label size={12} style={{ paddingVertical: 12 }}>
                            {feed.error ?? "Episodes could not be loaded."}
                          </Label>
                        );
                      }
                      const data = feed.data;
                      return data.episodes.map((episode) => (
                        <View key={episode.sourceKey}>
                          <ResultRow
                            title={episode.title}
                            subtitle={
                              episode.publishedAt
                                ? new Date(
                                    episode.publishedAt,
                                  ).toLocaleDateString()
                                : data.title
                            }
                            durationMs={episode.durationMs}
                            selected={lane.sourceKey === episode.sourceKey}
                            affordance="play"
                            onPress={() =>
                              pickEpisode(show.feedUrl, data, episode)
                            }
                          />
                          <Button
                            secondary
                            onPress={() =>
                              router.push({
                                pathname: "/prepare",
                                params: {
                                  feedUrl: show.feedUrl,
                                  guid: episode.guid,
                                  title: episode.title,
                                },
                              })
                            }
                          >
                            Prepare word edits
                          </Button>
                        </View>
                      ));
                    })()}
                  </View>
                )}
              </View>
            ))
          )}
        </View>
      )}

      {lane.meta && (
        <View
          style={{
            backgroundColor: t.card,
            borderWidth: 1,
            borderColor: t.border,
            borderRadius: 12,
            padding: 16,
            gap: 12,
          }}
        >
          <Row>
            {lane.meta.artworkUrl ? (
              <Image
                source={{ uri: lane.meta.artworkUrl }}
                accessibilityLabel={`Artwork for ${lane.meta.title}`}
                style={{ width: 56, height: 56, borderRadius: 8 }}
              />
            ) : (
              <View
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: 8,
                  backgroundColor: t.grouped,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <IconHeadphones size={24} color={t.muted} />
              </View>
            )}
            <View style={{ flex: 1, minWidth: 0 }}>
              <Label bold>{lane.meta.title}</Label>
              <Label muted size={12}>
                {lane.meta.artist}
              </Label>
            </View>
          </Row>

          {lane.jobStatus === "failed" ? (
            <Notice>
              <Label size={12}>
                {lane.jobError ?? "Processing failed for this source."}
              </Label>
              <View style={{ marginTop: 12 }}>
                <Button secondary onPress={lane.retryProcessing}>
                  Retry processing
                </Button>
              </View>
            </Notice>
          ) : jobLine ? (
            <Label muted size={12}>
              {jobLine}
            </Label>
          ) : null}

          {!lane.isAuthenticated && !lane.jobStatus && (
            <Notice>
              <Label size={12}>
                Sign in (Filtering tab uses your account) to enable filtering —
                or play unfiltered.
              </Label>
              <View style={{ marginTop: 12 }}>
                <Button secondary onPress={lane.playUnfiltered}>
                  Play unfiltered
                </Button>
              </View>
            </Notice>
          )}
          {playable && (
            <View style={{ gap: 10 }}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Seek"
                onPress={(event) => {
                  if (barWidth > 0 && lane.snapshot.durationMs > 0)
                    lane.seekTo(
                      (event.nativeEvent.locationX / barWidth) *
                        lane.snapshot.durationMs,
                    );
                }}
              >
                <View
                  onLayout={(event) =>
                    setBarWidth(event.nativeEvent.layout.width)
                  }
                  style={{ height: 20, justifyContent: "center" }}
                >
                  <View
                    style={{
                      height: 5,
                      backgroundColor: t.grouped,
                      borderRadius: 4,
                    }}
                  >
                    <View
                      style={{
                        width: `${progress}%`,
                        height: 5,
                        backgroundColor: t.primary,
                        borderRadius: 4,
                      }}
                    />
                  </View>
                </View>
              </Pressable>
              <Row style={{ marginTop: -4 }}>
                <Label size={11} muted>
                  {time(lane.snapshot.positionMs)}
                </Label>
                <Label size={11} muted>
                  -
                  {time(
                    Math.max(
                      0,
                      lane.snapshot.durationMs - lane.snapshot.positionMs,
                    ),
                  )}
                </Label>
              </Row>
              <Row style={{ justifyContent: "center" }}>
                <IconButton
                  prominent
                  icon={lane.snapshot.paused ? IconPlayerPlay : IconPlayerPause}
                  label={lane.snapshot.paused ? "Play" : "Pause"}
                  onPress={lane.snapshot.paused ? lane.play : lane.pause}
                />
              </Row>
              {lane.filtered && lane.mode === "gain" && (
                <Label muted size={11} style={{ textAlign: "center" }}>
                  Word muting
                </Label>
              )}
              {lane.filtered && lane.mode === "element-muted" && (
                <Label muted size={11} style={{ textAlign: "center" }}>
                  Full muting — this stream blocks word-level muting
                </Label>
              )}
            </View>
          )}

          {lane.snapshot.needsUserGesture && (
            <Button onPress={lane.play}>Tap to start playback</Button>
          )}
          {lane.snapshot.status === "connecting" && (
            <Label muted size={12}>
              Loading audio…
            </Label>
          )}
          {lane.snapshot.status === "error" && (
            <Notice>
              <Label size={12}>
                {lane.snapshot.error ??
                  "This audio could not be played. Try again."}
              </Label>
            </Notice>
          )}
          {(lane.fault || lane.warning || lane.snapshot.error) &&
            lane.snapshot.status !== "error" && (
              <Notice>
                <Label size={12}>
                  {lane.fault ?? lane.warning ?? lane.snapshot.error}
                </Label>
              </Notice>
            )}
        </View>
      )}

      {lane.stage === "review" && (
        <View style={{ gap: 12 }}>
          <Label bold size={18}>
            Review flagged lines.
          </Label>
          <Label muted size={12}>
            Everything checked is filtered out. Uncheck a line to keep it.
          </Label>
          <Group>
            {lane.flags.length === 0 ? (
              <Label muted style={{ paddingVertical: 16 }}>
                Nothing flagged for this profile.
              </Label>
            ) : (
              lane.flags.map((flag, index) => (
                <FlagRow
                  key={flag.flagId}
                  flag={flag}
                  filtered={lane.approvals[flag.flagId] !== false}
                  onChange={(value) => lane.setApproval(flag.flagId, value)}
                  last={index === lane.flags.length - 1}
                />
              ))
            )}
          </Group>
          <Row>
            <View style={{ flex: 1 }}>
              <Label bold>Skip review and filter automatically</Label>
              <Label muted size={12}>
                Applies stored choices next time and for new sources.
              </Label>
            </View>
            <Toggle
              label="Skip review and filter automatically"
              value={lane.autoFilterAll}
              onChange={lane.setAutoFilterAll}
            />
          </Row>
          <Label muted size={12}>
            {
              lane.flags.filter((flag) => lane.approvals[flag.flagId] !== false)
                .length
            }{" "}
            of {lane.flags.length} flagged{" "}
            {lane.flags.length === 1 ? "line" : "lines"} will be filtered.
          </Label>
          <Button onPress={lane.submitReview}>Play filtered</Button>
        </View>
      )}
    </View>
  );
}

export default function Listen() {
  if (Platform.OS !== "web") {
    return (
      <View style={{ gap: 16 }}>
        <Title>Listen.</Title>
        <Notice>
          <Label size={12}>The audio lane is web-only for now.</Label>
        </Notice>
      </View>
    );
  }
  if (!accountConfigured) {
    return (
      <View style={{ gap: 16 }}>
        <Title>Listen.</Title>
        <SeparationTestLink />
        <Notice>
          <Label size={12}>
            The audio lane needs the account backend, which is not configured in
            this build.
          </Label>
        </Notice>
      </View>
    );
  }
  return <ListenScreen />;
}
