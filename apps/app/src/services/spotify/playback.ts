import { resolveCleanVersion, type CleanChoice } from "./clean-version";
export type SpotifyPlayerState = {
  position: number;
  duration: number;
  paused: boolean;
  track_window: {
    current_track: {
      uri: string;
      name: string;
      artists?: { name: string }[];
      show?: { name: string; publisher?: string; images?: {url:string}[] };
      album?: { name: string; images: { url: string }[] };
      images?: { url: string }[];
    };
  };
} | null;
export type SpotifyPlayerOptions = {
  name: string;
  getOAuthToken: (callback: (token: string) => void) => void;
  volume?: number;
};
export type SpotifyPlayerEvent =
  | "ready"
  | "not_ready"
  | "player_state_changed"
  | "initialization_error"
  | "authentication_error"
  | "account_error"
  | "playback_error"
  | "autoplay_failed";
export interface SpotifyPlayer {
  connect(): Promise<boolean>;
  disconnect(): void;
  addListener(
    event: SpotifyPlayerEvent,
    callback: (payload: never) => void,
  ): boolean;
  removeListener(
    event: SpotifyPlayerEvent,
    callback?: (payload: never) => void,
  ): boolean;
  getCurrentState(): Promise<SpotifyPlayerState>;
  activateElement(): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  seek(positionMs: number): Promise<void>;
  getVolume(): Promise<number>;
  setVolume(volume:number): Promise<void>;
}
export type PlaybackTrack = {
  uri: string;
  name: string;
  artist: string;
  album: string;
  imageUrl: string | null;
};
export type PlaybackSnapshot = {
  status: "idle" | "connecting" | "ready" | "offline" | "error";
  track: PlaybackTrack | null;
  positionMs: number;
  durationMs: number;
  paused: boolean;
  error: string | null;
  needsUserGesture: boolean;
  cleanChoice?: CleanChoice;
};
export type PlaybackDeps = {
  createPlayer: (options: SpotifyPlayerOptions) => SpotifyPlayer;
  getAccessToken: () => Promise<string>;
  fetch: (input: string, init?: RequestInit) => Promise<Response>;
  pollIntervalMs?: number;
  connectTimeoutMs?: number;
  requestTimeoutMs?: number;
};
export class SpotifyPlaybackError extends Error {}
const idleSnapshot: PlaybackSnapshot = {
  status: "idle",
  track: null,
  positionMs: 0,
  durationMs: 0,
  paused: true,
  error: null,
  needsUserGesture: false,
};
const ERROR_MESSAGES = {
  auth: "Reconnect Spotify from Settings to keep live playback working.",
  premium:
    "Spotify Premium and developer-app access are required for playback.",
  device: "The browser player went offline. Retry the player below.",
  connect:
    "Spotify's player could not connect. Check your connection and retry.",
  timeout: "Spotify took too long to respond. Try playing again.",
  generic: "Spotify playback failed. Retry the player or try again later.",
  rateLimit: "Spotify is rate limiting requests. Wait and try again.",
};
const urlTrack =
  /^\/(?:intl-[a-z]{2}(?:-[a-z]{2})?\/)?(track|episode)\/([A-Za-z0-9]{22})\/?$/i;
