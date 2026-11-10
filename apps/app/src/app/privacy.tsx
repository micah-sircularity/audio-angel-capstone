import React from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import { Button, Label, Title } from "../ui/components";
export default function Privacy() {
  const router = useRouter();
  return (
    <View style={{ gap: 16 }}>
      <Title>Privacy and account data</Title>
      <Label>
        This development preview lets you connect Spotify and play music in
        the browser. Playback is unfiltered by default.
        Experimental timed filtering can apply word rules using timed lyrics.
      </Label>
      <Label bold>Spotify account</Label>
      <Label muted>
        Better Auth manages sign-in and stores your account, sessions and encrypted
        Spotify access and refresh tokens in Convex. The browser receives a
        short-lived access token to read your library and control Spotify playback.
        Your library is fetched on demand from Spotify and held in memory; it is
        not copied into Convex or the app-shell cache.
      </Label>
      <Label bold>Data on this device</Label>
      <Label muted>
        Profiles, rules and theme are stored locally in your browser. Better Auth&rsquo;s
        cross-domain client stores an app session credential on this device. Recently
        played is stored only on this device. Spotify
        refresh tokens and the client secret stay on the backend. Signing in requires
        a network connection.
      </Label>
      <Label bold>Disconnecting</Label>
      <Label muted>
        Sign out in Filtering to end this app session. To revoke Spotify access,
        remove Audio Angel from Spotify&rsquo;s app-access page. Signing out does not delete
        your account or its stored provider connection. Browser site-data controls
        can remove locally saved profiles and settings.
      </Label>
      <Label bold>Audio and other providers</Label>
      <Label muted>
        This app does not capture, read, record, decode or analyze Spotify
        audio, and no AI is connected. When a song plays, the app server sends
        the track title, artist, album and duration to LRCLIB to fetch synced
        lyrics for display and on-device filtering; no Spotify tokens, audio or account details are
        sent. Lyrics are held only in memory, are not cached or logged, and
        LRCLIB accuracy or availability is not guaranteed. When a podcast
        episode plays, the app server sends only the show name, episode title
        and duration to Taddy to find a transcript, then fetches the
        publisher-hosted transcript file itself; transcripts are shown for
        display only and are not filtered.
      </Label>
      <Button secondary onPress={() => router.replace("/filtering")}>
        Back to Filtering
      </Button>
    </View>
  );
}
