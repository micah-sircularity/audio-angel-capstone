import React from "react";
import {
  Image,
  Pressable,
  ScrollView,
  View,
  useWindowDimensions,
  Platform,
} from "react-native";
import { Slot, usePathname, useRouter, type Href } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import {
  IconMusic,
  IconLibrary,
  IconShieldCheck,
  IconListDetails,
  IconSettings,
  IconArrowUpRight,
  IconPlayerPause,
  IconPlayerPlay,
  IconX,
} from "./icons";
import { BrandMark } from "./brand-mark";
import { useTheme } from "./theme";
import { Label, Row, IconButton, Artwork } from "./components";
import { useSpotifyPlayer } from "../services/spotify/player-provider";
import { useApp } from "../state/app-state";
const links = [
  { path: "/", label: "Now Playing", icon: IconMusic },
  { path: "/library", label: "Library", icon: IconLibrary },
  { path: "/profiles", label: "Profiles", icon: IconShieldCheck },
  { path: "/activity", label: "Activity", icon: IconListDetails },
  { path: "/settings", label: "Settings", icon: IconSettings },
];
export function Shell() {
  const t = useTheme();
  const state = useApp();
  const live = useSpotifyPlayer();
  const { width } = useWindowDimensions();
  const desktop = width >= 760;
  const path = usePathname();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const spotifyRoute = path === "/spotify";
  const libraryRoute = path === "/library" || path === "/search";
  const current = path === "/search" ? {label:"Search Spotify"} : spotifyRoute
    ? { label: "Spotify playback" }
    : path.startsWith("/auth/")
      ? { label: "Spotify sign-in" }
      : (links.find((l) => l.path === path) ?? links[0]);
  const nav = (mobile: boolean) =>
    links.map(({ path: target, label, icon: Icon }) => {
      const selected = path === target;
      return (
        <Pressable
          key={target}
          accessibilityRole="tab"
          accessibilityState={{ selected }}
          accessibilityLabel={label}
          onPress={() => router.navigate(target as Href)}
          style={({ pressed }) => ({
            flex: mobile ? 1 : undefined,
            minHeight: 50,
            paddingHorizontal: mobile ? 2 : 12,
            paddingVertical: 10,
            flexDirection: mobile ? "column" : "row",
            alignItems: "center",
            gap: mobile ? 4 : 10,
            backgroundColor: !mobile && selected ? t.grouped : "transparent",
            borderRadius: 9,
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <Icon
            size={mobile ? 20 : 19}
            strokeWidth={1.7}
            color={selected && mobile ? t.primary : selected ? t.text : t.muted}
          />
          <Label
            size={mobile ? 10 : 14}
            style={{
              color:
                selected && mobile ? t.primary : selected ? t.text : t.muted,
            }}
          >
            {label}
          </Label>
        </Pressable>
      );
    });
  return (
    <View
      {...(Platform.OS === "web" ? { dataSet: { theme: state.theme } } : {})}
      className="flex-1"
      style={{ flex: 1, backgroundColor: t.screen, paddingTop: insets.top }}
    >
      <StatusBar style={state.theme === "dark" ? "light" : "dark"} />
      <View
        style={{
          flex: 1,
          flexDirection: "row",
          width: "100%",
          maxWidth: 1400,
          alignSelf: "center",
        }}
      >
        {desktop && (
          <View
            style={{
              width: 215,
              padding: 20,
              borderRightWidth: 1,
              borderRightColor: t.border,
            }}
          >
            <Row
              style={{ justifyContent: "flex-start", gap: 8, marginBottom: 32 }}
            >
              <BrandMark />
              <Label size={18} bold>
                Audio Angel
              </Label>
            </Row>
            <View accessibilityRole="tablist" style={{ gap: 5 }}>
              {nav(false)}
            </View>
            <View style={{ flex: 1 }} />
            {spotifyRoute || libraryRoute ? (
              <>
                <Label muted size={12}>
                  {libraryRoute ? "Spotify library" : "Spotify playback test"}
                </Label>
                <Label muted size={12}>
                  {live.filterEnabled ? (live.filterFault ? "Filtering stopped" : "Timed filtering enabled") : "Filtering is off"}
                </Label>
              </>
            ) : (
              <>
                <Label muted size={12}>
                  Demo workspace
                </Label>
                <Label muted size={12}>
                  Playback is simulated
                </Label>
              </>
            )}
          </View>
        )}
        <View style={{ flex: 1, minWidth: 0 }}>
          <Row
            style={{
              height: 64,
              paddingHorizontal: desktop ? 32 : 20,
              borderBottomWidth: 1,
              borderBottomColor: t.border,
            }}
          >
            <Label bold>{current.label}</Label>
            <Label
              size={10}
              muted
              style={{
                borderWidth: 1,
                borderColor: spotifyRoute ? t.primary : t.border,
                paddingHorizontal: 7,
                paddingVertical: 2,
                borderRadius: 5,
                color: spotifyRoute ? t.primary : t.muted,
              }}
            >
              {spotifyRoute ? (live.filterEnabled ? (live.filterFault ? "STOPPED" : "FILTERING") : "UNFILTERED") : libraryRoute ? "SPOTIFY" : "DEMO"}
            </Label>
          </Row>
          {state.notice ? (
            <Row
              style={{
                backgroundColor: t.grouped,
                paddingHorizontal: 20,
                paddingVertical: 7,
              }}
            >
              <Label size={12} style={{ flex: 1 }}>
                {state.notice}
              </Label>
              <IconButton
                icon={IconX}
                label="Dismiss message"
                onPress={() => state.setNotice("")}
              />
            </Row>
          ) : null}
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{
              padding: desktop ? 32 : 20,
              paddingBottom: 32,
            }}
            keyboardShouldPersistTaps="handled"
          >
            <View
              style={{
                width: "100%",
                maxWidth: path === "/" ? 680 : 780,
                alignSelf: "center",
              }}
            >
              <Slot />
            </View>
          </ScrollView>
          {!spotifyRoute && live.snapshot.track ? (
            <Row style={{ borderTopWidth: 1, borderTopColor: t.border, backgroundColor: t.card, paddingHorizontal: 20, paddingVertical: 8 }}>
              {live.snapshot.track.imageUrl ? <Image source={{uri:live.snapshot.track.imageUrl}} style={{width:32,height:32,borderRadius:4}} /> : null}
              <View style={{flex:1}}><Label bold size={12}>{live.snapshot.track.name}</Label><Label muted size={11}>{live.snapshot.track.artist} · Spotify · {live.filterEnabled ? (live.filterFault?"Filtering stopped":"Timed filtering enabled"):"Unfiltered"}</Label></View>
              {live.service && live.snapshot.status==="ready" && <IconButton icon={live.snapshot.paused?IconPlayerPlay:IconPlayerPause} label={live.snapshot.paused?"Resume":"Pause"} onPress={() => {const s=live.service;if(!s) return;void (live.snapshot.paused?s.resume.call(s):s.pause.call(s));}} />}
              <IconButton icon={IconArrowUpRight} label="Open Now Playing" onPress={() => router.navigate("/")} />
            </Row>
          ) : path !== "/" && !spotifyRoute && !libraryRoute && (
            <Row
              style={{
                borderTopWidth: 1,
                borderTopColor: t.border,
                backgroundColor: t.card,
                paddingHorizontal: 20,
                paddingVertical: 8,
              }}
            >
              <Artwork kind={state.playback.track.artwork} />
              <View style={{ flex: 1 }}>
                <Label size={12}>{state.playback.track.title}</Label>
                <Label size={11} muted>
                  {state.playback.track.artist} · {state.playback.playing ? "Playing" : "Paused"} · {state.active.rules.some(r => r.enabled) ? "Filters active" : "Filters off"} · Preview
                </Label>
              </View>
              <IconButton
                icon={IconArrowUpRight}
                label="Open Now Playing"
                onPress={() => router.navigate("/")}
              />
            </Row>
          )}
          {!desktop && (
            <View
              accessibilityRole="tablist"
              style={{
                flexDirection: "row",
                backgroundColor: t.card,
                borderTopWidth: 1,
                borderTopColor: t.border,
                paddingTop: 3,
                paddingBottom: Math.max(
                  insets.bottom,
                  Platform.OS === "web" ? 10 : 2,
                ),
              }}
            >
              {nav(true)}
            </View>
          )}
        </View>
      </View>
    </View>
  );
}
