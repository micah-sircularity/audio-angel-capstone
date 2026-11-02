import React, { useState, useEffect } from "react";
import { View, Pressable, Platform, Animated, Easing, type PressableProps } from "react-native";
import {
  IconPlayerPause,
  IconPlayerPlay,
  IconPlayerSkipForward,
  IconPlayerSkipBack,
  IconHeart,
  IconRewindBackward10,
  IconRewindForward10,
} from "./icons";
import { useApp } from "../state/app-state";
import { useTheme } from "./theme";
import {
  Artwork,
  Chip,
  Button,
  Group,
  IconButton,
  Label,
  ListRow,
  Notice,
  Row,
  Shield,
} from "./components";
import { useReducedMotion } from "./use-motion";
import { FilterSheet } from "./filter-sheet";
import { time } from "../data/demo";
export function DemoPlayer() {
  const app = useApp();
  const t = useTheme();
  const [chooser, setChooser] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const [preview, setPreview] = useState<"ready" | "loading" | "unavailable">("ready");
  const reducedMotion = useReducedMotion();
  const [expansion] = useState(() => new Animated.Value(1));
  useEffect(() => {
    expansion.stopAnimation();
    const motion = Animated.timing(expansion, { toValue: expanded ? 1 : 0, duration: reducedMotion ? 0 : 380, easing: Easing.out(Easing.exp), useNativeDriver: false });
    motion.start();
    return () => motion.stop();
  }, [expanded, reducedMotion, expansion]);
  const [trackWidth, setTrackWidth] = useState(1);
  const { track, positionMs, playing } = app.playback;
  const next = app.plan.find((a) => a.endMs > positionMs);
  const progress = (positionMs / track.durationMs) * 100;
  return (
    <View>
      <Row style={{ flexWrap: "wrap", marginBottom: 24 }}>
        <Label muted size={11} style={{ letterSpacing: 1 }}>
          Weekend drive
        </Label>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Inspect active filters"
          onPress={() => setChooser(true)}
          style={{
            backgroundColor: t.grouped,
            borderRadius: 22,
            paddingHorizontal: 13,
            paddingVertical: 10,
            minHeight: 44,
            flexDirection: "row",
            gap: 8,
            alignItems: "center",
          }}
        >
          <Shield />
          <Label size={12}>{preview === "unavailable" ? "Filtering unavailable" : "Your filters"}</Label>
        </Pressable>
      </Row>
      {chooser && <FilterSheet visible onClose={() => setChooser(false)} />}
      <Row style={{ marginBottom: 16 }}>
        <Label bold size={28} style={{ flex: 1 }}>Your listening space</Label>
        <Button secondary onPress={() => setExpanded(!expanded)}>{expanded ? "Minimize" : "Expand"}</Button>
      </Row>
      <View style={{ gap: 8, marginBottom: 20 }}>
        <Label muted>Set your boundaries. Settle into listening.</Label>
        <Label size={12}>Illustrative player · no audio or content analysis</Label>
      </View>
      <Animated.View style={{ alignItems: "center", height: expansion.interpolate({ inputRange: [0, 1], outputRange: [70, 234] }), overflow: "hidden" }}>
        <Animated.View style={{ width: "100%", alignItems: "center", transform: [{ scale: expansion.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] }) }], transformOrigin: "top center" }}><Artwork large kind={track.artwork} /></Animated.View>
      </Animated.View>
      <View style={{ maxWidth: 390, width: "100%", alignSelf: "center" }}>
        <Row>
          <View style={{ flex: 1 }}>
            <Label size={24} bold style={{ letterSpacing: -0.6 }}>
              {track.title}
            </Label>
            <Label muted>{track.artist}</Label>
          </View>
          <IconButton
            icon={IconHeart}
            label={
              app.saved.includes(track.id)
                ? "Remove from saved tracks"
                : "Save track"
            }
            selected={app.saved.includes(track.id)}
            onPress={app.toggleSaved}
          />
        </Row>
        <Pressable
          accessibilityRole="adjustable"
          accessibilityLabel="Playback position"
          accessibilityHint="Use arrow keys to seek five seconds, or the ten-second buttons below."
          accessibilityActions={[
            { name: "increment", label: "Forward five seconds" },
            { name: "decrement", label: "Back five seconds" },
          ]}
          onAccessibilityAction={(event) =>
            app.seek(
              positionMs +
                (event.nativeEvent.actionName === "increment" ? 5000 : -5000),
            )
          }
          {...(Platform.OS === "web"
            ? {
                "aria-valuemin": 0,
                "aria-valuemax": Math.floor(track.durationMs / 1000),
                "aria-valuenow": Math.floor(positionMs / 1000),
                "aria-valuetext": time(positionMs),
                onKeyDown: (
                  event: Parameters<
                    NonNullable<PressableProps["onKeyDown"]>
                  >[0],
                ) => {
                  const target =
                    event.nativeEvent.key === "Home"
                      ? 0
                      : event.nativeEvent.key === "End"
                        ? track.durationMs
                        : event.nativeEvent.key === "ArrowRight" ||
                            event.nativeEvent.key === "ArrowUp"
                          ? positionMs + 5000
                          : event.nativeEvent.key === "ArrowLeft" ||
                              event.nativeEvent.key === "ArrowDown"
                            ? positionMs - 5000
                            : null;
                  if (target !== null) {
                    event.preventDefault();
                    app.seek(target);
                  }
                },
              }
            : {})}
          accessibilityValue={{
            min: 0,
            max: Math.floor(track.durationMs / 1000),
            now: Math.floor(positionMs / 1000),
            text: time(positionMs),
          }}
          onLayout={(event) => setTrackWidth(event.nativeEvent.layout.width)}
          onPress={(event) => {
            if (Number.isFinite(event.nativeEvent.locationX))
              app.seek(
                (event.nativeEvent.locationX / trackWidth) * track.durationMs,
              );
          }}
          style={{
            paddingVertical: 16,
            minHeight: 44,
            justifyContent: "center",
            marginTop: 8,
          }}
        >
          <View
            style={{ height: 5, backgroundColor: t.grouped, borderRadius: 4 }}
          >
            <View
              style={{
                width: `${progress}%`,
                backgroundColor: t.text,
                height: 5,
                borderRadius: 4,
              }}
            />
            {app.plan.map((action) => (
              <View
                key={action.startMs}
                style={{
                  position: "absolute",
                  top: -2,
                  left: `${(action.startMs / track.durationMs) * 100}%`,
                  width: Math.max(
                    6,
                    ((action.endMs - action.startMs) / track.durationMs) * 340,
                  ),
                  height: 9,
                  borderRadius: 3,
                  backgroundColor: t.primary,
                }}
              />
            ))}
          </View>
        </Pressable>
        <Row style={{ marginTop: -7 }}>
          <Label size={11} muted>
            {time(positionMs)}
          </Label>
          <Label size={11} muted>
            {time(track.durationMs)}
          </Label>
        </Row>
        <Row style={{ marginTop: 18, marginBottom: 24 }}>
          <IconButton
            icon={IconRewindBackward10}
            label="Back ten seconds"
            onPress={() => app.seek(positionMs - 10000)}
          />
          <IconButton
            icon={IconPlayerSkipBack}
            label="Previous track"
            onPress={() => void app.player.previous()}
          />
          <IconButton
            prominent
            icon={playing ? IconPlayerPause : IconPlayerPlay}
            label={playing ? "Pause demo playback" : "Play demo playback"}
            disabled={preview === "loading"}
            onPress={() =>
              void (playing ? app.player.pause() : app.player.play())
            }
          />
          <IconButton
            icon={IconPlayerSkipForward}
            label="Next track"
            onPress={() => void app.player.next()}
          />
          <IconButton
            icon={IconRewindForward10}
            label="Forward ten seconds"
            onPress={() => app.seek(positionMs + 10000)}
          />
        </Row>
        <Notice>
          <Row>
            <Row style={{ gap: 7, justifyContent: "flex-start" }}>
              <View
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: 3,
                  backgroundColor: t.primary,
                }}
              />
              <Label size={12} bold>
                {preview === "loading" ? "Loading preview…" : preview === "unavailable" ? "Filtering unavailable" : app.active.rules.some(r => r.enabled) ? "Filters active · preview" : "Filters off · preview"}
              </Label>
            </Row>
            <Label size={11} muted>
              {app.device}
            </Label>
          </Row>
          <Label muted size={11} style={{ marginTop: 5 }}>
            {preview === "unavailable" ? "Preferences remain saved. This preview cannot filter content. Try the ready state below." : "Illustrative status only. Detection can miss content; preferences do not guarantee protection."}
          </Label>
          <View style={{ marginTop: 12 }}><Button secondary onPress={() => setChooser(true)}>Inspect active filters · {app.active.rules.filter(r => r.enabled).length}</Button></View>
          <Label accessibilityLiveRegion="polite" muted size={12} style={{ marginTop: 12 }}>{playing ? "Playing · simulated" : "Paused"}</Label>
          {app.events[0]?.description.startsWith("Jump simulated") || app.events[0]?.description === "Song skip simulated" ? <Label muted size={12}>Last filtering action: skipped according to your preferences · simulated</Label> : null}
        </Notice>
        <Label muted size={11} style={{ marginTop: 15, textAlign: "center" }}>
          Fictional music · Simulated playback · Screen open only
        </Label>
        <View style={{ marginTop: 24, gap: 10 }}>
          <Label bold size={14}>Explore player states</Label>
          <Row style={{ flexWrap: "wrap", justifyContent: "flex-start", gap: 8 }}>
            {(["ready", "loading", "unavailable"] as const).map(state => <Chip key={state} selected={preview === state} onPress={() => { setPreview(state); if(state !== "ready") void app.player.pause(); }}>{state === "ready" ? "Ready" : state === "loading" ? "Loading" : "Unavailable"}</Chip>)}
          </Row>
        </View>
        <Group>
          <ListRow
            title="Try a filtering action"
            description={preview === "ready" ? "Jump to just before the next flagged word." : "Choose Ready above to try a simulated filtering action."}
            last
          >
            <Chip
              onPress={() => {
                if (preview !== "ready") return;
                app.seek(Math.max(0, (next?.startMs ?? 102000) - 1500));
                void app.player.play();
              }}
            >
              Preview
            </Chip>
          </ListRow>
        </Group>
      </View>
    </View>
  );
}
