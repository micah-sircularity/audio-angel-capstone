import "../../global.css";
import React from "react";
import { View, ActivityIndicator } from "react-native";
import { useFonts } from "expo-font";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { SpotifyPlayerProvider } from "../services/spotify/player-provider";
import { AccountProvider } from "../services/account";
import { AppProvider } from "../state/app-state";
import { Shell } from "../ui/shell";
import { PwaRegistration } from "../services/pwa";
const DMSans_400Regular = require("@expo-google-fonts/dm-sans/400Regular/DMSans_400Regular.ttf");
const DMSans_500Medium = require("@expo-google-fonts/dm-sans/500Medium/DMSans_500Medium.ttf");
const DMSans_700Bold = require("@expo-google-fonts/dm-sans/700Bold/DMSans_700Bold.ttf");
export default function Layout() {
  const [loaded, error] = useFonts({
    DMSans_400Regular,
    DMSans_500Medium,
    DMSans_700Bold,
  });
  if (!loaded && !error)
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: "#0a0a0a",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <ActivityIndicator
          color="#4b7cf3"
          accessibilityLabel="Loading Audio Angel"
        />
      </View>
    );
  return (
    <SafeAreaProvider>
      <AccountProvider>
      <AppProvider>
      <SpotifyPlayerProvider>
        <PwaRegistration />
        <Shell />
      </SpotifyPlayerProvider>
      </AppProvider>
      </AccountProvider>
    </SafeAreaProvider>
  );
}
