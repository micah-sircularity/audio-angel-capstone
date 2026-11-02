import { useEffect, useMemo, useState } from "react";
import type { LyricsLookupRequest, LyricsLookupResponse } from "@audio-angel/contracts";
import { fetchLyrics } from "./lyrics";
import type { PlaybackSnapshot } from "./spotify/playback";
export type LyricsLookupState = {
  request: LyricsLookupRequest | null; data: LyricsLookupResponse | null;
  status: "idle" | "loading" | "ready" | "error"; error: string | null; retry: () => void;
};
export function useTrackLyrics(snapshot: PlaybackSnapshot): LyricsLookupState {
  const track = snapshot.track;
  const request = useMemo<LyricsLookupRequest | null>(()=> {
    if (!track || !track.uri.startsWith("spotify:track:") || snapshot.durationMs < 1000 || snapshot.durationMs > 3_600_000) return null;
    return {trackName:track.name,artistName:track.artist,albumName:track.album,durationMs:Math.round(snapshot.durationMs)};
    // Stable metadata fields prevent position/poll ticks from refetching lyrics.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[track?.uri,track?.name,track?.artist,track?.album,snapshot.durationMs]);
  const [retry, setRetry] = useState(0);
  const key = JSON.stringify([track?.uri,request,retry]);
  const [result, setResult] = useState<{key:string;data:LyricsLookupResponse|null;error:string|null}|null>(null);
  useEffect(()=>{
    if (!request) return;
    const controller = new AbortController();
    void fetchLyrics(request,{signal:controller.signal}).then(data=>{
      if (!controller.signal.aborted) setResult({key,data,error:null});
    }).catch((error:unknown)=>{
      if (!controller.signal.aborted) setResult({key,data:null,error:error instanceof Error ? error.message : "Lyrics could not be loaded. Retry."});
    });
    return ()=>controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- key captures request identity and retries.
  },[key]);
  const fresh = result?.key === key ? result : null;
  return {request,data:fresh?.data??null,error:fresh?.error??null,status:!request?"idle":!fresh?"loading":fresh.error?"error":"ready",retry:()=>setRetry(n=>n+1)};
}
