import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FilterScheduler, type FilterEvent, type FilterPlayer } from "./filter-scheduler";
import type { PlaybackSnapshot } from "./playback";
const uri="spotify:track:0fuLRqMU6IaRoNAFIUdjPx";
function fixture(positionMs=9000) {
  let snapshot:PlaybackSnapshot={status:"ready",track:{uri,name:"Fixture",artist:"Artist",album:"Album",imageUrl:null},positionMs,durationMs:240000,paused:false,error:null,needsUserGesture:false};
  const listeners=new Set<()=>void>();
  const update=(patch:Partial<PlaybackSnapshot>)=>{snapshot={...snapshot,...patch};listeners.forEach(listener=>listener());};
  const player:FilterPlayer={getSnapshot:()=>snapshot,subscribe:listener=>{listeners.add(listener);return()=>{listeners.delete(listener);};},seek:vi.fn(async position=>update({positionMs:position})),pause:vi.fn(async()=>update({paused:true}))};
  const events:FilterEvent[]=[];const faults:string[]=[];
  const scheduler=new FilterScheduler(player,{onEvent:event=>events.push(event),onFault:message=>faults.push(message),now:()=>Date.now()});
  const plan=[{startMs:10000,endMs:12000,action:"skip-section" as const,reasons:["Cuss words"]}];
  const enable=()=>scheduler.configure({enabled:true,ready:true,uri,plan});
  return {player,scheduler,events,faults,update,enable,plan};
}
const cleanup:FilterScheduler[]=[];
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(0);});
afterEach(()=>{cleanup.splice(0).forEach(s=>s.dispose());vi.useRealTimers();});
function setup(position?:number) {const f=fixture(position);cleanup.push(f.scheduler);return f;}
describe("foreground Spotify filter scheduler",()=>{
  it("advances its playback clock between SDK updates and sends a single seek",async()=>{
    const f=setup();f.enable();
    await vi.advanceTimersByTimeAsync(1000);
    expect(f.player.seek).toHaveBeenCalledExactlyOnceWith(12000);
    expect(f.events).toEqual([{trackUri:uri,startMs:10000,endMs:12000,kind:"seek",reason:"Cuss words"}]);
    await vi.advanceTimersByTimeAsync(500);expect(f.player.seek).toHaveBeenCalledTimes(1);
  });
  it("does nothing while disabled or paused",async()=>{
    const f=setup(10500);
    await vi.advanceTimersByTimeAsync(500);expect(f.player.seek).not.toHaveBeenCalled();
    f.update({paused:true});f.enable();await vi.advanceTimersByTimeAsync(500);expect(f.player.seek).not.toHaveBeenCalled();
  });
  it("re-arms a span when the listener seeks backward",async()=>{
    const f=setup(10500);f.enable();await vi.advanceTimersByTimeAsync(50);
    f.update({positionMs:9000});await vi.advanceTimersByTimeAsync(1000);
    expect(f.player.seek).toHaveBeenCalledTimes(2);
  });
  it("pauses while lyrics are missing and never applies an old track plan",async()=>{
    const f=setup();f.scheduler.configure({enabled:true,ready:false,uri,plan:f.plan});await vi.advanceTimersByTimeAsync(50);
    expect(f.player.pause).toHaveBeenCalledTimes(1);expect(f.player.seek).not.toHaveBeenCalled();
    f.enable();f.update({track:{uri:"spotify:track:1111111111111111111111",name:"Next",artist:"Artist",album:"Album",imageUrl:null},positionMs:10500,paused:false});await vi.advanceTimersByTimeAsync(50);
    expect(f.player.pause).toHaveBeenCalledTimes(2);expect(f.player.seek).not.toHaveBeenCalled();
  });
  it("replans immediately when the active profile changes",async()=>{
    const f=setup();f.enable();f.scheduler.configure({enabled:true,ready:true,uri,plan:[]});
    await vi.advanceTimersByTimeAsync(1500);expect(f.player.seek).not.toHaveBeenCalled();
  });
  it("stops on lost foreground or stale playback state",async()=>{
    const f=setup();f.enable();f.scheduler.setVisible(false);await vi.advanceTimersByTimeAsync(50);
    expect(f.player.pause).toHaveBeenCalled();expect(f.faults[0]).toContain("visible");
    const stale=setup(0);stale.enable();await vi.advanceTimersByTimeAsync(2600);
    expect(stale.player.pause).toHaveBeenCalled();expect(stale.faults[0]).toContain("updates stopped");
  });
  it("pauses after a failed seek and reports no completed action",async()=>{
    const f=setup(10500);vi.mocked(f.player.seek).mockRejectedValue(new Error("SDK rejected"));f.enable();await vi.advanceTimersByTimeAsync(100);
    expect(f.events).toEqual([]);expect(f.faults).toHaveLength(1);expect(f.player.pause).toHaveBeenCalled();
  });
  it("skip-song rules pause the song again if the user tries to resume it",async()=>{
    const f=setup();f.scheduler.configure({enabled:true,ready:true,uri,plan:[{...f.plan[0],startMs:0,endMs:240000,action:"skip-song"}]});await vi.advanceTimersByTimeAsync(50);
    f.update({paused:false});await vi.advanceTimersByTimeAsync(50);expect(f.player.pause).toHaveBeenCalledTimes(2);expect(f.player.seek).not.toHaveBeenCalled();
  });
  it("does not record a late completion from an old track",async()=>{
    const f=setup(10500);let complete!:()=>void;
    vi.mocked(f.player.seek).mockImplementation(()=>new Promise<void>(resolve=>{complete=resolve;}));f.enable();
    f.scheduler.configure({enabled:true,ready:true,uri:"spotify:track:1111111111111111111111",plan:[]});complete();await vi.advanceTimersByTimeAsync(50);expect(f.events).toEqual([]);
  });
  it("pauses and faults when the SDK never resolves a seek",async()=>{
    const f=setup(10500);vi.mocked(f.player.seek).mockImplementation(()=>new Promise<void>(()=>{}));f.enable();
    await vi.advanceTimersByTimeAsync(1600);expect(f.player.pause).toHaveBeenCalled();expect(f.faults).toHaveLength(1);expect(f.events).toEqual([]);
  });
  it("removes timers and subscriptions on dispose",async()=>{
    const f=setup();f.enable();f.scheduler.dispose();f.update({positionMs:10500});await vi.advanceTimersByTimeAsync(1000);expect(f.player.seek).not.toHaveBeenCalled();
  });
});

