import type { FilterPlayer, FilterSnapshot } from "../filtering/filter-scheduler";

/**
 * Streams one remote audio file (Audius track or podcast enclosure) in a
 * lazily-created <audio> element and mutes through a Web Audio GainNode
 * so word-level dips do not disturb element volume.
 *
 * Web only: the element and AudioContext are created lazily and never at
 * module scope, so importing this file on native is safe (calls no-op).
 *
 * CORS: a MediaElementSource on a stream that did not answer CORS
 * preflight outputs silence, so the element starts with
 * crossOrigin="anonymous" and, if the load fails before `canplay`,
 * retries exactly once without CORS and falls back to element.muted.
 */

/** Minimal surface of HTMLAudioElement used by the player. */
export type AudioElementLike = {
  src: string;
  preload: string;
  crossOrigin: string | null;
  currentTime: number;
  readonly duration: number;
  readonly paused: boolean;
  readonly ended?: boolean;
  muted: boolean;
  play(): Promise<void>;
  pause(): void;
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
};

export type AudioParamLike = {
  value: number;
  setTargetAtTime(value: number, startTime: number, timeConstant: number): void;
};
export type AudioNodeLike = {
  connect(node: AudioNodeLike): void;
  disconnect(): void;
};
export type GainNodeLike = AudioNodeLike & { gain: AudioParamLike };
export type AudioContextLike = {
  readonly currentTime: number;
  readonly destination: AudioNodeLike;
  resume(): Promise<void>;
  close(): Promise<void>;
  createMediaElementSource(element: AudioElementLike): AudioNodeLike;
  createGain(): GainNodeLike;
};

export type LoadOptions = {
  streamUrl: string;
  /** Stored into snapshot.track.uri; drives scheduler plan matching. */
  sourceKey: string;
  /** Used until the element reports a finite duration. */
  durationHint?: number | null;
};

export type AudioFilePlayerDeps = {
  createElement?: () => AudioElementLike | null;
  createAudioContext?: () => AudioContextLike | null;
};

const idleSnapshot: FilterSnapshot = {
  status: "idle",
  track: null,
  positionMs: 0,
  durationMs: 0,
  paused: true,
  error: null,
  needsUserGesture: false,
};

type Graph = { ctx: AudioContextLike; source: AudioNodeLike; gain: GainNodeLike };

const defaultCreateElement = (): AudioElementLike | null =>
  typeof document === "undefined" ? null : document.createElement("audio");

const defaultCreateAudioContext = (): AudioContextLike | null => {
  const scope = globalThis as {
    AudioContext?: new () => AudioContextLike;
    webkitAudioContext?: new () => AudioContextLike;
  };
  const Ctor = scope.AudioContext ?? scope.webkitAudioContext;
  return Ctor ? new Ctor() : null;
};

export class AudioFilePlayer implements FilterPlayer {
  private readonly createElement: () => AudioElementLike | null;
  private readonly createAudioContext: () => AudioContextLike | null;
  private element: AudioElementLike | null = null;
  private graph: Graph | null = null;
  /** False once a non-CORS retry made Web Audio capture unsafe. */
  private graphEnabled = true;
  private retriedNoCors = false;
  private sawCanPlay = false;
  private bindings: [string, () => void][] = [];
  private currentLoad: LoadOptions | null = null;
  private snapshot: FilterSnapshot = idleSnapshot;
  private listeners = new Set<() => void>();
  private disposed = false;

  constructor(deps: AudioFilePlayerDeps = {}) {
    this.createElement = deps.createElement ?? defaultCreateElement;
    this.createAudioContext = deps.createAudioContext ?? defaultCreateAudioContext;
  }

  getSnapshot = () => this.snapshot;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** "gain" while word-level muting works, "element-muted" after the CORS fallback. */
  get mode(): "gain" | "element-muted" | null {
    if (!this.element) return null;
    return this.graphEnabled ? "gain" : "element-muted";
  }

  private update(next: FilterSnapshot) {
    if (this.disposed) return;
    this.snapshot = next;
    this.listeners.forEach((listener) => listener());
  }

  private notify() {
    if (this.disposed) return;
    this.listeners.forEach((listener) => listener());
  }

  load(options: LoadOptions) {
    if (this.disposed) return;
    this.unload();
    this.currentLoad = options;
    this.graphEnabled = true;
    this.retriedNoCors = false;
    this.sawCanPlay = false;
    const element = this.createElement();
    if (!element) return; // Native: no DOM element available.
    element.preload = "auto";
    element.crossOrigin = "anonymous";
    this.attach(element);
    element.src = options.streamUrl;
    this.update({
      ...idleSnapshot,
      status: "connecting",
      track: { uri: options.sourceKey },
      durationMs:
        options.durationHint && options.durationHint > 0
          ? options.durationHint
          : 0,
    });
  }

  private unload() {
    this.detach();
    this.closeGraph();
    this.currentLoad = null;
    this.update(idleSnapshot);
  }

  private attach(element: AudioElementLike) {
    const on = (type: string, fn: () => void) => {
      element.addEventListener(type, fn);
      this.bindings.push([type, fn]);
    };
    on("timeupdate", () => this.sync());
    on("loadedmetadata", () => this.sync());
    on("durationchange", () => this.sync());
    on("seeking", () => this.sync());
    on("seeked", () => this.sync());
    on("play", () => this.sync());
    on("pause", () => this.sync());
    on("canplay", () => this.onCanPlay());
    on("ended", () => this.onEnded());
    on("error", () => this.onLoadFailure());
    on("stalled", () => this.onLoadFailure());
    this.element = element;
  }

