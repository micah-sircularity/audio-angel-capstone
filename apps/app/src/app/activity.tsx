import React from "react";
import { View } from "react-native";
import { useApp } from "../state/app-state";
import { Button, Group, Label, ListRow, Notice, Title } from "../ui/components";
export default function Activity() {
  const app = useApp();
  return (
    <View>
      <Title>What changed.</Title>
      <Label muted>Simulated playback actions and their reasons.</Label>
      {app.events.length ? (
        <>
          <Group>
            {app.events.map((event, index) => (
              <ListRow
                key={event.id}
                title={event.description}
                description={`${event.reason} · ${new Date(event.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`}
                last={index === app.events.length - 1}
              >
                <Label size={10} muted>
                  DEMO
                </Label>
              </ListRow>
            ))}
          </Group>
          <View style={{ alignSelf: "flex-start", marginBottom: 24 }}>
            <Button secondary onPress={app.clearEvents}>
              Clear activity
            </Button>
          </View>
        </>
      ) : (
        <View style={{ paddingVertical: 50 }}>
          <Label size={18} bold>
            No actions yet.
          </Label>
          <Label muted style={{ marginTop: 8 }}>
            Play the demo and choose Preview on Now Playing, or switch profiles.
            Actions will appear here.
          </Label>
        </View>
      )}
      <Notice>
        <Label size={12}>
          These events describe simulated commands, not a verified count of
          words blocked. Audio Angel does not read or analyze Spotify audio.
        </Label>
      </Notice>
    </View>
  );
}
