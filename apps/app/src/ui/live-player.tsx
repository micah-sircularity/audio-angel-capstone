import React, { useEffect, useRef, useState } from "react";
import { Image, Linking, Platform, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSpotifyPlayer } from "../services/spotify/player-provider";
import { useSpotify } from "../services/spotify/use-spotify";
import { useTheme } from "./theme";
import {
  Button,
  Field,
  IconButton,
  Label,
  Notice,
  Row,
  Title,
  Toggle,
} from "./components";
import {
  IconMusic,
  IconPlayerPause,
  IconPlayerPlay,
  IconRewindBackward10,
  IconRewindForward10,
} from "./icons";
import { time } from "../data/defaults";
import { LiveFilterControls, LiveFilterToggle } from "./live-filter-controls";
import { LyricsPanel, TranscriptPanel } from "./lyrics-panel";
const DEFAULT_TRACK = "https://open.spotify.com/track/0fuLRqMU6IaRoNAFIUdjPx";
export function PlayerStatus({error}:{error?:string|null}) {
  const {snapshot,connectionError,retry}=useSpotifyPlayer();
  const [slow,setSlow]=useState<{status:string;show:boolean}>({status:snapshot.status,show:false});
  if(slow.status!==snapshot.status) setSlow({status:snapshot.status,show:false});
  useEffect(()=>{
    if(snapshot.status==="ready") return;
    const timer=setTimeout(()=>setSlow(current=>current.status===snapshot.status?{...current,show:true}:current),20000);
    return ()=>clearTimeout(timer);
  },[snapshot.status]);
  const message=error??connectionError??snapshot.error;
  return <>
    {snapshot.status!=="ready"&&!error&&!connectionError&&(
      <Notice>
        <Label size={12}>
          {snapshot.status==="connecting"
            ? "Connecting the browser player…"
            : snapshot.status==="offline"
              ? "The player went offline. Retry below."
              : "Starting the player…"}
        </Label>
      </Notice>
    )}
    {message&&<Notice><Label size={12}>{message}</Label></Notice>}
    {snapshot.needsUserGesture&&(
      <Notice>
        <Label size={12}>This browser blocked autoplay. Press Play selection to start audio.</Label>
      </Notice>
    )}
    {(connectionError!==null||snapshot.status==="error"||snapshot.status==="offline"||slow.show)&&(
      <Button secondary onPress={retry}>Retry the player</Button>
    )}
  </>;
}