  private detach() {
    const element = this.element;
    if (element) {
      for (const [type, fn] of this.bindings) {
        element.removeEventListener(type, fn);
      }
      try {
        element.pause();
      } catch {
        /* an element that never loaded can throw on pause */
      }
      element.src = "";
    }
    this.bindings = [];
    this.element = null;
  }

  private buildGraph(element: AudioElementLike) {
    try {
      const ctx = this.createAudioContext();
      if (!ctx) throw new Error("Web Audio unavailable");
      const source = ctx.createMediaElementSource(element);
      const gain = ctx.createGain();
      source.connect(gain);
      gain.connect(ctx.destination);
      this.graph = { ctx, source, gain };
      element.muted = false; // the gain node owns muting from here on
    } catch {
      // No Web Audio (or the capture failed): fall back to element.muted.
      this.graphEnabled = false;
      this.graph = null;
    }
    this.notify();
  }

  private closeGraph() {
    const graph = this.graph;
    this.graph = null;
    if (graph) {
      try {
        graph.source.disconnect();
      } catch {}
      try {
        graph.gain.disconnect();
      } catch {}
      void graph.ctx.close().catch(() => {});
    }
  }

  /** Retry the current stream once without CORS; element.muted takes over. */
  private retryWithoutCors() {
    const load = this.currentLoad;
    if (!load || this.retriedNoCors) return;
    this.retriedNoCors = true;
    this.graphEnabled = false;
    const resumeSeconds = this.element?.currentTime ?? 0;
    this.detach();
    this.closeGraph();
    const element = this.createElement();
    if (!element) return;
    element.preload = "auto";
    element.crossOrigin = null;
    this.attach(element);
    element.src = load.streamUrl;
    if (Number.isFinite(resumeSeconds) && resumeSeconds > 0) {
      element.currentTime = resumeSeconds;
    }
    this.update({ ...this.snapshot, status: "connecting", error: null });
  }

  /** Refresh position/duration/paused from element state. */
  private sync() {
    const element = this.element;
    if (!element || this.disposed) return;
    const previous = this.snapshot;
    const durationMs =
      Number.isFinite(element.duration) && element.duration > 0
        ? element.duration * 1000
        : previous.durationMs;
    this.update({
      ...previous,
      status: previous.status === "idle" ? "connecting" : previous.status,
      durationMs,
      positionMs: Math.max(0, element.currentTime * 1000),
      paused: element.paused,
      needsUserGesture: element.paused ? previous.needsUserGesture : false,
    });
  }

  private onCanPlay() {
    this.sawCanPlay = true;
    if (!this.disposed && this.snapshot.status !== "error") {
      this.update({ ...this.snapshot, status: "ready", error: null });
    }
  }

  private onEnded() {
    if (this.disposed) return;
    this.update({
      ...this.snapshot,
      positionMs: this.snapshot.durationMs,
      paused: true,
    });
  }

  /** `error` and pre-canplay `stalled` both mean the fetch failed. */
  private onLoadFailure() {
    if (this.disposed) return;
    if (!this.sawCanPlay && !this.retriedNoCors) {
      this.retryWithoutCors();
      return;
    }
    this.update({
      ...this.snapshot,
      status: "error",
      error:
        "This audio could not be loaded. Check the connection and try again.",
      paused: true,
    });
  }

  async play(): Promise<void> {
    const element = this.element;
    if (!element || this.disposed) return;
    if (this.graphEnabled && !this.graph) this.buildGraph(element);
    if (this.graph) {
      try {
        await this.graph.ctx.resume();
      } catch {
        /* resume can fail outside a gesture; play() reports it anyway */
      }
    }
    try {
      await element.play();
      if (element !== this.element) return;
      this.update({
        ...this.snapshot,
        paused: false,
        needsUserGesture: false,
        error: null,
      });
    } catch (caught) {
      if (element !== this.element) return;
      if ((caught as { name?: string } | null)?.name === "NotAllowedError") {
        // Autoplay policy: stay ready and surface a tap-to-play affordance.
        this.update({ ...this.snapshot, needsUserGesture: true });
        return;
      }
      this.update({
        ...this.snapshot,
        error: "Playback failed. Press play to try again.",
      });
      throw caught;
    }
  }

  async resume(): Promise<void> {
    return this.play();
  }

  async pause(): Promise<void> {
    const element = this.element;
    if (!element) return;
    element.pause();
    if (element === this.element && !this.snapshot.paused) {
      this.update({ ...this.snapshot, paused: true });
    }
  }

  async seek(positionMs: number): Promise<void> {
    const element = this.element;
    if (!element || !Number.isFinite(positionMs)) return;
    const durationMs = this.snapshot.durationMs;
    const target = Math.max(
      0,
      Math.min(positionMs, durationMs > 0 ? durationMs : positionMs),
    );
    element.currentTime = target / 1000;
    if (element === this.element) {
      this.update({ ...this.snapshot, positionMs: target });
    }
  }

  setMuted(muted: boolean): Promise<void> {
    const element = this.element;
    if (!element) return Promise.resolve();
    if (this.graph) {
      this.graph.gain.gain.setTargetAtTime(
        muted ? 0 : 1,
        this.graph.ctx.currentTime,
        0.012,
      );
    } else {
      element.muted = muted;
    }
    return Promise.resolve();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.detach();
    this.closeGraph();
    this.listeners.clear();
  }
}
