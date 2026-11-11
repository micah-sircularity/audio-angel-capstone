import { accountConfigured, authClient } from "../account";
import type { SpotifyConnection } from "./connection";
const connection: SpotifyConnection = {
  async getPlaybackAccessToken() {
    const result = await authClient.getAccessToken({ providerId: "spotify" });
    if (result.error || !result.data?.accessToken)
      throw new Error("Reconnect Spotify in Filtering to continue.");
    return result.data.accessToken;
  },
};
export function getSpotifyAuth(): SpotifyConnection | null {
  return accountConfigured ? connection : null;
}
export function getSpotifyRedirectUri(): string {
  return `${process.env.EXPO_PUBLIC_CONVEX_SITE_URL ?? ""}/api/auth/callback/spotify`;
}
export async function beginSpotifyLogin(): Promise<void> {
  if (!accountConfigured) throw new Error("The account backend has not been configured.");
  // Remove obsolete tab tokens from the previous PKCE prototype.
  sessionStorage.removeItem("audio-angel:spotify:session:v1");
  sessionStorage.removeItem("audio-angel:spotify:pkce:v1");
  const result = await authClient.signIn.social({ provider: "spotify", callbackURL: `${location.origin}/library`, errorCallbackURL: `${location.origin}/filtering` });
  if (result.error) throw new Error(result.error.message ?? "Spotify sign-in failed. Try again.");
}
export async function finishSpotifyCallback(): Promise<void> {
  history.replaceState(null, "", "/auth/callback");
  throw new Error("This old sign-in callback is no longer used. Connect Spotify again from Filtering.");
}
