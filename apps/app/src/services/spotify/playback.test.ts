import { describe, expect, it, vi } from "vitest";
import {
  SpotifyPlayback,
  SpotifyPlaybackError,
  normalizeSpotifyTrack,
  type SpotifyPlayer,
  type SpotifyPlayerEvent,
  type SpotifyPlayerState,
} from "./playback";
const YELLOW = "3AJwUDP919kvQ9QcozQPxg";
class FakePlayer implements SpotifyPlayer {
  handlers = new Map<SpotifyPlayerEvent, ((payload: never) => void)[]>();
  connected = false;
  connectResult = true;
  activateCalls = 0;
  activation: Promise<void> = Promise.resolve();
  pauseCalls = 0;
  resumeCalls = 0;
  seeks: number[] = [];
  volume=0.7;
  getVolume(){return Promise.resolve(this.volume);}
  setVolume(volume:number){this.volume=volume;return Promise.resolve();}
  state: SpotifyPlayerState = null;
  addListener(event: SpotifyPlayerEvent, cb: (payload: never) => void) {
    const list = this.handlers.get(event) ?? [];
    list.push(cb);
    this.handlers.set(event, list);
    return true;
  }
  removeListener(event: SpotifyPlayerEvent, cb?: (payload: never) => void) {
    const list = this.handlers.get(event) ?? [];
    this.handlers.set(
      event,
      cb ? list.filter((fn) => fn !== cb) : [],
    );
    return true;
  }
  emit(event: SpotifyPlayerEvent, payload?: unknown) {
    for (const cb of this.handlers.get(event) ?? [])
      cb(payload as never);
  }
  connect() {
    this.connected = true;
    return Promise.resolve(this.connectResult);
  }
  disconnect() {
    this.connected = false;
  }
  getCurrentState() {
    return Promise.resolve(this.state);
  }
  activateElement() {
    this.activateCalls++;
    return this.activation;
  }
  pause() {
    this.pauseCalls++;
    return Promise.resolve();
  }
  resume() {
    this.resumeCalls++;
    return Promise.resolve();
  }
  seek(positionMs: number) {
    this.seeks.push(positionMs);
    return Promise.resolve();
  }
}
const trackState = (overrides: Partial<NonNullable<SpotifyPlayerState>> = {}) =>
  ({
    position: 1000,
    duration: 269000,
    paused: false,
    track_window: {
      current_track: {
        uri: `spotify:track:${YELLOW}`,
        name: "Yellow",
        artists: [{ name: "Coldplay" }],
        album: {
          name: "Parachutes",
          images: [{ url: "https://i.scdn.co/image/art" }],
        },
      },
    },
    ...overrides,
  }) satisfies SpotifyPlayerState;
