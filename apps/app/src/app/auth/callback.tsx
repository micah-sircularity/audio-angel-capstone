import React, { useEffect, useState } from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import { finishSpotifyCallback } from "../../services/spotify/client";
import { Button, Label, Notice, Title } from "../../ui/components";
export default function SpotifyCallback() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void finishSpotifyCallback()
      .then(() => {
        if (active) router.replace("/settings");
      })
      .catch((error: unknown) => {
        if (active)
          setError(
            error instanceof Error
              ? error.message
              : "Spotify sign-in did not complete.",
          );
      });
    return () => {
      active = false;
    };
  }, [router]);
  return (
    <View>
      <Title>
        {error ? "Sign-in did not complete." : "Connecting to Spotify…"}
      </Title>
      <Notice>
        <Label>
          {error ??
            "Checking the sign-in response. You will return to Settings, where the Spotify player can be opened."}
        </Label>
      </Notice>
      {error && (
        <View style={{ marginTop: 20 }}>
          <Button onPress={() => router.replace("/settings")}>
            Back to Settings
          </Button>
        </View>
      )}
    </View>
  );
}