/** Accepts a track/episode URI or link; bare IDs are treated as tracks. */
export function normalizeSpotifyTrack(input: string): string | null {
  const value = input.trim();
  const uri = /^spotify:(track|episode):([A-Za-z0-9]{22})$/.exec(value);
  if (uri) return `spotify:${uri[1]}:${uri[2]}`;
  if (/^[A-Za-z0-9]{22}$/.test(value)) return `spotify:track:${value}`;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (
    url.protocol !== "https:" ||
    url.hostname !== "open.spotify.com" ||
    url.username ||
    url.password
  )
    return null;
  const match = urlTrack.exec(url.pathname);
  return match ? `spotify:${match[1]}:${match[2]}` : null;
}
export class SpotifyPlayback {
  private snapshot: PlaybackSnapshot = idleSnapshot;
  private listeners = new Set<() => void>();
  private player: SpotifyPlayer | null = null;
  private deviceId: string | null = null;
  private connectInFlight: Promise<void> | null = null;
  private connectSettle: (() => void) | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private pollInFlight = false;
  private connectTimer: ReturnType<typeof setTimeout> | null = null;
  private requestTimer: ReturnType<typeof setTimeout> | null = null;
  private handlers: [SpotifyPlayerEvent, (payload: never) => void][] = [];
  private stateRevision = 0;
  private generation = 0;
  private inflight: AbortController | null = null;
  private disposed = false;
  private readonly pollIntervalMs: number;
  private readonly connectTimeoutMs: number;
  private readonly requestTimeoutMs: number;
  constructor(private readonly deps: PlaybackDeps) {
    this.pollIntervalMs = deps.pollIntervalMs ?? 1000;
    this.connectTimeoutMs = deps.connectTimeoutMs ?? 20_000;
    this.requestTimeoutMs = deps.requestTimeoutMs ?? 20_000;
  }
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private update(snapshot: PlaybackSnapshot) {
    if (this.disposed) return;
    this.snapshot = snapshot;
    this.listeners.forEach((fn) => fn());
  }
  private on(event: SpotifyPlayerEvent, callback: (payload: never) => void) {
    this.handlers.push([event, callback]);
    this.player?.addListener(event, callback);
  }
  private applyState(state: NonNullable<SpotifyPlayerState>) {
    const track = state.track_window.current_track;
    this.stateRevision++;
    this.update({
      ...this.snapshot,
      cleanChoice: this.snapshot.cleanChoice?.uri === track.uri ? this.snapshot.cleanChoice : undefined,
      track: {
        uri: track.uri,
        name: track.name,
        artist: track.artists?.map((a) => a.name).join(", ") || track.show?.publisher || track.show?.name || "Spotify",
        album: track.album?.name ?? track.show?.name ?? "Podcast",
        imageUrl: track.album?.images[0]?.url ?? track.images?.[0]?.url ?? track.show?.images?.[0]?.url ?? null,
      },
      positionMs: state.position,
      durationMs: state.duration,
      paused: state.paused,
      needsUserGesture: false,
    });
  }
  private clearState() {
    this.stateRevision++;
    this.update({
      ...this.snapshot,
      track: null,
      positionMs: 0,
      durationMs: 0,
      paused: true,
    });
  }
  private startPolling() {
    this.stopPolling();
    this.pollTimer = setInterval(() => {
      const player = this.player;
      if (
        !player ||
        this.disposed ||
        this.pollInFlight ||
        this.snapshot.status !== "ready"
      )
        return;
      const revision = this.stateRevision;
      this.pollInFlight = true;
      player
        .getCurrentState()
        .then((state) => {
          // A newer SDK event or an offline transition wins over this poll.
          if (
            this.disposed ||
            revision !== this.stateRevision ||
            this.snapshot.status !== "ready"
          )
            return;
          if (state) this.applyState(state);
          else if (this.snapshot.track) this.clearState();
        })
        .catch(() => {})
        .finally(() => {
          this.pollInFlight = false;
        });
    }, this.pollIntervalMs);
    if (typeof this.pollTimer === "object")
      (this.pollTimer as { unref?: () => void }).unref?.();
  }
  private stopPolling() {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = null;
  }
  private fail(error: string) {
    this.update({ ...this.snapshot, status: "error", error });
  }
  /** Detach and disconnect an SDK instance so late events are ignored. */
  private dropPlayer(player: SpotifyPlayer) {
    for (const [event, handler] of this.handlers)
      player.removeListener(event, handler);
    player.disconnect();
    if (this.player === player) {
      this.player = null;
      this.deviceId = null;
    }
  }
  connect(): Promise<void> {
    if (this.disposed)
      return Promise.reject(
        new SpotifyPlaybackError("This player has been closed."),
      );
    if (this.snapshot.status === "ready") return Promise.resolve();
    if (this.connectInFlight) return this.connectInFlight;
    const generation = this.generation;
    this.update({ ...this.snapshot, status: "connecting", error: null });
    this.connectInFlight = new Promise<void>((resolve) => {
      let done = false;
      const finish = (error?: string) => {
        if (done) return;
        done = true;
        this.connectSettle = null;
        if (this.connectTimer) clearTimeout(this.connectTimer);
        this.connectTimer = null;
        if (error && this.player) this.dropPlayer(this.player);
        if (error) this.fail(error);
        resolve();
      };
      this.connectSettle = () => finish(); // Dispose settles a pending connect.
      this.connectTimer = setTimeout(
        () => finish(ERROR_MESSAGES.timeout),
        this.connectTimeoutMs,
      );
      if (typeof this.connectTimer === "object")
        (this.connectTimer as { unref?: () => void }).unref?.();
      let player: SpotifyPlayer;
      try {
        player = this.deps.createPlayer({
          name: "Audio Angel",
          getOAuthToken: (callback) => {
            const tokenGeneration = this.generation;
            void this.deps
              .getAccessToken()
              .then((token) => {
                if (!this.disposed && tokenGeneration === this.generation)
                  callback(token);
              })
              .catch(() => {
                if (!this.disposed && tokenGeneration === this.generation)
                  this.fail(ERROR_MESSAGES.auth);
              });
          },
          volume: 1,
        });
      } catch {
        finish(ERROR_MESSAGES.connect);
        return;
      }
      this.player = player;
      // Listeners must exist before connect() so the ready event is not missed.
      this.on("ready", (payload: { device_id: string }) => {
        // done is not gated: a new ready also restores after not_ready.
        if (this.disposed || generation !== this.generation) return;
        this.deviceId = payload.device_id;
        this.update({ ...this.snapshot, status: "ready", error: null });
        this.startPolling();
        finish();
      });
      this.on("not_ready", () => {
        if (this.disposed) return;
        this.deviceId = null;
        this.stopPolling();
        this.clearState();
        if (!done) {
          finish(ERROR_MESSAGES.device);
          return;
        }
        this.update({ ...this.snapshot, status: "offline", error: null });
      });
      this.on("player_state_changed", (state: SpotifyPlayerState) => {
        if (this.disposed) return;
        if (state) this.applyState(state);
        else this.clearState();
      });
      this.on("authentication_error", () => {
        if (!this.disposed) this.fail(ERROR_MESSAGES.auth);
      });
      this.on("account_error", () => {
        if (!this.disposed) this.fail(ERROR_MESSAGES.premium);
      });
      this.on("initialization_error", () => {
        if (this.disposed) return;
        this.fail(
          "This browser cannot run Spotify playback. Allow protected content (EME) or try another browser.",
        );
      });
      this.on("playback_error", () => {
        if (!this.disposed) this.fail(ERROR_MESSAGES.generic);
      });
      this.on("autoplay_failed", () => {
        if (this.disposed) return;
        this.update({ ...this.snapshot, needsUserGesture: true });
      });
      Promise.resolve(player.connect())
        .then((connected) => {
          if (!connected && !done) finish(ERROR_MESSAGES.connect);
        })
        .catch(() => {
          if (!done) finish(ERROR_MESSAGES.connect);
        });
    }).finally(() => {
      this.connectInFlight = null;
    });
    return this.connectInFlight;
  }
  private requireReady(): SpotifyPlayer {
    if (this.disposed)
      throw new SpotifyPlaybackError("This player has been closed.");
    if (this.snapshot.status !== "ready" || !this.player || !this.deviceId)
      throw new SpotifyPlaybackError(
        "The Spotify player is not ready yet. Wait for it to connect.",
      );
    return this.player;
  }
  /** Synchronous entry: activateElement runs before any await for gestures. */
  async play(input: string, options: {preferClean?:boolean} = {}): Promise<void> {
    const player = this.requireReady();
    const uri = normalizeSpotifyTrack(input);
    if (!uri)
      throw new SpotifyPlaybackError(
        "Enter a Spotify song or episode link, URI or 22-character song ID.",
      );
    const activation = player.activateElement();
    const generation = this.generation;
    const deviceId = this.deviceId;
    const active = () =>
      !this.disposed &&
      generation === this.generation &&
      deviceId === this.deviceId;
    await this.command(async () => {
      await activation;
      if (!active()) return; // No token or request after dispose/reset.
      const controller = new AbortController();
      this.inflight = controller;
      let timedOut = false;
      this.requestTimer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, this.requestTimeoutMs);
      try {
        const choice = options.preferClean ? await resolveCleanVersion(uri, {getToken:this.deps.getAccessToken,fetch:this.deps.fetch,signal:controller.signal}) : {uri,status:"original" as const};
        if (!active()) return;
        this.update({...this.snapshot,cleanChoice:choice});
        const token = await this.deps.getAccessToken();
        if (!active()) return;
        const response = await this.deps.fetch(
          `https://api.spotify.com/v1/me/player/play?device_id=${encodeURIComponent(deviceId!)}`,
          {
            method: "PUT",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ uris: [choice.uri] }),
            cache: "no-store",
            signal: controller.signal,
          },
        );
        if (!active()) return;
        if (response.status === 204) return; // State arrives via SDK events.
        if (response.status === 401)
          throw new SpotifyPlaybackError(ERROR_MESSAGES.auth);
        if (response.status === 403)
          throw new SpotifyPlaybackError(ERROR_MESSAGES.premium);
        if (response.status === 404)
          throw new SpotifyPlaybackError(ERROR_MESSAGES.device);
        if (response.status === 429)
          throw new SpotifyPlaybackError(ERROR_MESSAGES.rateLimit);
        throw new SpotifyPlaybackError(ERROR_MESSAGES.generic);
      } catch (error) {
        if (error instanceof SpotifyPlaybackError) throw error;
        if (controller.signal.aborted) {
          if (!timedOut || !active()) return;
          throw new SpotifyPlaybackError(ERROR_MESSAGES.timeout);
        }
        if (!active()) return;
        throw new SpotifyPlaybackError(
          "Could not reach Spotify. Check your connection and retry.",
        );
      } finally {
        if (this.requestTimer) clearTimeout(this.requestTimer);
        this.requestTimer = null;
        this.inflight = null;
      }
    });
  }
  private async command(run: () => Promise<void>) {
    const generation = this.generation;
    const active = () => !this.disposed && generation === this.generation;
    try {
      if (this.snapshot.error) this.update({ ...this.snapshot, error: null });
      await run();
    } catch (error) {
      if (!active()) return; // No error publication after dispose or reset.
      const message =
        error instanceof SpotifyPlaybackError
          ? error.message
          : ERROR_MESSAGES.generic;
      this.update({ ...this.snapshot, error: message });
      throw error instanceof SpotifyPlaybackError
        ? error
        : new SpotifyPlaybackError(message);
    }
  }
  /** Run before playback; iOS is excluded because its SDK volume readback is fixed at one. */
  async supportsVolumeControl():Promise<boolean> {
    const player=this.requireReady();
    if(typeof player.getVolume!=="function" || typeof player.setVolume!=="function") return false;
    const ios=typeof navigator!=="undefined" && (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform==="MacIntel" && navigator.maxTouchPoints>1));
    if(ios || !this.snapshot.paused) return false;
    let original:number|null=null;
    const deadline=<T>(promise:Promise<T>)=>new Promise<T>((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error("Volume check timed out")),1500);
      promise.then(value=>{clearTimeout(timer);resolve(value);},error=>{clearTimeout(timer);reject(error);});
    });
    try {
      original=await deadline(player.getVolume());
      const target=original>0.5?0.25:0.75;
      await deadline(player.setVolume(target));
      const actual=await deadline(player.getVolume());
      try {await deadline(player.setVolume(original));} catch {return false;}
      return Math.abs(actual-target)<0.02;
    } catch {return false;}
    finally {if(original!==null) await deadline(player.setVolume(original)).catch(()=>{});}
  }
  private volumeQueue: Promise<void> = Promise.resolve();
  private restoreVolume: number | null = null;
  private wantsMute = false;
  setMuted(muted:boolean):Promise<void> {
    this.wantsMute=muted;
    const sync=async()=>{
      const player=this.player;
      if(!player) return;
      if(this.wantsMute) {
        if(this.restoreVolume===null) {
          const volume=await player.getVolume();
          if(!Number.isFinite(volume) || volume<0 || volume>1) throw new Error("Volume control unavailable");
          this.restoreVolume=volume;
        }
        if(this.wantsMute) await player.setVolume(0);
      }
      if(!this.wantsMute && this.restoreVolume!==null) {
        const volume=this.restoreVolume;
        await player.setVolume(volume);
        this.restoreVolume=null;
      }
    };
    const result=this.volumeQueue.catch(()=>{}).then(sync);
    this.volumeQueue=result;
    return result;
  }
  async pause(): Promise<void> {
    const player = this.player;
    if (!player || this.disposed || this.snapshot.status !== "ready") return;
    const uri = this.snapshot.track?.uri;
    const generation = this.generation;
    await this.command(() => player.pause());
    if (!this.disposed && generation === this.generation && this.snapshot.track?.uri === uri) {
      this.stateRevision++;
      this.update({...this.snapshot, paused:true});
    }
  }
  async resume(): Promise<void> {
    const player = this.requireReady();
    const activation = player.activateElement();
    const generation = this.generation;
    await this.command(async () => {
      await activation;
      if (this.disposed || generation !== this.generation) return;
      await player.resume();
    });
  }
  async seek(positionMs: number): Promise<void> {
    const player = this.requireReady();
    if (!Number.isFinite(positionMs)) return;
    const duration = this.snapshot.durationMs;
    if (!(duration > 0)) return; // No seeks without a known duration.
    const target = Math.min(
      Math.max(0, positionMs),
      Math.max(0, duration - 1),
    );
    const uri = this.snapshot.track?.uri;
    const generation = this.generation;
    await this.command(() => player.seek(target));
    if (!this.disposed && generation === this.generation && this.snapshot.track?.uri === uri) {
      this.stateRevision++;
      this.update({...this.snapshot, positionMs:target});
    }
  }
  /** Prime iOS audio in the tap, then seek and resume without autoplay assumptions. */
  async resumeAt(positionMs:number):Promise<void> {
    const player=this.requireReady();
    const generation=this.generation;
    const uri=this.snapshot.track?.uri;
    const activation=player.activateElement();
    await activation;
    if(this.disposed || generation!==this.generation || this.snapshot.track?.uri!==uri) return;
    await this.seek(positionMs);
    if(this.disposed || generation!==this.generation || this.snapshot.track?.uri!==uri) return;
    await this.resume();
  }
  dispose() {
    if (this.disposed) return;
    void this.setMuted(false).catch(()=>{});
    this.disposed = true;
    this.generation++;
    this.connectSettle?.();
    this.inflight?.abort();
    if (this.requestTimer) clearTimeout(this.requestTimer);
    this.requestTimer = null;
    this.stopPolling();
    if (this.connectTimer) clearTimeout(this.connectTimer);
    this.connectTimer = null;
    const player = this.player;
    if (player) {
      void player.pause().catch(() => {}); // Best effort, then detach.
      this.dropPlayer(player);
    }
    this.handlers = [];
    this.deviceId = null;
    this.listeners.clear();
    this.snapshot = idleSnapshot;
  }
}