function setup(overrides: {
  token?: () => Promise<string>;
  fetch?: (input: string, init?: RequestInit) => Promise<Response>;
  pollIntervalMs?: number;
  connectTimeoutMs?: number;
  requestTimeoutMs?: number;
} = {}) {
  const player = new FakePlayer();
  const fetcher = vi.fn(overrides.fetch ?? (() => Promise.resolve(new Response(null, { status: 204 }))));
  const getAccessToken = vi.fn(overrides.token ?? (() => Promise.resolve("token-1")));
  const playback = new SpotifyPlayback({
    createPlayer: () => player,
    getAccessToken,
    fetch: fetcher,
    pollIntervalMs: overrides.pollIntervalMs ?? 60_000,
    connectTimeoutMs: overrides.connectTimeoutMs ?? 20_000,
    requestTimeoutMs: overrides.requestTimeoutMs,
  });
  const ready = async () => {
    const pending = playback.connect();
    player.emit("ready", { device_id: "device-1" });
    await pending;
  };
  return { playback, player, fetcher, getAccessToken, ready };
}
describe("normalizeSpotifyTrack", () => {
  it("accepts episode URIs and links while rejecting other Spotify objects", () => {
    expect(normalizeSpotifyTrack(`spotify:episode:${YELLOW}`)).toBe(`spotify:episode:${YELLOW}`);
    expect(normalizeSpotifyTrack(`https://open.spotify.com/episode/${YELLOW}`)).toBe(`spotify:episode:${YELLOW}`);
    expect(normalizeSpotifyTrack(`spotify:show:${YELLOW}`)).toBeNull();
  });
  it("accepts URIs, raw IDs and open.spotify.com track URLs", () => {
    const expected = `spotify:track:${YELLOW}`;
    expect(normalizeSpotifyTrack(` spotify:track:${YELLOW} `)).toBe(expected);
    expect(normalizeSpotifyTrack(YELLOW)).toBe(expected);
    expect(normalizeSpotifyTrack(`https://open.spotify.com/track/${YELLOW}`)).toBe(expected);
    expect(
      normalizeSpotifyTrack(`https://open.spotify.com/track/${YELLOW}/?si=abc`),
    ).toBe(expected);
    expect(
      normalizeSpotifyTrack(`https://open.spotify.com/intl-de/track/${YELLOW}`),
    ).toBe(expected);
  });
  it("rejects non-track, spoofed and malformed inputs", () => {
    expect(normalizeSpotifyTrack("")).toBeNull();
    expect(normalizeSpotifyTrack("spotify:album:3AJwUDP919kvQ9QcozQPxg")).toBeNull();
    expect(normalizeSpotifyTrack(`https://open.spotify.com/playlist/${YELLOW}`)).toBeNull();
    expect(normalizeSpotifyTrack(`http://open.spotify.com/track/${YELLOW}`)).toBeNull();
    expect(normalizeSpotifyTrack(`https://open.spotify.com.evil.example/track/${YELLOW}`)).toBeNull();
    expect(normalizeSpotifyTrack(`https://user:pass@open.spotify.com/track/${YELLOW}`)).toBeNull();
    expect(normalizeSpotifyTrack("not a url at all")).toBeNull();
    expect(normalizeSpotifyTrack(`spotify:track:${YELLOW}x`)).toBeNull();
  });
});
describe("SpotifyPlayback connection", () => {
  it("does not claim ready until the SDK ready event fires", async () => {
    const { playback, player } = setup();
    const pending = playback.connect();
    expect(playback.getSnapshot().status).toBe("connecting");
    player.emit("ready", { device_id: "device-1" });
    await pending;
    expect(playback.getSnapshot().status).toBe("ready");
  });
  it("deduplicates concurrent connect calls", async () => {
    const created: FakePlayer[] = [];
    const player = new FakePlayer();
    const playback = new SpotifyPlayback({
      createPlayer: (options) => {
        created.push(new FakePlayer());
        return player;
      },
      getAccessToken: () => Promise.resolve("token-1"),
      fetch: () => Promise.resolve(new Response(null, { status: 204 })),
      pollIntervalMs: 60_000,
    });
    const [first, second] = [playback.connect(), playback.connect()];
    player.emit("ready", { device_id: "device-1" });
    await Promise.all([first, second]);
    expect(created).toHaveLength(1);
    playback.dispose();
  });
  it("fails safely when the SDK cannot connect", async () => {
    const { playback, player } = setup();
    player.connectResult = false;
    await playback.connect();
    expect(playback.getSnapshot().status).toBe("error");
    expect(playback.getSnapshot().error).toContain("could not connect");
  });
  it("times out a stalled connection", async () => {
    const { playback, player } = setup({ connectTimeoutMs: 25 });
    player.connect = () => new Promise(() => {});
    await playback.connect();
    expect(playback.getSnapshot().status).toBe("error");
  });
  it("fails when connect resolves true but ready never arrives", async () => {
    const { playback } = setup({ connectTimeoutMs: 30 });
    // FakePlayer.connect resolves true; no ready event is emitted.
    await playback.connect();
    expect(playback.getSnapshot().status).toBe("error");
    expect(playback.getSnapshot().error).toContain("too long");
    playback.dispose();
  });
  it("treats a rejected SDK connect as a fixed failure", async () => {
    const { playback, player } = setup();
    player.connect = () => Promise.reject(new Error("internal"));
    await playback.connect();
    expect(playback.getSnapshot().status).toBe("error");
    expect(JSON.stringify(playback.getSnapshot())).not.toContain("internal");
  });
  it("ignores a late ready after the connect attempt already failed", async () => {
    const { playback, player } = setup({ connectTimeoutMs: 25 });
    player.connect = () => new Promise(() => {});
    await playback.connect();
    expect(playback.getSnapshot().status).toBe("error");
    expect(player.connected).toBe(false);
    player.emit("ready", { device_id: "ghost" });
    expect(playback.getSnapshot().status).toBe("error");
    await expect(playback.play(YELLOW)).rejects.toThrow("not ready");
    playback.dispose();
  });
  it("settles a pending connect when disposed", async () => {
    const { playback, player } = setup();
    player.connect = () => new Promise(() => {});
    const pending = playback.connect();
    playback.dispose();
    await expect(pending).resolves.toBeUndefined();
  });
  it("blocks play until ready and after not_ready", async () => {
    const { playback, player, ready, fetcher } = setup();
    await expect(playback.play(YELLOW)).rejects.toThrow("not ready");
    await ready();
    player.emit("player_state_changed", trackState());
    player.emit("not_ready");
    expect(playback.getSnapshot().status).toBe("offline");
    // Offline clears stale playing metadata immediately.
    expect(playback.getSnapshot().track).toBeNull();
    expect(playback.getSnapshot().positionMs).toBe(0);
    await expect(playback.play(YELLOW)).rejects.toThrow("not ready");
    expect(fetcher).not.toHaveBeenCalled();
    player.emit("ready", { device_id: "device-2" });
    expect(playback.getSnapshot().status).toBe("ready");
    playback.dispose();
  });
  it("maps SDK error events to fixed messages", async () => {
    const { playback, player, ready } = setup();
    await ready();
    player.emit("authentication_error", { message: "raw secret" });
    expect(playback.getSnapshot().error).toContain("Reconnect");
    player.emit("account_error", {});
    expect(playback.getSnapshot().error).toContain("Premium");
    player.emit("playback_error", {});
    expect(playback.getSnapshot().error).toContain("failed");
    expect(JSON.stringify(playback.getSnapshot())).not.toContain("raw secret");
  });
});
describe("SpotifyPlayback commands", () => {
  it("activates the element synchronously before token and network work", async () => {
    const { playback, player, ready, getAccessToken, fetcher } = setup();
    await ready();
    let tokenResolve!: (token: string) => void;
    getAccessToken.mockImplementationOnce(
      () => new Promise((resolve) => (tokenResolve = resolve)),
    );
    const order: string[] = [];
    const originalActivate = player.activateElement.bind(player);
    player.activateElement = () => {
      order.push("activate");
      return originalActivate();
    };
    fetcher.mockImplementationOnce(() => {
      order.push("fetch");
      return Promise.resolve(new Response(null, { status: 204 }));
    });
    const pending = playback.play(`https://open.spotify.com/track/${YELLOW}`);
    expect(player.activateCalls).toBe(1); // Sync, inside the gesture.
    expect(order).toEqual(["activate"]);
    await Promise.resolve(); // Let the activation await reach token fetch.
    tokenResolve("token-1");
    await pending;
    expect(order).toEqual(["activate", "fetch"]);
  });
  it("targets the SDK device with the normalized URI and bearer auth", async () => {
    const { playback, ready, fetcher } = setup();
    await ready();
    await playback.play(`spotify:track:${YELLOW}`);
    const [input, init] = fetcher.mock.calls[0];
    expect(input).toBe(
      "https://api.spotify.com/v1/me/player/play?device_id=device-1",
    );
    expect(JSON.parse(init?.body as string)).toEqual({
      uris: [`spotify:track:${YELLOW}`],
    });
    expect((init?.headers as Record<string, string>).Authorization).toBe(
      "Bearer token-1",
    );
    expect(init?.cache).toBe("no-store");
    // Success is not claimed optimistically: state stays paused until SDK events.
    expect(playback.getSnapshot().track).toBeNull();
    playback.dispose();
  });
  it("encodes reserved characters in the device id URL parameter", async () => {
    const { playback, player, fetcher } = setup();
    const pending = playback.connect();
    player.emit("ready", { device_id: "dev?ice&=1" });
    await pending;
    await playback.play(YELLOW);
    expect(fetcher.mock.calls[0][0]).toBe(
      "https://api.spotify.com/v1/me/player/play?device_id=dev%3Fice%26%3D1",
    );
    playback.dispose();
  });
  it("maps API failures to safe messages without retrying", async () => {
    const { playback, ready, fetcher } = setup();
    await ready();
    for (const [status, text] of [
      [401, "Reconnect"],
      [403, "Premium"],
      [404, "offline"],
      [429, "rate limiting"],
      [500, "failed"],
    ] as const) {
      fetcher.mockResolvedValueOnce(new Response(null, { status }));
      await expect(playback.play(YELLOW)).rejects.toThrow(text);
    }
    expect(fetcher).toHaveBeenCalledTimes(5);
  });
  it("reflects real SDK state and clears on null", async () => {
    const { playback, player, ready } = setup();
    await ready();
    player.emit("player_state_changed", trackState());
    expect(playback.getSnapshot()).toMatchObject({
      positionMs: 1000,
      durationMs: 269000,
      paused: false,
      track: {
        name: "Yellow",
        artist: "Coldplay",
        album: "Parachutes",
        imageUrl: "https://i.scdn.co/image/art",
      },
    });
    player.emit("player_state_changed", null);
    expect(playback.getSnapshot().track).toBeNull();
    expect(playback.getSnapshot().positionMs).toBe(0);
    expect(playback.getSnapshot().paused).toBe(true);
  });
  it("pauses, resumes with activation and clamps seeks", async () => {
    const { playback, player, ready } = setup();
    await ready();
    await playback.pause();
    expect(player.pauseCalls).toBe(1);
    await playback.resume();
    expect(player.activateCalls).toBe(1);
    expect(player.resumeCalls).toBe(1);
    player.emit("player_state_changed", trackState());
    await playback.seek(-50);
    expect(player.seeks.at(-1)).toBe(0);
    await playback.seek(999_999_999);
    expect(player.seeks.at(-1)).toBe(268_999);
    await playback.seek(Number.NaN);
    expect(player.seeks).toHaveLength(2);
  });
});
describe("SpotifyPlayback lifecycle", () => {
  it("sends no API request when disposed during token acquisition", async () => {
    const { playback, player, ready, getAccessToken, fetcher } = setup();
    await ready();
    let tokenResolve!: (token: string) => void;
    getAccessToken.mockImplementationOnce(
      () => new Promise((resolve) => (tokenResolve = resolve)),
    );
    const pending = playback.play(YELLOW);
    expect(player.activateCalls).toBe(1);
    await Promise.resolve();
    playback.dispose();
    tokenResolve("late-token");
    await pending;
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("ignores late events after dispose and cleans up listeners and timers", async () => {
    const { playback, player, ready } = setup();
    await ready();
    playback.dispose();
    expect(player.connected).toBe(false);
    expect(player.handlers.get("player_state_changed")).toEqual([]);
    player.emit("player_state_changed", trackState());
    expect(playback.getSnapshot().track).toBeNull();
    expect(playback.getSnapshot().status).toBe("idle");
  });
  it("keeps newer state events over slower poll responses", async () => {
    const { playback, player, ready } = setup({ pollIntervalMs: 20 });
    await ready();
    let resolvePoll: ((state: SpotifyPlayerState) => void) | null = null;
    player.getCurrentState = () =>
      new Promise((resolve) => {
        resolvePoll = resolve;
      });
    await new Promise((resolve) => setTimeout(resolve, 30)); // Poll issued.
    player.emit(
      "player_state_changed",
      trackState({ position: 50_000, paused: false }),
    );
    // A poll issued before the event must not roll back the newer position.
    (resolvePoll as ((state: SpotifyPlayerState) => void) | null)?.(
      trackState({ position: 1000 }),
    );
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(playback.getSnapshot().positionMs).toBe(50_000);
    playback.dispose();
  });
  it("keeps at most one poll in flight and ignores late offline results", async () => {
    const { playback, player, ready } = setup({ pollIntervalMs: 15 });
    await ready();
    player.emit("player_state_changed", trackState({ position: 2000 }));
    let calls = 0;
    const resolvers: ((state: SpotifyPlayerState) => void)[] = [];
    player.getCurrentState = () => {
      calls++;
      return new Promise((resolve) => resolvers.push(resolve));
    };
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(calls).toBe(1); // Second tick skipped while first is unresolved.
    player.emit("not_ready");
    resolvers[0](trackState({ position: 9999 }));
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(playback.getSnapshot().status).toBe("offline");
    expect(playback.getSnapshot().positionMs).toBe(0);
    playback.dispose();
  });
  it("never delivers tokens after dispose and reports auth token failure", async () => {
    const { playback, ready } = setup();
    await ready();
    playback.dispose();
    const captured: ((cb: (token: string) => void) => void)[] = [];
    let rejectToken!: (error: Error) => void;
    const player = new FakePlayer();
    const second = new SpotifyPlayback({
      createPlayer: (options) => {
        captured.push(options.getOAuthToken);
        return player;
      },
      getAccessToken: () =>
        new Promise((_, reject) => {
          rejectToken = reject;
        }),
      fetch: () => Promise.resolve(new Response(null, { status: 204 })),
    });
    const pending = second.connect();
    const delivered: string[] = [];
    captured[0]((token) => delivered.push(token));
    second.dispose();
    rejectToken(new Error("expired"));
    await pending;
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(delivered).toEqual([]);
    expect(second.getSnapshot().status).toBe("idle");
    // While active, a token failure shows the fixed reconnect error.
    const third = new SpotifyPlayback({
      createPlayer: (options) => {
        captured.push(options.getOAuthToken);
        return new FakePlayer();
      },
      getAccessToken: () => Promise.reject(new Error("nope")),
      fetch: () => Promise.resolve(new Response(null, { status: 204 })),
    });
    void third.connect();
    captured[1](() => {});
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(third.getSnapshot().error).toContain("Reconnect");
    third.dispose();
  });
  it("sends no token request or API call after disposal during deferred play activation", async () => {
    const { playback, player, ready, getAccessToken, fetcher } = setup();
    await ready();
    let release!: () => void;
    player.activation = new Promise((resolve) => {
      release = resolve;
    });
    const pending = playback.play(YELLOW);
    expect(player.activateCalls).toBe(1);
    playback.dispose();
    release();
    await pending;
    expect(getAccessToken).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
    expect(playback.getSnapshot().status).toBe("idle");
  });
  it("sends no resume after disposal during deferred activation", async () => {
    const { playback, player, ready } = setup();
    await ready();
    let release!: () => void;
    player.activation = new Promise((resolve) => {
      release = resolve;
    });
    const pending = playback.resume();
    playback.dispose();
    release();
    await pending;
    expect(player.resumeCalls).toBe(0);
  });
  it("does not publish errors that complete after dispose", async () => {
    const { playback, player, ready } = setup();
    await ready();
    let rejectPause!: (error: Error) => void;
    const pausePromise = new Promise<void>((_, reject) => {
      rejectPause = reject;
    });
    player.pause = () => pausePromise;
    const pending = playback.pause();
    playback.dispose();
    rejectPause(new Error("late failure"));
    await pending;
    expect(playback.getSnapshot().status).toBe("idle");
    expect(playback.getSnapshot().error).toBeNull();
  });
  it("clears a previous command error on the next successful command", async () => {
    const { playback, ready, fetcher } = setup();
    await ready();
    fetcher.mockResolvedValueOnce(new Response(null, { status: 403 }));
    await expect(playback.play(YELLOW)).rejects.toThrow("Premium");
    expect(playback.getSnapshot().error).toContain("Premium");
    await playback.play(YELLOW);
    expect(playback.getSnapshot().error).toBeNull();
    playback.dispose();
  });
  it("aborts a hung play request with an actionable timeout", async () => {
    const { playback, ready, fetcher } = setup({ requestTimeoutMs: 25 });
    await ready();
    fetcher.mockImplementationOnce(
      (_input, init) =>
        new Promise((_, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
        }),
    );
    await expect(playback.play(YELLOW)).rejects.toThrow("took too long");
    expect(playback.getSnapshot().error).toContain("too long");
    expect(fetcher).toHaveBeenCalledTimes(1); // No automatic retry.
    playback.dispose();
  });
  it("ignores a fetch rejection that lands after dispose", async () => {
    const { playback, ready, fetcher, player } = setup();
    await ready();
    let rejectFetch!: (error: Error) => void;
    fetcher.mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          rejectFetch = reject;
        }),
    );
    const pending = playback.play(YELLOW);
    await new Promise((resolve) => setTimeout(resolve, 0));
    playback.dispose();
    rejectFetch(new Error("network gone"));
    await expect(pending).resolves.toBeUndefined();
    expect(playback.getSnapshot().status).toBe("idle");
    expect(player.resumeCalls).toBe(0);
  });
  it("refuses seeks without a known duration or finite input", async () => {
    const { playback, player, ready } = setup();
    await ready();
    await playback.seek(5000); // durationMs is 0: unknown duration.
    player.emit("player_state_changed", trackState({ duration: 269000 }));
    await playback.seek(Number.POSITIVE_INFINITY);
    await playback.seek(Number.NaN);
    expect(player.seeks).toEqual([]);
    playback.dispose();
  });
  it("surfaces a fixed error for unexpected command failures", async () => {
    const { playback, player, ready } = setup();
    await ready();
    player.pause = () => Promise.reject(new Error("secret payload"));
    await expect(playback.pause()).rejects.toThrow(SpotifyPlaybackError);
    expect(JSON.stringify(playback.getSnapshot())).not.toContain(
      "secret payload",
    );
  });
});

