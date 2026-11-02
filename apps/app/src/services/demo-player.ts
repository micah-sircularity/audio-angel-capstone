import type {
  PlayerAdapter,
  PlaybackState,
  Track,
} from "@audio-angel/contracts";
import { tracks } from "../data/demo";
export class DemoPlayer implements PlayerAdapter {
  readonly mode = "demo" as const;
  private state: PlaybackState = {
    track: tracks[0],
    positionMs: 78000,
    playing: false,
  };
  private listeners = new Set<(state: PlaybackState) => void>();
  private anchor = Date.now();
  private volume = 1;
  private timer: ReturnType<typeof setInterval> | null = null;
  getState = () => this.state;
  subscribe = (listener: (state: PlaybackState) => void) => {
    this.listeners.add(listener);
    if (!this.timer) this.timer = setInterval(() => this.tick(), 200);
    return () => {
      this.listeners.delete(listener);
      if (!this.listeners.size && this.timer) {
        clearInterval(this.timer);
        this.timer = null;
      }
    };
  };
  private emit() {
    this.listeners.forEach((fn) => fn(this.state));
  }
  private tick() {
    const now = Date.now();
    const elapsed = now - this.anchor;
    this.anchor = now;
    if (!this.state.playing) return;
    // Large gaps mean the app was suspended: pause instead of replaying stale actions.
    if (elapsed > 2500) {
      this.state = { ...this.state, playing: false };
      this.emit();
      return;
    }
    const positionMs = this.state.positionMs + elapsed;
    if (positionMs >= this.state.track.durationMs) {
      void this.next();
      return;
    }
    this.state = { ...this.state, positionMs };
    this.emit();
  }
  async play(track?: Track) {
    this.anchor = Date.now();
    this.state = {
      track: track ?? this.state.track,
      positionMs: track ? 0 : this.state.positionMs,
      playing: true,
    };
    this.emit();
  }
  async pause() {
    this.state = { ...this.state, playing: false };
    this.emit();
  }
  async seek(positionMs: number) {
    this.anchor = Date.now();
    this.state = {
      ...this.state,
      positionMs: Math.max(
        0,
        Math.min(positionMs, this.state.track.durationMs),
      ),
    };
    this.emit();
  }
  async next() {
    const i = tracks.findIndex((t) => t.id === this.state.track.id);
    await this.play(tracks[(i + 1) % tracks.length]);
  }
  async previous() {
    const i = tracks.findIndex((t) => t.id === this.state.track.id);
    await this.play(tracks[(i + tracks.length - 1) % tracks.length]);
  }
  async setVolume(volume: number) {
    this.volume = Math.max(0, Math.min(1, volume));
  }
  dispose() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.listeners.clear();
  }
}
