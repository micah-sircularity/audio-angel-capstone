import React, { useEffect, useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSpotify } from "../services/spotify/use-spotify";
import { useSpotifyPlayer } from "../services/spotify/player-provider";
import { useRecentlyPlayed, relativeTime } from "../services/recently-played";
import { LivePlayer, PlayerStatus } from "../ui/live-player";
import { DemoPlayer } from "../ui/demo-player";
import { Button, Label, Notice, Row } from "../ui/components";
import { Image, Pressable, View } from "react-native";
import { IconMusic } from "../ui/icons";
import { useTheme } from "../ui/theme";

export default function NowPlaying() {
  const spotify = useSpotify();
  const live = useSpotifyPlayer();
  const router = useRouter();
  const t = useTheme();
  const params = useLocalSearchParams<{ uri?: string }>();
  const recent = useRecentlyPlayed(live.snapshot, spotify.accountId);
  const [showAll, setShowAll] = useState(false);
  const [now] = useState(() => Date.now());
  const uri = typeof params.uri === "string" && /^spotify:(track|episode):[A-Za-z0-9]{22}$/.test(params.uri) ? params.uri : null;
  // Honor ?uri= once: start playback, then clear the param so remounts and back don't replay it.
  useEffect(() => {
    if (uri && live.service && live.snapshot.status === "ready") {
      live.startPlayback(uri);
      router.setParams({ uri: undefined });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uri, live.service, live.snapshot.status]);

  if (!spotify.playbackAuthorized) {
    return (
      <View style={{ gap: 16 }}>
        <DemoPlayer />
        <Notice>
          <Label size={12}>
            {spotify.status === "connected"
              ? "Your Spotify connection predates playback access. Reconnect from Settings to allow live playback."
              : "Connect Spotify from Settings before testing playback."}
          </Label>
        </Notice>
        <Button secondary onPress={() => router.navigate("/settings")}>Open Settings</Button>
        <Label muted size={12}>Spotify playback is a separate experimental flow.</Label>
      </View>
    );
  }
  const recentItems = (showAll ? recent.items : recent.items.slice(0, 6));
  return (
    <View style={{ maxWidth: 640, alignSelf: "center", width: "100%", gap: 16 }}>
      {live.snapshot.track ? (
        <LivePlayer />
      ) : (
        <View style={{ gap: 12 }}>
          {uri && live.snapshot.status !== "ready" && <Label muted size={12}>Waiting for the Spotify player to connect before playing…</Label>}
          <PlayerStatus />
          {live.pendingPlay?.error ? (
            <Notice>
              <Label size={12}>{live.pendingPlay.error}</Label>
              <View style={{ marginTop: 12 }}>
                <Button secondary onPress={() => live.startPlayback(live.pendingPlay!.uri)}>Try again</Button>
              </View>
            </Notice>
          ) : live.pendingPlay ? (
            <Label muted>Starting playback…</Label>
          ) : null}
          {live.snapshot.needsUserGesture && (
            <Button onPress={() => live.service && live.snapshot.track ? void live.service.resume() : live.pendingPlay ? live.startPlayback(live.pendingPlay.uri) : undefined}>
              Tap to start playback
            </Button>
          )}
          {!live.pendingPlay && !live.snapshot.error && !live.snapshot.needsUserGesture && live.snapshot.status === "ready" && !live.connectionError && <Label bold size={20}>Nothing playing</Label>}
          <Label muted size={12}>Pick something from Search or your Library, or replay something recent.</Label>
          <Row style={{ gap: 8 }}>
            <Button secondary onPress={() => router.navigate("/search")}>Search</Button>
            <Button secondary onPress={() => router.navigate("/library")}>Library</Button>
          </Row>
        </View>
      )}
      <View style={{ gap: 8 }}>
        <Row>
          <Label bold size={18}>Recently played</Label>
          {recent.items.length > 0 && <Button secondary onPress={recent.clear}>Clear</Button>}
        </Row>
        {recent.items.length === 0 ? (
          <Label muted size={12}>Songs and episodes you play here will show up here.</Label>
        ) : (
          <>
            {recentItems.map((item) => (
              <Pressable key={item.uri} accessibilityRole="button" accessibilityLabel={`Play ${item.name}`}
                onPress={() => {
                  if(live.service&&live.snapshot.status==="ready") live.startPlayback(item.uri);
                  else router.navigate({ pathname: "/", params: { uri: item.uri } });
                }}
                style={({ pressed }) => ({ minHeight: 56, opacity: pressed ? 0.65 : 1 })}>
                <Row>
                  {item.imageUrl ? (
                    <Image source={{ uri: item.imageUrl }} style={{ width: 48, height: 48, borderRadius: 6 }} />
                  ) : (
                    <View style={{ width: 48, height: 48, backgroundColor: t.grouped, borderRadius: 6, alignItems: "center", justifyContent: "center" }}>
                      <IconMusic size={20} color={t.muted} />
                    </View>
                  )}
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Label bold>{item.name}</Label>
                    <Label muted size={12}>{item.subtitle}</Label>
                  </View>
                  <Label muted size={11}>{relativeTime(item.playedAt, now)}</Label>
                </Row>
              </Pressable>
            ))}
            {recent.items.length > 6 && (
              <Button secondary onPress={() => setShowAll(!showAll)}>
                {showAll ? "Show less" : "Show all"}
              </Button>
            )}
          </>
        )}
      </View>
      <Row style={{ gap: 8 }}>
        <Button secondary onPress={() => router.navigate("/search")}>Search</Button>
        <Button secondary onPress={() => router.navigate("/library")}>Library</Button>
      </Row>
    </View>
  );
}