describe("filter clock resynchronization",()=>{
  it("publishes successful seek positions and pauses immediately",async()=>{
    const {playback,player,ready}=setup();await ready();player.emit("player_state_changed",trackState());
    await playback.seek(60000);expect(playback.getSnapshot().positionMs).toBe(60000);
    await playback.pause();expect(playback.getSnapshot().paused).toBe(true);playback.dispose();
  });
  it("does not publish an old seek target into a new track",async()=>{
    const {playback,player,ready}=setup();await ready();player.emit("player_state_changed",trackState());
    let resolve!:()=>void;player.seek=()=>new Promise<void>(done=>{resolve=done;});
    const pending=playback.seek(60000);
    player.emit("player_state_changed",trackState({position:500,track_window:{current_track:{uri:"spotify:track:1111111111111111111111",name:"Next",artists:[{name:"Artist"}],album:{name:"Album",images:[]}}}}));
    resolve();await pending;expect(playback.getSnapshot().positionMs).toBe(500);playback.dispose();
  });
});

describe("Spotify mute volume ownership",()=>{
  it("checks local volume and restores the user's level",async()=>{
    const {player,playback}=setup();const connected=playback.connect();player.emit("ready",{device_id:"device"});await connected;
    expect(await playback.supportsVolumeControl()).toBe(true);expect(player.volume).toBe(0.7);
    await playback.setMuted(true);expect(player.volume).toBe(0);
    await playback.setMuted(true);await playback.setMuted(false);expect(player.volume).toBe(0.7);playback.dispose();
  });
  it("restores even when an outstanding mute completes after cancellation",async()=>{
    const {player,playback}=setup();const connected=playback.connect();player.emit("ready",{device_id:"device"});await connected;
    let release!:()=>void;
    const set=player.setVolume.bind(player);
    player.setVolume=vi.fn(async value=>{if(value===0) await new Promise<void>(resolve=>{release=resolve;});await set(value);});
    const mute=playback.setMuted(true);await vi.waitFor(()=>expect(release).toBeTypeOf("function"));
    const restore=playback.setMuted(false);release();await mute;await restore;expect(player.volume).toBe(0.7);playback.dispose();
  });
});

