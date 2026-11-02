import React, { useState } from "react";
import { Linking, Platform, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { accountConfigured } from "../services/account";
import { beginSpotifyLogin, getSpotifyRedirectUri } from "../services/spotify/client";
import { useSpotify } from "../services/spotify/use-spotify";
import { Button, Label, Notice } from "./components";

export function SpotifySettings() {
  if (!accountConfigured || Platform.OS !== "web") return <Notice><Label>Account connection is available in the configured web preview.</Label></Notice>;
  return <ConnectedSettings />;
}
function ConnectedSettings() {
  const spotify = useSpotify();
  const callback = useLocalSearchParams<{error?:string}>();
  const configuration = useQuery(api.auth.configuration);
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const connect = async () => {
    setBusy(true); setError(null);
    try { await beginSpotifyLogin(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Could not connect Spotify."); }
    finally { setBusy(false); }
  };
  return <View style={{ gap: 12, marginBottom: 32 }}>
    <Label bold size={20}>Spotify account</Label>
    <Label muted>Connect to see your saved music, playlists and followed podcasts.</Label>
    {configuration === undefined ? <Label muted>Checking account setup…</Label> : !configuration.spotifyConfigured ? <Notice>
      <Label bold>Spotify setup needs finishing</Label>
      <Label muted size={12}>The backend needs the Spotify app credentials. Register this callback URL in your Spotify developer app:</Label>
      <Label size={12} style={{ marginTop: 8 }}>{configuration.redirectUri || getSpotifyRedirectUri()}</Label>
    </Notice> : null}
    {spotify.status === "connected" ? <>
      <Label>Connected as {spotify.displayName}</Label>
      {spotify.permissionsLoading ? <Label muted>Checking library permissions…</Label> : !spotify.libraryAuthorized || !spotify.playbackAuthorized ? <Button disabled={busy || !configuration?.spotifyConfigured} onPress={() => void connect()}>Reconnect for library and playback</Button> : <>
        <Button onPress={() => router.navigate("/library")}>Open your library</Button>
        <Button secondary onPress={() => router.navigate("/")}>Open player</Button>
      </>}
      <Button secondary disabled={busy} onPress={() => {setBusy(true); void spotify.disconnect().catch(() => setError("Could not sign out. Try again.")).finally(() => setBusy(false));}}>Sign out</Button>
    </> : <Button disabled={busy || !configuration?.spotifyConfigured} onPress={() => void connect()}>{busy ? "Opening Spotify…" : "Connect Spotify"}</Button>}
    {callback.error && <Notice><Label>Spotify sign-in did not complete. Check access for this developer app, then try again.</Label></Notice>}
    {(error || spotify.error) && <Notice><Label>{error ?? spotify.error}</Label></Notice>}
    <Label muted size={12}>Sign-in is managed by Better Auth. Account and session data live in Convex; Spotify tokens are encrypted on the backend. Playback is unfiltered unless you enable the experimental line-skipping test.</Label>
    <Button secondary onPress={() => void Linking.openURL("https://www.spotify.com/account/apps/")}>Manage Spotify app access</Button>
    <Button secondary onPress={() => router.navigate("/privacy")}>Privacy and account data</Button>
  </View>;
}
