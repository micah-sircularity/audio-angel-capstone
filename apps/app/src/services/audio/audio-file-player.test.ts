import { describe, expect, it, vi } from "vitest";
import {
  AudioFilePlayer,
  type AudioContextLike,
  type AudioElementLike,
  type GainNodeLike,
} from "./audio-file-player";

class FakeElement implements AudioElementLike {
  src = "";
  preload = "";
  crossOrigin: string | null = null;
  currentTime = 0;
  duration = NaN;
  paused = true;
  muted = false;
  playError: unknown = null;
  private listeners = new Map<string, Set<() => void>>();
  addEventListener(type: string, listener: () => void) {
    const set = this.listeners.get(type) ?? new Set();
    set.add(listener);
    this.listeners.set(type, set);
  }
  removeEventListener(type: string, listener: () => void) {
    this.listeners.get(type)?.delete(listener);
  }
  emit(type: string) {
    this.listeners.get(type)?.forEach((listener) => listener());
  }
  play = vi.fn(async () => {
    if (this.playError) throw this.playError;
    this.paused = false;
    this.emit("play");
  });
  pause = vi.fn(() => {
    this.paused = true;
    this.emit("pause");
  });
}

function fakeContext() {
  const destination = { connect: vi.fn(), disconnect: vi.fn() };
  const source = { connect: vi.fn(), disconnect: vi.fn() };
  const gain: GainNodeLike = {
    gain: { value: 1, setTargetAtTime: vi.fn() },
    connect: vi.fn(),
    disconnect: vi.fn(),
  };
  const ctx: AudioContextLike = {
    currentTime: 1.5,
    destination,
    resume: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
    createMediaElementSource: vi.fn(() => source),
    createGain: vi.fn(() => gain),
  };
  return { ctx, gain, source, destination };
}

function setup(elements: FakeElement[], ctx: AudioContextLike | null = fakeContext().ctx) {
  let index = 0;
  const player = new AudioFilePlayer({
    createElement: () => elements[index++] ?? new FakeElement(),
    createAudioContext: () => ctx,
  });
  return player;
}

const LOAD = {
  streamUrl: "https://example.com/audio.mp3",
  sourceKey: "aud:abc123",
  durationHint: 100_000,
};

describe("AudioFilePlayer", () => {
  it("mutes through the gain node once the graph exists", async () => {
    const element = new FakeElement();
    const { ctx, gain } = fakeContext();
    const player = new AudioFilePlayer({
      createElement: () => element,
      createAudioContext: () => ctx,
    });
    player.load(LOAD);
    element.emit("canplay");
    await player.play();
    expect(ctx.createMediaElementSource).toHaveBeenCalledWith(element);
    await player.setMuted(true);
    expect(gain.gain.setTargetAtTime).toHaveBeenCalledWith(0, 1.5, 0.012);
    await player.setMuted(false);
    expect(gain.gain.setTargetAtTime).toHaveBeenLastCalledWith(1, 1.5, 0.012);
    expect(element.muted).toBe(false);
    expect(player.mode).toBe("gain");
    player.dispose();
  });

  it("retries once without CORS and mutes the element after a pre-canplay error", async () => {
    const first = new FakeElement();
    const second = new FakeElement();
    const player = setup([first, second]);
    player.load(LOAD);
    expect(first.crossOrigin).toBe("anonymous");
    first.emit("error");
    expect(second.crossOrigin).toBe(null);
    expect(second.src).toBe(LOAD.streamUrl);
    expect(player.mode).toBe("element-muted");
    await player.setMuted(true);
    expect(second.muted).toBe(true);
    // A later failure is a real error, not another retry.
    second.emit("canplay");
    second.emit("error");
    expect(player.getSnapshot().status).toBe("error");
    expect(player.getSnapshot().error).toBeTruthy();
    player.dispose();
  });

  it("also falls back on a pre-canplay stalled event", async () => {
    const first = new FakeElement();
    const second = new FakeElement();
    const player = setup([first, second]);
    player.load(LOAD);
    first.emit("stalled");
    expect(player.mode).toBe("element-muted");
    await player.setMuted(true);
    expect(second.muted).toBe(true);
    player.dispose();
  });

  it("uses element.muted when Web Audio is unavailable", async () => {
    const element = new FakeElement();
    const player = new AudioFilePlayer({
      createElement: () => element,
      createAudioContext: () => null,
    });
    player.load(LOAD);
    element.emit("canplay");
    await player.play();
    expect(player.mode).toBe("element-muted");
    await player.setMuted(true);
    expect(element.muted).toBe(true);
    player.dispose();
  });

  it("clamps seeks to [0, duration]", async () => {
    const element = new FakeElement();
    const player = setup([element]);
    player.load(LOAD);
    element.emit("canplay");
    await player.seek(-5_000);
    expect(element.currentTime).toBe(0);
    await player.seek(150_000);
    expect(element.currentTime).toBe(100); // seconds, clamped to hint
    await player.seek(30_000);
    expect(element.currentTime).toBe(30);
    expect(player.getSnapshot().positionMs).toBe(30_000);
    player.dispose();
  });

  it("publishes snapshot fields from element events", async () => {
    const element = new FakeElement();
    const player = setup([element]);
    player.load(LOAD);
    expect(player.getSnapshot()).toMatchObject({
      status: "connecting",
      track: { uri: "aud:abc123" },
      positionMs: 0,
      durationMs: 100_000,
      paused: true,
      needsUserGesture: false,
    });
    element.duration = 240;
    element.emit("loadedmetadata");
    element.emit("canplay");
    expect(player.getSnapshot().status).toBe("ready");
    expect(player.getSnapshot().durationMs).toBe(240_000);
    await player.play();
    expect(player.getSnapshot().paused).toBe(false);
    element.currentTime = 12.34;
    element.emit("timeupdate");
    expect(player.getSnapshot().positionMs).toBeCloseTo(12_340, -1);
    element.paused = true;
    element.emit("ended");
    const ended = player.getSnapshot();
    expect(ended.paused).toBe(true);
    expect(ended.positionMs).toBe(ended.durationMs);
    player.dispose();
  });

  it("maps play() NotAllowedError to needsUserGesture while staying ready", async () => {
    const element = new FakeElement();
    element.playError = { name: "NotAllowedError" };
    const player = setup([element]);
    player.load(LOAD);
    element.emit("canplay");
    await player.play(); // swallowed; surfaced via the snapshot
    const snapshot = player.getSnapshot();
    expect(snapshot.status).toBe("ready");
    expect(snapshot.needsUserGesture).toBe(true);
    expect(snapshot.paused).toBe(true);
    // A later successful gesture clears the flag.
    element.playError = null;
    await player.play();
    expect(player.getSnapshot().needsUserGesture).toBe(false);
    player.dispose();
  });

  it("notifies subscribers on element events and resets on a new load", async () => {
    const first = new FakeElement();
    const second = new FakeElement();
    const player = setup([first, second]);
    const seen = vi.fn();
    const unsubscribe = player.subscribe(seen);
    player.load(LOAD);
    const baseline = seen.mock.calls.length;
    first.emit("timeupdate");
    first.emit("pause");
    expect(seen.mock.calls.length).toBeGreaterThan(baseline);
    // A fresh load re-arms CORS mode on a new element.
    player.load({ ...LOAD, sourceKey: "pod:deadbeef" });
    expect(second.crossOrigin).toBe("anonymous");
    expect(player.getSnapshot().track?.uri).toBe("pod:deadbeef");
    expect(player.getSnapshot().status).toBe("connecting");
    unsubscribe();
    player.dispose();
  });
});
