import React from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import { useSpotify } from "../services/spotify/use-spotify";
import { useSpotifyPlayer } from "../services/spotify/player-provider";
import { useAudioLane } from "../services/audio/audio-lane-provider";
import { audioTitleFor } from "../services/audio/approvals";
import { readRecent } from "../services/recently-played";
import { time } from "../data/defaults";
import { Button, Group, Label, ListRow, Notice, Title } from "../ui/components";
export default function Activity() {
  const live = useSpotifyPlayer();
  const audio = useAudioLane();
  const spotify = useSpotify();
  const router = useRouter();
  const recents = readRecent(spotify.accountId ?? "anonymous");
  const nameFor = (uri: string) => {
    if (live.snapshot.track?.uri === uri) return live.snapshot.track.name;
    if (audio.sourceKey === uri && audio.meta) return audio.meta.title;
    if (uri.startsWith("aud:") || uri.startsWith("pod:")) {
      return audioTitleFor(uri)?.title ?? uri;
    }
    return recents.find((item) => item.uri === uri)?.name ?? "Spotify track";
  };
  const events = [...live.filterEvents, ...audio.filterEvents]
    .sort((a, b) => b.at - a.at)
    .slice(0, 50);
  const describe = (kind: "seek" | "stop" | "mute", startMs: number, endMs: number) =>
    kind === "stop"
      ? "Stopped playback"
      : kind === "mute"
        ? `Muted ${time(startMs)} → ${time(endMs)}`
        : `Skipped section ${time(startMs)} → ${time(endMs)}`;
  return (
    <View>
      <Title>What changed.</Title>
      <Label muted>
        Commands sent to a player while filtering was on.
      </Label>
      {events.length ? (
        <>
          <Group>
            {events.map((event, index) => (
              <ListRow
                key={`${event.trackUri}:${event.startMs}:${index}`}
                title={describe(event.kind, event.startMs, event.endMs)}
                description={`${event.reason} · ${nameFor(event.trackUri)} · ${new Date(event.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`}
                last={index === events.length - 1}
              />
            ))}
          </Group>
          <View style={{ alignSelf: "flex-start", marginBottom: 24 }}>
            <Button secondary onPress={() => {live.clearFilterEvents();audio.clearFilterEvents();}}>
              Clear activity
            </Button>
          </View>
        </>
      ) : (
        <View style={{ paddingVertical: 50 }}>
          <Label size={18} bold>
            No filtering actions yet.
          </Label>
          <Label muted style={{ marginTop: 8 }}>
            Enable filtering in Now Playing during Spotify playback, or filter
            a track or episode in Listen. Commands the app sends will appear
            here.
          </Label>
          <View style={{ marginTop: 16, alignSelf: "flex-start" }}>
            <Button secondary onPress={() => router.navigate("/")}>
              Open Now Playing
            </Button>
          </View>
        </View>
      )}
      <Notice>
        <Label size={12}>
          These are commands the app sent to a player this session, not a
          verified count of words blocked. Detection can miss content; Audio
          Angel does not read or analyze Spotify audio.
        </Label>
      </Notice>
    </View>
  );
}
