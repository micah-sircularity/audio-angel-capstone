import { afterEach, describe, expect, it, vi } from "vitest";
type FakeScript = {
  src: string;
  async: boolean;
  onerror: (() => void) | null;
  removed: boolean;
  remove(): void;
};
function fakeBrowser(autoReady = true) {
  const scripts: FakeScript[] = [];
  const window = {
    location: { origin: "https://example.test" },
    onSpotifyWebPlaybackSDKReady: undefined as (() => void) | undefined,
    Spotify: undefined as unknown,
    fetch: vi.fn(),
  };
  const document = {
    createElement: (_tag: string): FakeScript => {
      const script: FakeScript = {
        src: "",
        async: false,
        onerror: null,
        removed: false,
        remove() {
          this.removed = true;
        },
      };
      scripts.push(script);
      return script;
    },
    head: {
      appendChild: (script: FakeScript) => {
        if (autoReady)
          setTimeout(() => window.onSpotifyWebPlaybackSDKReady?.(), 0);
      },
    },
  };
  return { window, document, scripts };
}
const realWindow = globalThis.window;
const realDocument = globalThis.document;
afterEach(() => {
  globalThis.window = realWindow;
  globalThis.document = realDocument;
  vi.restoreAllMocks();
});
const importClient = async () => {
  vi.resetModules();
  return await import("./playback-client.web");
};
const fakeAuth = {
  getPlaybackAccessToken: () => Promise.resolve("token"),
} as never;
describe("playback-client.web SDK loader", () => {
  it("rejects without a browser window", async () => {
    // @ts-expect-error simulating SSR
    globalThis.window = undefined;
    // @ts-expect-error simulating SSR
    globalThis.document = undefined;
    const { createSpotifyPlayback } = await importClient();
    await expect(createSpotifyPlayback(fakeAuth)).rejects.toThrow(
      "only available in a web browser",
    );
  });
  it("loads the SDK script once and resolves ready", async () => {
    const fake = fakeBrowser();
    globalThis.window = fake.window as never;
    globalThis.document = fake.document as never;
    const { createSpotifyPlayback } = await importClient();
    const pending = createSpotifyPlayback(fakeAuth);
    fake.window.Spotify = { Player: class {} };
    const playback = await pending;
    expect(fake.scripts).toHaveLength(1);
    expect(fake.scripts[0].src).toBe(
      "https://sdk.scdn.co/spotify-player.js",
    );
    expect(playback).toBeTruthy();
    // A second call resolves instantly without another script.
    fake.scripts.length = 0;
    await expect(createSpotifyPlayback(fakeAuth)).resolves.toBeTruthy();
    expect(fake.scripts).toHaveLength(0);
  });
  it("allows retry after a script load failure", async () => {
    const fake = fakeBrowser(false);
    globalThis.window = fake.window as never;
    globalThis.document = fake.document as never;
    const { createSpotifyPlayback } = await importClient();
    const first = createSpotifyPlayback(fakeAuth);
    await new Promise((resolve) => setTimeout(resolve, 0));
    fake.scripts[0].onerror?.();
    await expect(first).rejects.toThrow("could not be loaded");
    expect(fake.scripts[0].removed).toBe(true);
    // Retry injects a new script and succeeds once the SDK appears.
    const retry = createSpotifyPlayback(fakeAuth);
    expect(fake.scripts).toHaveLength(2);
    fake.window.Spotify = { Player: class {} };
    fake.window.onSpotifyWebPlaybackSDKReady?.();
    await expect(retry).resolves.toBeTruthy();
  });
  it("fails when the ready callback fires without a Player global", async () => {
    const fake = fakeBrowser();
    globalThis.window = fake.window as never;
    globalThis.document = fake.document as never;
    const { createSpotifyPlayback } = await importClient();
    await expect(createSpotifyPlayback(fakeAuth)).rejects.toThrow(
      "did not initialize",
    );
    // Retry after the SDK appears works.
    const retry = createSpotifyPlayback(fakeAuth);
    fake.window.Spotify = { Player: class {} };
    await expect(retry).resolves.toBeTruthy();
  });
  it("times out when the SDK never calls back", async () => {
    vi.useFakeTimers();
    const fake = fakeBrowser(false);
    globalThis.window = fake.window as never;
    globalThis.document = fake.document as never;
    const { createSpotifyPlayback } = await importClient();
    const pending = createSpotifyPlayback(fakeAuth);
    const assertion = expect(pending).rejects.toThrow("too long");
    await vi.advanceTimersByTimeAsync(15_001);
    await assertion;
    vi.useRealTimers();
  });
});
