import { TactilePressable } from "../ui/tactile-pressable";
import React, { useEffect, useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSpotify } from "../services/spotify/use-spotify";
import { useSpotifyPlayer } from "../services/spotify/player-provider";
import { useRecentlyPlayed, relativeTime } from "../services/recently-played";
import { LivePlayer, PlayerStatus } from "../ui/live-player";
import { Button, Label, Notice, Row, Title } from "../ui/components";
import { ActivityIndicator, Image, View } from "react-native";
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
    const checking = spotify.status === "connecting" || spotify.permissionsLoading;
    return (
      <View style={{ gap: 16, maxWidth: 640, alignSelf: "center", width: "100%" }}>
        <Title>Now playing.</Title>
        {!spotify.available ? (
          <Notice>
            <Label bold size={14}>Spotify playback runs in the web app</Label>
            <Label muted size={12} style={{ marginTop: 6 }}>
              Open Audio Angel in a browser to connect Spotify and listen.
              Filter profiles still work here and stay on this device.
            </Label>
          </Notice>
        ) : checking ? (
          <Notice>
            <Row style={{ justifyContent: "flex-start", gap: 12 }}>
              <ActivityIndicator color={t.primary} accessibilityLabel="Checking Spotify connection" />
              <Label size={13}>Checking your Spotify connection…</Label>
            </Row>
          </Notice>
        ) : spotify.status === "error" ? (
          <Notice>
            <Label bold size={14}>Spotify connection failed</Label>
            <Label muted size={12} style={{ marginTop: 6 }}>
              {spotify.error ?? "The connection could not be checked."}
            </Label>
          </Notice>
        ) : spotify.status === "connected" ? (
          <Notice>
            <Label bold size={14}>Playback permission needed</Label>
            <Label muted size={12} style={{ marginTop: 6 }}>
              Your Spotify connection predates playback access. Reconnect to
              allow listening here.
            </Label>
          </Notice>
        ) : (
          <Notice>
            <Label bold size={14}>Connect Spotify to start listening</Label>
            <Label muted size={12} style={{ marginTop: 6 }}>
              Playback and timed filtering need a Spotify account with
              Premium.
            </Label>
          </Notice>
        )}
        {!checking && (
          <Button onPress={() => router.navigate("/filtering")}>
            {spotify.status === "connected"
              ? "Reconnect in Filtering"
              : "Open Filtering"}
          </Button>
        )}
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
              <TactilePressable feedback="highlight" key={item.uri} accessibilityRole="button" accessibilityLabel={`Play ${item.name}`}
                onPress={() => {
                  if(live.service&&live.snapshot.status==="ready") live.startPlayback(item.uri);
                  else router.navigate({ pathname: "/", params: { uri: item.uri } });
                }}
                style={{ minHeight: 56 }}>
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
              </TactilePressable>
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
