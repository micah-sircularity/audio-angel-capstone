import React, { useMemo, useState } from "react";
import { Linking, Pressable, View } from "react-native";
import type { LyricsLookupState } from "../services/use-track-lyrics";
import type { TranscriptLookupState } from "../services/use-track-transcript";
import { useTheme } from "./theme";
import { Button, Label, Notice, Row } from "./components";
import { time } from "../data/demo";

type TimedSpan = {
  startMs: number;
  endMs: number;
  text: string;
};

type PanelLookup = {
  request: object | null;
  data: { status: string; spans?: readonly TimedSpan[]; durationDeltaMs?: number | null; episode?: { transcriptOrigin?: string | null } | null } | null;
  status: "idle" | "loading" | "ready" | "error";
  error: string | null;
  retry: () => void;
};

type PanelCopy = {
  title: string;
  disclaimer: string;
  loading: string;
  retryLabel: string;
  empty: string;
  statusText: Record<string, string>;
  beginsAt: string;
  attribution: string;
  attributionUrl: string;
};

const formatDelta = (deltaMs: number) => {
  const total = Math.round(Math.abs(deltaMs) / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
};

/**
 * Shared timing-inspection panel for LRCLIB lyrics and Taddy transcripts.
 * Lookups run only on track identity/duration changes — never on position
 * ticks or pause/resume.
 */
function TimedSpanPanel({
  lookup,
  copy,
  positionMs,
  onSeek,
}: {
  lookup: PanelLookup;
  copy: PanelCopy;
  positionMs: number;
  onSeek?: (positionMs: number) => void;
}) {
  const t = useTheme();
  const {request,data:result,error,retry}=lookup;
  const key = request ? JSON.stringify(request) : "";
  const [showAll,setShowAll]=useState(false);
  const [seenKey,setSeenKey]=useState(key);
  if(seenKey!==key) {setSeenKey(key);setShowAll(false);}
  const spans = useMemo(
    () => (result?.status === "synced" ? (result.spans ?? []) : []),
    [result],
  );
  const current = useMemo(() => {
    let index = -1;
    for (let i = 0; i < spans.length; i++)
      if (spans[i].startMs <= positionMs) index = i;
    return index;
  }, [spans, positionMs]);
  const window = useMemo(() => {
    if (showAll) return spans.map((_, i) => i);
    const anchor = current < 0 ? 0 : current;
    const start = Math.max(0, Math.min(anchor - 2, spans.length - 5));
    return spans.map((_, i) => i).slice(start, start + 5);
  }, [spans, current, showAll]);
  const statusText = result ? copy.statusText[result.status] : undefined;
  return (
    <Notice>
      <Row>
        <Label bold size={20}>
          {copy.title}
        </Label>
        <Label muted size={11}>
          {spans.length ? `${spans.length} lines` : ""}
        </Label>
      </Row>
      <Label muted size={11} style={{ marginTop: 4 }}>
        {copy.disclaimer}
      </Label>
      <View style={{ marginTop: 12, gap: 10 }}>
        {!request && (
          <Label muted size={12}>
            {copy.empty}
          </Label>
        )}
        {request && lookup.status === "loading" && (
          <Label muted size={12}>
            {copy.loading}
          </Label>
        )}
        {lookup.status === "error" && (
          <>
            <Label size={12}>{error}</Label>
            <Button secondary onPress={retry}>
              {copy.retryLabel}
            </Button>
          </>
        )}
        {statusText && (
          <Label muted size={12}>
            {statusText}
          </Label>
        )}
        {result && result.status === "synced" && (
          <>
            {onSeek && <Label muted size={12}>Tap a line to play from there.</Label>}
            {result.durationDeltaMs != null && Math.abs(result.durationDeltaMs) > 2000 && (
              <Label muted size={12}>
                This episode&apos;s length differs from the transcript&apos;s
                audio by {formatDelta(result.durationDeltaMs)} — ads may shift
                timing.
              </Label>
            )}
            {current < 0 && (
              <Label muted size={12}>
                {copy.beginsAt} {time(spans[0].startMs)}.
              </Label>
            )}
            <View style={{ gap: 8, paddingVertical: 8 }}>
              {window.map((i) => {
                const span = spans[i];
                const active = i === current;
                return (
                  <Pressable
                    key={i}
                    accessibilityRole={onSeek ? "button" : undefined}
                    accessibilityLabel={`Seek to ${time(span.startMs)}: ${span.text || "No text"}`}
                    accessibilityState={{ selected: active, disabled: !onSeek }}
                    disabled={!onSeek}
                    onPress={() => onSeek?.(span.startMs)}
                    style={({ pressed }) => ({
                      minHeight: 44,
                      paddingVertical: 7,
                      opacity: pressed ? 0.65 : 1,
                    })}
                  >
                    <Label
                      size={24}
                      bold
                      style={{ color: active ? t.primary : t.muted, lineHeight: 32, letterSpacing: -0.4 }}
                    >
                      {span.text.trim() ? span.text : "No text for this cue"}
                    </Label>
                    {active && <Label muted size={11}>{time(span.startMs)} · Current line</Label>}
                  </Pressable>
                );
              })}
            </View>
            {spans.length > 5 && (
              <Button secondary onPress={() => setShowAll(!showAll)}>
                {showAll ? "Show current lines" : `Read all ${spans.length} lines`}
              </Button>
            )}
          </>
        )}
        <Pressable accessibilityRole="link" onPress={() => void Linking.openURL(copy.attributionUrl)} style={{ minHeight: 44, justifyContent: "center" }}>
          <Label muted size={12}>{copy.attribution}</Label>
        </Pressable>
      </View>
    </Notice>
  );
}

export function LyricsPanel({
  lookup,
  filtering = false,
  positionMs,
  onSeek,
}: {
  lookup: LyricsLookupState;
  filtering?: boolean;
  positionMs: number;
  onSeek?: (positionMs: number) => void;
}) {
  return (
    <TimedSpanPanel
      lookup={lookup}
      positionMs={positionMs}
      onSeek={onSeek}
      copy={{
        title: "Lyrics",
        disclaimer: `Line timing · End times estimated · ${filtering ? "Timed filtering enabled" : "Filtering off"}`,
        loading: "Looking up lyrics…",
        retryLabel: "Retry lyrics",
        empty: "No song is playing. Lyrics appear after a track starts.",
        statusText: {
          "not-found":
            "No synced lyrics were found for this track. This does not mean it is clean.",
          unsynced:
            "No usable synced lyrics are available for this recording. This does not mean the track is clean.",
          instrumental:
            "LRCLIB marks this recording as instrumental. That is not a filtering verdict.",
        },
        beginsAt: "Lyrics begin at",
        attribution: "Lyrics from LRCLIB",
        attributionUrl: "https://lrclib.net",
      }}
    />
  );
}

export function TranscriptPanel({
  lookup,
  positionMs,
  onSeek,
}: {
  lookup: TranscriptLookupState;
  positionMs: number;
  onSeek?: (positionMs: number) => void;
}) {
  const origin = lookup.data?.status === "synced" ? lookup.data.episode?.transcriptOrigin : null;
  return (
    <TimedSpanPanel
      lookup={lookup}
      positionMs={positionMs}
      onSeek={onSeek}
      copy={{
        title: "Transcript (preview)",
        disclaimer: "Line-level timing. Filtering is off for podcasts.",
        loading: "Looking up the transcript…",
        retryLabel: "Retry transcript",
        empty: "No episode is playing. Transcripts appear after an episode starts.",
        statusText: {
          "not-found": "No matching episode found in Taddy.",
          "no-transcript": "No transcript available for this episode.",
          "requires-upgrade":
            "This episode's transcript needs a Taddy Pro plan.",
        },
        beginsAt: "Transcript begins at",
        attribution:
          origin === "publisher"
            ? "Transcript via Taddy · from the publisher"
            : origin === "taddy"
              ? "Transcript via Taddy · generated by Taddy"
              : "Transcript via Taddy",
        attributionUrl: "https://taddy.org",
      }}
    />
  );
}
