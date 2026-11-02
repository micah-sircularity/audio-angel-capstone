import React from "react";
import { Platform, View } from "react-native";
import { SpotifySettings } from "../ui/spotify-settings";
import { useApp } from "../state/app-state";
import {
  Button,
  Chip,
  Group,
  Label,
  ListRow,
  Notice,
  Title,
} from "../ui/components";
export default function Settings() {
  const app = useApp();
  function exportReport() {
    const report = JSON.stringify(
      {
        mode: "demo",
        deviceSimulation: app.device,
        capabilities: app.capabilities,
        backgroundFiltering: "not tested",
        liveSpotify: false,
        platform: Platform.OS,
        generatedAt: new Date().toISOString(),
      },
      null,
      2,
    );
    if (Platform.OS === "web") {
      const url = URL.createObjectURL(
        new Blob([report], { type: "application/json" }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = "audio-angel-demo-diagnostics.json";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } else app.setNotice(report);
  }
  return (
    <View>
      <Title>Make it yours.</Title>
      <SpotifySettings />
      <Label bold size={17}>
        Appearance
      </Label>
      <View style={{ flexDirection: "row", gap: 8, marginVertical: 16 }}>
        <Chip
          selected={app.theme === "dark"}
          onPress={() => app.changeTheme("dark")}
        >
          Dark
        </Chip>
        <Chip
          selected={app.theme === "light"}
          onPress={() => app.changeTheme("light")}
        >
          Light
        </Chip>
      </View>
      <Label bold size={17} style={{ marginTop: 20 }}>
        Demo device
      </Label>
      <Label muted size={12} style={{ marginTop: 5 }}>
        Simulates available actions. This is not device detection.
      </Label>
      <View
        style={{
          flexDirection: "row",
          flexWrap: "wrap",
          gap: 8,
          marginVertical: 16,
        }}
      >
        {["iPhone", "Android", "Desktop"].map((device) => (
          <Chip
            key={device}
            selected={app.device === device}
            onPress={() => app.setDevice(device)}
          >
            {device}
          </Chip>
        ))}
      </View>
      <Group>
        <ListRow title="Mute" last={false}>
          <Label muted>
            {app.capabilities.canMute ? "Simulated" : "Unavailable"}
          </Label>
        </ListRow>
        <ListRow title="Seek / skip section">
          <Label muted>Simulated</Label>
        </ListRow>
        <ListRow title="Background filtering" last>
          <Label muted>Unverified</Label>
        </ListRow>
      </Group>
      <Notice>
        <Label bold size={12}>
          Keep the app open
        </Label>
        <Label muted size={12} style={{ marginTop: 5 }}>
          Demo playback pauses when this app is hidden. An installed PWA does
          not guarantee background filtering. Drive mode and real-device
          diagnostics come next.
        </Label>
      </Notice>
      <Label bold size={17} style={{ marginTop: 28, marginBottom: 12 }}>
        Diagnostics
      </Label>
      <Button secondary onPress={exportReport}>
        Export demo report
      </Button>
      <Label muted size={12} style={{ marginTop: 10 }}>
        Contains no tokens, audio or lyric text. Live device measurements are
        not implemented.
      </Label>
      <Label bold size={17} style={{ marginTop: 28 }}>
        About
      </Label>
      <Label muted size={12} style={{ marginTop: 8 }}>
        Audio Angel 0.1 · Demo scaffold
      </Label>
      <Label muted size={12}>
        Interface adapted from T3 Code mobile. MIT © 2026 T3 Tools Inc. Full
        notice is included in THIRD_PARTY_NOTICES.md.
      </Label>
    </View>
  );
}