describe("timed mute lifecycle",()=>{
  const plan=[{startMs:10000,endMs:11000,action:"mute" as const,reasons:["Word"]}];
  it("mutes without seeking and restores at the end",async()=>{
    const f=setup(10000);f.player.setMuted=vi.fn(async()=>{});
    f.scheduler.configure({enabled:true,ready:true,uri,plan});await vi.advanceTimersByTimeAsync(50);
    expect(f.player.setMuted).toHaveBeenCalledWith(true);expect(f.player.seek).not.toHaveBeenCalled();expect(f.events[0].kind).toBe("mute");
    await vi.advanceTimersByTimeAsync(1000);expect(f.player.setMuted).toHaveBeenLastCalledWith(false);
  });
  it.each(["pause","disable","profile","track","seek","hidden","dispose"])("restores on %s",async action=>{
    const f=setup(10000);f.player.setMuted=vi.fn(async()=>{});f.scheduler.configure({enabled:true,ready:true,uri,plan});await vi.advanceTimersByTimeAsync(50);
    if(action==="pause") f.update({paused:true});
    if(action==="disable") f.scheduler.configure({enabled:false,ready:true,uri,plan});
    if(action==="profile") f.scheduler.configure({enabled:true,ready:true,uri,plan:[]});
    if(action==="track") f.update({track:{uri:"spotify:track:2222222222222222222222",name:"Next",artist:"A",album:"B",imageUrl:null}});
    if(action==="seek") f.update({positionMs:20000});
    if(action==="hidden") f.scheduler.setVisible(false);
    if(action==="dispose") f.scheduler.dispose();
    await vi.advanceTimersByTimeAsync(50);expect(f.player.setMuted).toHaveBeenLastCalledWith(false);
  });
  it("requests pause and restore when muting fails",async()=>{
    const f=setup(10000);f.player.setMuted=vi.fn(async muted=>{if(muted) throw Error("volume");});f.scheduler.configure({enabled:true,ready:true,uri,plan});await vi.advanceTimersByTimeAsync(100);
    expect(f.player.pause).toHaveBeenCalled();expect(f.player.setMuted).toHaveBeenLastCalledWith(false);expect(f.events).toEqual([]);
  });
});

it("re-arms a mute when resuming inside the same word",async()=>{
  const f=setup(10000);f.player.setMuted=vi.fn(async()=>{});const plan=[{startMs:10000,endMs:11000,action:"mute" as const,reasons:["Word"]}];
  f.scheduler.configure({enabled:true,ready:true,uri,plan});await vi.advanceTimersByTimeAsync(50);f.update({paused:true});await vi.advanceTimersByTimeAsync(50);f.update({paused:false});await vi.advanceTimersByTimeAsync(50);
  expect(vi.mocked(f.player.setMuted).mock.calls.map(call=>call[0])).toEqual([true,false,true]);
});
it("pauses a delayed playback start after the app was hidden",async()=>{
  const f=setup();f.enable();f.scheduler.setVisible(false);await vi.advanceTimersByTimeAsync(50);f.update({paused:false});await vi.advanceTimersByTimeAsync(50);expect(f.player.pause).toHaveBeenCalledTimes(2);
});
