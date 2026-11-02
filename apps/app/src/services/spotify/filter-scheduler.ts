import type { PlannedAction } from "@audio-angel/contracts";
import type { PlaybackSnapshot } from "./playback";
export type FilterPlayer = {
  getSnapshot(): PlaybackSnapshot;
  subscribe(listener:()=>void):()=>void;
  seek(positionMs:number):Promise<void>;
  pause():Promise<void>;
  setMuted?(muted:boolean):Promise<void>;
};
export type FilterEvent = {trackUri:string;startMs:number;endMs:number;reason:string;kind:"seek"|"stop"|"mute"};
type Configuration = {enabled:boolean;uri:string|null;plan:readonly PlannedAction[];ready:boolean};
/** Foreground, metadata-only scheduler. It never receives or inspects Spotify audio. */
export class FilterScheduler {
  private config: Configuration = {enabled:false,uri:null,plan:[],ready:false};
  private configurationKey = "";
  private snapshot: PlaybackSnapshot;
  private anchoredAt: number;
  private fired = new Set<number>();
  private inFlight = false;
  private visible = true;
  private failed = false;
  private disposed = false;
  private mutedUntil:number|null=null;
  private unsubscribe:()=>void;
  private timer:ReturnType<typeof setInterval>;
  private deadlines=new Set<ReturnType<typeof setTimeout>>();
  constructor(private readonly player: FilterPlayer, private readonly callbacks:{
    onEvent:(event:FilterEvent)=>void; onFault:(message:string)=>void; now?:()=>number;
  }) {
    this.snapshot = player.getSnapshot();
    this.anchoredAt = this.now();
    this.unsubscribe = player.subscribe(()=>{
      const next = player.getSnapshot();
      if (next.track?.uri !== this.snapshot.track?.uri || next.positionMs < this.snapshot.positionMs - 500 || (next.paused && !this.snapshot.paused)) this.fired.clear();
      this.snapshot=next;this.anchoredAt=this.now();
      void this.tick();
    });
    this.timer = setInterval(()=>void this.tick(),50);
  }
  private now() {return this.callbacks.now?.() ?? performance.now();}
  configure(config:Configuration) {
    const key=JSON.stringify(config);
    if (key!==this.configurationKey) {
      this.fired.clear();this.failed=false;
      void this.restore();
      this.configurationKey=key;
    }
    this.config=config;
    if(config.enabled && !this.visible) this.fault("Filtering stopped: keep the app visible and restart filtering. A pause was requested.");
    void this.tick();
  }
  setVisible(visible:boolean) {
    this.visible=visible;
    if (!visible && this.config.enabled && !this.failed) this.fault("Filtering stopped: keep the app visible. A pause was requested; restart filtering here.");
  }
  private fault(message:string) {
    if (this.failed || this.disposed) return;
    this.failed=true;
    void this.restore();
    this.callbacks.onFault(message);
    void this.player.pause().catch(()=>{});
  }
  private async restore() {
    if(this.mutedUntil===null) return;
    this.mutedUntil=null;
    try {await this.command(()=>this.player.setMuted?.(false)??Promise.resolve());} catch {this.fault("Could not restore volume. Pause requested; check Spotify volume before resuming.");}
  }
  private async command(run:()=>Promise<void>) {
    let deadline:ReturnType<typeof setTimeout>|undefined;
    try {
      await Promise.race([run(),new Promise<never>((_,reject)=>{
        deadline=setTimeout(()=>reject(new Error("Spotify command timed out")),1500);
        this.deadlines.add(deadline);
      })]);
    } finally {if(deadline){clearTimeout(deadline);this.deadlines.delete(deadline);}}
  }
  async tick():Promise<void> {
    const state=this.snapshot;
    const position=Math.min(state.durationMs,state.positionMs+(state.paused?0:this.now()-this.anchoredAt));
    if(this.mutedUntil!==null && (this.disposed || this.failed || !this.config.enabled || !this.visible || state.paused || state.track?.uri!==this.config.uri || state.status!=="ready" || position>=this.mutedUntil || !this.config.plan.some(a=>a.action==="mute"&&position>=a.startMs&&position<a.endMs))) await this.restore();
    // A delayed play/seek response can arrive after a foreground fault. Keep requesting pause.
    if(!this.disposed && this.config.enabled && (this.failed || !this.visible) && state.status==="ready" && !state.paused && !this.inFlight) {
      this.inFlight=true;
      try {await this.command(()=>this.player.pause());} catch { /* Existing fault remains visible. */ }
      finally {this.inFlight=false;}
      return;
    }
    if(this.disposed || this.failed || !this.config.enabled || !this.visible || this.inFlight) return;
    if(state.status!=="ready" || state.paused || !state.track) return;
    if (!this.config.ready || state.track.uri!==this.config.uri) {
      this.inFlight=true;
      try {await this.command(()=>this.player.pause());} catch {this.fault("Could not pause while preparing lyrics. Stop playback in Spotify.");}
      finally {this.inFlight=false;}
      return;
    }
    const age=this.now()-this.anchoredAt;
    if(age>2500) {this.fault("Filtering stopped: Spotify position updates stopped. Pause requested; retry the player.");return;}
    const index=this.config.plan.findIndex(action=>position>=action.startMs && position<action.endMs);
    if(index<0) return;
    const action=this.config.plan[index];
    if(this.fired.has(index) && action.action!=="skip-song") return;
    if(action.action==="mute" && !this.player.setMuted) {this.fault("Volume control unavailable. Pause requested; use line skipping.");return;}
    this.fired.add(index);this.inFlight=true;
    const key=this.configurationKey;
    try {
      if(action.action==="mute") {
        this.mutedUntil=action.endMs;
        await this.command(()=>this.player.setMuted!(true));
      }
      else if(action.action==="skip-song") await this.command(()=>this.player.pause());
      else await this.command(()=>this.player.seek(action.endMs));
      if(!this.disposed && key===this.configurationKey && this.player.getSnapshot().track?.uri===state.track.uri) {
        this.callbacks.onEvent({trackUri:state.track.uri,startMs:action.startMs,endMs:action.endMs,kind:action.action==="skip-song"?"stop":action.action==="mute"?"mute":"seek",reason:action.reasons.join(", ")});
      }
    } catch {if(key===this.configurationKey) this.fault("Filtering failed. Pause requested; stop playback in Spotify if audio continues.");}
    finally {this.inFlight=false;}
  }
  dispose() {this.disposed=true;void this.restore();clearInterval(this.timer);for(const timer of this.deadlines)clearTimeout(timer);this.deadlines.clear();this.unsubscribe();}
}
