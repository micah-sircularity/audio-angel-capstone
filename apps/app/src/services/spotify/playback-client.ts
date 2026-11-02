import type { SpotifyConnection } from "./connection";
import type { SpotifyPlayback } from "./playback";
export function createSpotifyPlayback(
  _auth: SpotifyConnection,
): Promise<SpotifyPlayback> {
  return Promise.reject(
    new Error("Spotify playback testing is only available in the web app."),
  );
}