export function LivePlayer() {
  const t = useTheme();
  const router = useRouter();
  const spotify = useSpotify();
  const params = useLocalSearchParams<{uri?:string}>();
  const selectedUri = typeof params.uri === "string" && /^spotify:(track|episode):[A-Za-z0-9]{22}$/.test(params.uri) ? params.uri : null;
  const live = useSpotifyPlayer();
  const {service,snapshot,retry:retryConnection} = live;
  const [input, setInput] = useState(selectedUri ?? DEFAULT_TRACK);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [seenUri, setSeenUri] = useState(selectedUri);
  if (seenUri !== selectedUri) {
    setSeenUri(selectedUri);
    if (selectedUri) {setInput(selectedUri);}
  }
  const run = (action: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    void action()
      .catch((caught: unknown) =>
        setError(
          caught instanceof Error
            ? caught.message
            : "The playback action failed.",
        ),
      )
      .finally(() => {
        busyRef.current = false;
        setBusy(false);
      });
  };
  // Calls into the service synchronously: activateElement runs inside the
  // user gesture before the first await.
  const play = () => service && run(async () => {await service.play(input,{preferClean:live.preferClean});});
  const resume = () => service && run(() => service.resume());
  const pause = () => service && run(() => service.pause());
  const seekBy = (delta: number) =>
    service && run(() => service.seek(snapshot.positionMs + delta));
  const retry = () => {
    setError(null);
    retryConnection();
  };
  const uriForLink = snapshot.track?.uri ?? selectedUri;
  const trackUrl = uriForLink && /^spotify:(track|episode):[A-Za-z0-9]{22}$/.test(uriForLink)
    ? `https://open.spotify.com/${uriForLink.split(":")[1]}/${uriForLink.split(":")[2]}` : null;
  const progress =
    snapshot.durationMs > 0
      ? Math.min(100, (snapshot.positionMs / snapshot.durationMs) * 100)
      : 0;
  return (
    <View>
      <Title>Now playing</Title>
      {Platform.OS !== "web" ? (
        <>
          <Notice>
            <Label size={12}>
              Live Spotify playback testing is only available in the web app.
            </Label>
          </Notice>
          <View style={{ marginTop: 16 }}>
            <Button secondary onPress={() => router.navigate("/filtering")}>
              Open Filtering
            </Button>
          </View>
        </>
      ) : !spotify.playbackAuthorized ? (
        <>
          <Notice>
            <Label size={12}>
              {spotify.status === "connected"
                ? "Your Spotify connection predates playback access. Reconnect from Filtering to allow live playback."
                : "Connect Spotify from Filtering before testing playback."}
            </Label>
          </Notice>
          <View style={{ marginTop: 16 }}>
            <Button secondary onPress={() => router.navigate("/filtering")}>
              Open Filtering
            </Button>
          </View>
        </>
      ) : (
        <View style={{ marginTop: 20, gap: 16 }}>
          <PlayerStatus error={error} />
          {snapshot.track && (
            <View style={{ gap: 18 }}>
              {snapshot.track.imageUrl ? (
                <Image
                  source={{ uri: snapshot.track.imageUrl }}
                  style={{ width: "100%", aspectRatio: 1, maxWidth: 320, alignSelf: "center", borderRadius: 12 }}
                  accessibilityLabel={`Album art for ${snapshot.track.album}`}
                />
              ) : (
                <View style={{ aspectRatio: 1, maxWidth: 320, width: "100%", alignSelf: "center", borderRadius: 12, backgroundColor: t.grouped, alignItems: "center", justifyContent: "center" }}>
                  <IconMusic size={64} color={t.muted} />
                </View>
              )}
              <View style={{ gap: 18 }}>
                <View style={{ flex: 1 }}>
                  {snapshot.cleanChoice?.status==="clean" && <Label bold size={12}>Playing clean version · Spotify non-explicit label</Label>}
                  {snapshot.cleanChoice?.status==="not-found" && <Label muted size={12}>No matching clean version found · original recording</Label>}
                  {snapshot.cleanChoice?.status==="unavailable" && <Label muted size={12}>Clean-version lookup unavailable · original recording</Label>}
                  <Label bold size={26} style={{ letterSpacing: -0.6 }}>{snapshot.track.name}</Label>
                  <Label muted size={12}>
                    {snapshot.track.artist} · {snapshot.track.album}
                  </Label>
                </View>
              </View>
              <View
                style={{
                  height: 5,
                  backgroundColor: t.grouped,
                  borderRadius: 4,
                  marginTop: 14,
                }}
              >
                {live.filterEnabled && live.filterPlan.map((action,index)=><View key={index} accessibilityLabel={`Planned skip ${time(action.startMs)} to ${time(action.endMs)}`} style={{position:"absolute",left:`${(action.startMs/snapshot.durationMs)*100}%`,width:`${Math.max(0.5,((action.endMs-action.startMs)/snapshot.durationMs)*100)}%`,height:5,backgroundColor:t.danger,borderRadius:3}}/>)}
                <View
                  style={{
                    width: `${progress}%`,
                    height: 5,
                    borderRadius: 4,
                    backgroundColor: t.primary,
                  }}
                />
              </View>
              <Row style={{ marginTop: 6 }}>
                <Label size={11} muted>
                  {time(snapshot.positionMs)}
                </Label>
                <Label size={11} muted>
                  {time(snapshot.durationMs)}
                </Label>
              </Row>
              <Row style={{ marginTop: 10, justifyContent: "center" }}>
                <IconButton
                  icon={IconRewindBackward10}
                  label="Back ten seconds"
                  disabled={
                    busy ||
                    snapshot.status !== "ready" ||
                    snapshot.durationMs <= 0
                  }
                  onPress={() => seekBy(-10_000)}
                />
                <IconButton
                  prominent
                  icon={snapshot.paused ? IconPlayerPlay : IconPlayerPause}
                  label={snapshot.paused ? "Resume" : "Pause"}
                  disabled={busy || snapshot.status !== "ready" || (snapshot.paused && live.filterEnabled && (live.lyrics.data?.status !== "synced" || Boolean(live.filterFault)))}
                  onPress={snapshot.paused ? resume : pause}
                />
                <IconButton
                  icon={IconRewindForward10}
                  label="Forward ten seconds"
                  disabled={
                    busy ||
                    snapshot.status !== "ready" ||
                    snapshot.durationMs <= 0
                  }
                  onPress={() => seekBy(10_000)}
                />
              </Row>
              <LiveFilterToggle />
              <Label muted size={12}>{live.filterEnabled ? "Filtering on — keep this app visible; timed muting or skipping as needed." : "Filtering off — original audio. Turn on filtering to time mutes."}</Label>
              {trackUrl && (
                <View style={{ marginTop: 10 }}>
                  <Button
                    secondary
                    onPress={() => void Linking.openURL(trackUrl)}
                  >
                    Open in Spotify
                  </Button>
                </View>
              )}
            </View>
          )}
          {snapshot.needsUserGesture && <View style={{ gap: 12 }}>
          <Label bold>Play selection</Label>
          <Field
            label="Spotify song or episode link"
            placeholder={DEFAULT_TRACK}
            value={input}
            onChangeText={setInput}
          />
          <Row><View style={{flex:1}}><Label bold>Prefer clean versions</Label><Label muted size={12}>Applies when you press Play selection. Spotify’s label does not cover every filter.</Label></View><Toggle label="Prefer clean Spotify versions" value={live.preferClean} onChange={live.setPreferClean}/></Row>
          <Button
            disabled={!service || snapshot.status !== "ready" || busy}
            onPress={play}
          >
            Play selection
          </Button>
          </View>}
          <LiveFilterControls />
          {snapshot.track?.uri.startsWith("spotify:episode:") ? <TranscriptPanel
            key={snapshot.track.uri}
            lookup={live.transcript}
            positionMs={snapshot.positionMs}
            onSeek={snapshot.status === "ready" && !busy ? (position) => service && run(() => service.seek(position)) : undefined}
          /> : <LyricsPanel
            key={snapshot.track?.uri ?? "none"}
            lookup={live.lyrics}
            filtering={live.filterEnabled && !live.filterFault}
            positionMs={snapshot.positionMs}
            onSeek={snapshot.status === "ready" && !busy ? (position) => service && run(() => service.seek(position)) : undefined}
          />}
          {!snapshot.track && trackUrl && <Button secondary onPress={() => void Linking.openURL(trackUrl)}>Open selection in Spotify</Button>}
          <Button secondary disabled={busy} onPress={retry}>
            Retry player
          </Button>
          <Label muted size={11} style={{ textAlign: "center" }}>
            Requires Spotify Premium. Playback streams in this tab via the
            Spotify Web Playback SDK.
          </Label>
        </View>
      )}
    </View>
  );
}
