import type { SpotifyConnection } from "./connection";
import { SpotifyPlayback } from "./playback";
import type { SpotifyPlayer, SpotifyPlayerOptions } from "./playback";
const SDK_URL = "https://sdk.scdn.co/spotify-player.js";
declare global {
  interface Window {
    onSpotifyWebPlaybackSDKReady?: () => void;
    Spotify?: {
      Player: new (options: SpotifyPlayerOptions) => SpotifyPlayer;
    };
  }
}
let sdkLoad: Promise<void> | null = null;
function loadSdk(): Promise<void> {
  if (typeof window === "undefined" || typeof document === "undefined")
    return Promise.reject(
      new Error("Spotify playback is only available in a web browser."),
    );
  if (window.Spotify?.Player) return Promise.resolve();
  sdkLoad ??= new Promise<void>((resolve, reject) => {
    const previous = window.onSpotifyWebPlaybackSDKReady;
    const script = document.createElement("script");
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const cleanup = () => {
      if (timer) clearTimeout(timer);
      timer = null;
      window.onSpotifyWebPlaybackSDKReady = previous;
    };
    const fail = (message: string) => {
      if (settled) return;
      settled = true;
      cleanup();
      script.remove();
      sdkLoad = null; // A failed load may be retried by the user.
      reject(new Error(message));
    };
    window.onSpotifyWebPlaybackSDKReady = () => {
      if (settled) return;
      if (!window.Spotify?.Player) {
        fail("Spotify's playback SDK did not initialize. Retry.");
        return;
      }
      settled = true;
      cleanup();
      resolve();
    };
    script.src = SDK_URL;
    script.async = true;
    script.onerror = () =>
      fail(
        "Spotify's playback SDK could not be loaded. Check your connection and retry.",
      );
    timer = setTimeout(
      () => fail("Spotify's playback SDK took too long to load. Retry."),
      15_000,
    );
    document.head.appendChild(script);
  });
  return sdkLoad;
}
export async function createSpotifyPlayback(
  auth: SpotifyConnection,
): Promise<SpotifyPlayback> {
  await loadSdk();
  return new SpotifyPlayback({
    createPlayer: (options) => new window.Spotify!.Player(options),
    getAccessToken: () => auth.getPlaybackAccessToken(),
    fetch: (input, init) => window.fetch(input, init),
  });
}
