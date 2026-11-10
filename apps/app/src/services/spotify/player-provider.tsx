import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Platform } from "react-native";
import { getSpotifyAuth } from "./client";
import { createSpotifyPlayback } from "./playback-client";
import { useSpotify } from "./use-spotify";
import { buildLivePlan, unsupportedRules } from "@audio-angel/filters";
import { useApp } from "../../state/app-state";
import { useTrackLyrics, type LyricsLookupState } from "../use-track-lyrics";
import { useEpisodeTranscript, type TranscriptLookupState } from "../use-track-transcript";
import { FilterScheduler, type FilterEvent } from "../filtering/filter-scheduler";
import type { PlannedAction } from "@audio-angel/contracts";
import type { PlaybackSnapshot, SpotifyPlayback } from "./playback";
export type PendingPlay = { uri: string; error: string | null };
export type FilterActivity = FilterEvent & { at: number };
const initialSnapshot: PlaybackSnapshot = {
  status: "idle",
  track: null,
  positionMs: 0,
  durationMs: 0,
  paused: true,
  error: null,
  needsUserGesture: false,
};

const PlaybackContext = createContext<{
  service: SpotifyPlayback | null; snapshot: PlaybackSnapshot; connectionError: string | null; retry: () => void;
  startPlayback: (uri: string) => void; pendingPlay: PendingPlay | null;
  lyrics: LyricsLookupState; transcript: TranscriptLookupState; filterEnabled:boolean; setFilterEnabled:(enabled:boolean)=>void;
  preferClean:boolean;setPreferClean:(value:boolean)=>void;canMute:boolean;wordMuting:boolean;setWordMuting:(value:boolean)=>void;
  filterFault:string|null; filterPlan:readonly PlannedAction[]; filterEvents:readonly FilterActivity[]; clearFilterEvents:()=>void; unsupported:string[];

} | null>(null);
export function SpotifyPlayerProvider({children}: React.PropsWithChildren) {
  const spotify = useSpotify();
  const app = useApp();
  const [service, setService] = useState<SpotifyPlayback | null>(null);
  const [snapshot, setSnapshot] = useState<PlaybackSnapshot>(initialSnapshot);
  const [error, setError] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);
  const lyrics=useTrackLyrics(snapshot);
  const transcript=useEpisodeTranscript(snapshot);
  const [preferClean,setPreferClean]=useState(true);
  const [canMute,setCanMute]=useState(false);
  const [wordMuting,setWordMuting]=useState(true);
  const [filterEnabled,setEnabled]=useState(false);
  const [filterFault,setFilterFault]=useState<string|null>(null);
  const [filterEvents,setFilterEvents]=useState<FilterActivity[]>([]);
  const scheduler=useRef<FilterScheduler|null>(null);
  const [pendingPlay,setPendingPlay]=useState<PendingPlay|null>(null);
  const filterPlan=useMemo(()=>lyrics.data?.status==="synced" ? buildLivePlan(app.active,lyrics.data.spans,{canMute:canMute&&wordMuting,canSeek:true,background:"unsupported"},snapshot.durationMs) : [],[app.active,lyrics.data,snapshot.durationMs,canMute,wordMuting]);
  useEffect(()=>{
    if(!service) return;
    const controller=new FilterScheduler(service,{onEvent:event=>setFilterEvents(events=>[{...event,at:Date.now()},...events].slice(0,25)),onFault:setFilterFault});
    scheduler.current=controller;
    const visibility=()=>controller.setVisible(document.visibilityState==="visible");
    if(Platform.OS==="web") {visibility();document.addEventListener("visibilitychange",visibility);}
    return ()=>{controller.dispose();scheduler.current=null;if(Platform.OS==="web") document.removeEventListener("visibilitychange",visibility);};
  },[service]);
  useEffect(()=>{
    scheduler.current?.configure({enabled:filterEnabled,uri:snapshot.track?.uri??null,plan:filterPlan,ready:lyrics.data?.status==="synced"&&!filterFault&&app.loaded});
  },[service,filterEnabled,snapshot.track?.uri,filterPlan,lyrics.data,filterFault,app.loaded]);
  useEffect(() => {
    if (!spotify.playbackAuthorized || Platform.OS !== "web") return;
    const auth = getSpotifyAuth();
    if (!auth) return;
    let cancelled = false;
    let playback: SpotifyPlayback | null = null;
    let unsubscribe: (() => void) | null = null;
    (async () => {
      try {
        playback = await createSpotifyPlayback(auth);
        if (cancelled) {
          playback.dispose();
          return;
        }
        unsubscribe = playback.subscribe(() =>
          setSnapshot(playback!.getSnapshot()),
        );
        setSnapshot(playback.getSnapshot());
        await playback.connect();
        const volumeSupported=playback.getSnapshot().status==="ready" ? await playback.supportsVolumeControl().catch(()=>false) : false;
        if(cancelled) {playback.dispose();return;}
        setCanMute(volumeSupported);
        setService(playback);
      } catch (caught) {
        if (!cancelled)
          setError(
            caught instanceof Error
              ? caught.message
              : "The Spotify player could not start.",
          );
      }
    })();
    return () => {
      cancelled = true;
      unsubscribe?.();
      playback?.dispose();
      setService(null);setCanMute(false);
      setSnapshot(initialSnapshot);
    };
  }, [spotify.playbackAuthorized, spotify.accountId, retryNonce]);

  const playSeq=useRef(0);
  const startPlayback=(uri:string)=>{
    const call=++playSeq.current;
    setPendingPlay({uri,error:null});
    if(!service||snapshot.status!=="ready"){setPendingPlay({uri,error:"The Spotify player is still connecting. Try again in a moment."});return;}
    Promise.resolve(service.play(uri,{preferClean}))
      .then(()=>{if(playSeq.current===call)setPendingPlay(null);})
      .catch((caught:unknown)=>{if(playSeq.current===call)setPendingPlay({uri,error:caught instanceof Error?caught.message:"Spotify playback failed. Try again."});});
  };
  return <PlaybackContext.Provider value={{preferClean,setPreferClean,canMute,wordMuting,setWordMuting,service,snapshot,connectionError:error,lyrics,transcript,filterEnabled,filterFault,filterPlan,filterEvents,clearFilterEvents:()=>setFilterEvents([]),unsupported:unsupportedRules(app.active),startPlayback,pendingPlay,setFilterEnabled:enabled=>{setFilterFault(null);setEnabled(enabled);},retry:()=>{setError(null);setRetryNonce(n=>n+1);}}}>{children}</PlaybackContext.Provider>;
}
export function useSpotifyPlayer() {
  const value = useContext(PlaybackContext);
  if (!value) throw new Error("SpotifyPlayerProvider is missing.");
  return value;
}
