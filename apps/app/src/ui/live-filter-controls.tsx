import React, { useState } from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import { useApp } from "../state/app-state";
import { useSpotifyPlayer } from "../services/spotify/player-provider";
import { Button, Chip, Label, Notice, Row, Toggle } from "./components";
import { time } from "../data/defaults";
export function LiveFilterControls() {
  const live=useSpotifyPlayer();const app=useApp();const router=useRouter();
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState<string|null>(null);
  if(!live.snapshot.track || live.snapshot.track.uri.startsWith("spotify:episode:")) return null;
  const ready=live.lyrics.data?.status==="synced";
  const next=live.filterPlan.find(action=>action.action!=="skip-song"&&action.endMs>live.snapshot.positionMs)??live.filterPlan.find(action=>action.action!=="skip-song");
  const preview=async()=>{
    if(!next || !live.service) return;
    setBusy(true);setError(null);
    try {await live.service.resumeAt(Math.max(0,next.startMs-3000));}
    catch {setError("The filter preview could not start. Retry the player.");}
    finally {setBusy(false);}
  };
  const events=live.filterEvents.filter(event=>event.trackUri===live.snapshot.track?.uri);
  return <View style={{gap:12}}>
    <Label bold size={18}>Filter plan</Label>
    <Label muted size={12}>Clean versions are preferred when you select a song. Mute rules silence all sound around estimated words on supported browsers; otherwise they skip whole lines. Skip-song rules stop playback. Timing can miss words.</Label>
    {live.canMute ? <Row><View style={{flex:1}}><Label bold>Mute around words</Label><Label muted size={12}>Estimated timing · music also goes silent briefly. Turn off to skip whole lines.</Label></View><Toggle label="Use estimated word muting" value={live.wordMuting} onChange={live.setWordMuting}/></Row> : <Label muted size={12}>Volume control unavailable on this device. Mute rules skip whole lyric lines.</Label>}
    <View style={{flexDirection:"row",flexWrap:"wrap",gap:8}}>{app.profiles.map(profile=><Chip key={profile.id} selected={app.active.id===profile.id} onPress={()=>app.selectProfile(profile.id)}>{profile.name}</Chip>)}</View>
    {live.unsupported.length>0&&<Label muted size={12}>Not checked: {live.unsupported.join(", ")}. Topic checks and these categories are not implemented.</Label>}
    {live.filterFault&&<Notice><Label>{live.filterFault}</Label><View style={{marginTop:12}}><Button secondary onPress={()=>live.setFilterEnabled(true)}>Restart filtering</Button></View></Notice>}
    {!ready ? <Label muted size={12}>{live.lyrics.status==="loading"?"Preparing timed lyrics before filtering. Playback pauses if filtering is enabled.":"No usable synced lyrics: filtering cannot run for this song. Turn filtering off to play the original."}</Label> : <>
      <Label bold size={13}>{live.filterPlan.length} planned {live.filterPlan.length===1?"action":"actions"}</Label>
      {live.filterPlan.length===0&&<Label muted size={12}>No matches in this vocabulary. This is not a clean-content verdict.</Label>}
      {live.filterPlan.map((action,index)=><Label key={index} size={12}>{action.action==="skip-song"?"Stop song":`${action.action==="mute"?"Mute":"Skip"} ${time(action.startMs)} → ${time(action.endMs)}`} · {action.reasons.join(", ")}</Label>)}
      {next&&<Button secondary disabled={!live.filterEnabled || Boolean(live.filterFault) || busy || live.snapshot.status!=="ready"} onPress={()=>void preview()}>{busy?"Starting preview…":"Preview next filter"}</Button>}
    </>}
    {events.slice(0,3).map((event,index)=><Label key={index} muted size={12}>{event.kind==="stop"?"Stop sent":event.kind==="mute"?`Mute sent ${time(event.startMs)} → ${time(event.endMs)}`:`Jump sent ${time(event.startMs)} → ${time(event.endMs)}`} · {event.reason}</Label>)}
    {error&&<Label>{error}</Label>}
    <Button secondary onPress={()=>router.navigate("/filtering")}>Edit filters</Button>
  </View>;
}

export function LiveFilterToggle() {
  const live=useSpotifyPlayer();
  if(!live.snapshot.track || live.snapshot.track.uri.startsWith("spotify:episode:")) return null;
  const ready=live.lyrics.data?.status==="synced";
  return <Row><View style={{flex:1}}><Label bold>Filter this song</Label><Label muted size={12}>{live.filterEnabled?(live.filterFault?"Stopped — restart below":ready?(live.snapshot.paused?"Ready · playback paused":"On · keep this app visible"):(live.snapshot.paused?"Waiting for lyrics · paused":"Preparing lyrics · pause requested")):"Off · no timed filtering"}</Label></View><Toggle label="Enable live lyric filtering" value={live.filterEnabled} onChange={live.setFilterEnabled}/></Row>;
}