describe("clean selection in playback",()=>{
  it("activates immediately and sends the matched version to the browser player",async()=>{
    const source={id:YELLOW,name:"Yellow",explicit:true,duration_ms:269000,artists:[{id:"artist",name:"Coldplay"}],album:{id:"album"}};
    const clean={...source,id:"2222222222222222222222",explicit:false};
    const f=setup({fetch:async url=>url.includes("/tracks/")?Response.json(source):url.includes("/search?")?Response.json({tracks:{items:[clean]}}):new Response(null,{status:204})});await f.ready();
    const play=f.playback.play(YELLOW,{preferClean:true});expect(f.player.activateCalls).toBe(1);await play;
    const request=f.fetcher.mock.calls.find(call=>call[0].includes("/me/player/play"));
    expect(JSON.parse(String(request?.[1]?.body))).toEqual({uris:["spotify:track:2222222222222222222222"]});expect(f.playback.getSnapshot().cleanChoice?.status).toBe("clean");
    f.player.emit("player_state_changed",trackState());expect(f.playback.getSnapshot().cleanChoice).toBeUndefined();f.playback.dispose();
  });
});
it("rejects a browser with fixed volume readback and preserves its prior volume",async()=>{
  const f=setup();await f.ready();f.player.getVolume=async()=>1;expect(await f.playback.supportsVolumeControl()).toBe(false);expect(f.player.volume).toBe(1);f.playback.dispose();
});
it("reports no volume control when restoring the prior level fails",async()=>{
  const f=setup();await f.ready();
  f.player.setVolume=vi.fn(async value=>{if(value===0.7) throw new Error("restore failed");f.player.volume=value;});
  expect(await f.playback.supportsVolumeControl()).toBe(false);f.playback.dispose();
});
