import type { SpotifyConnection } from "./connection";
export function getSpotifyAuth(): SpotifyConnection | null { return null; }
export function getSpotifyRedirectUri(): string { return ""; }
export async function beginSpotifyLogin(): Promise<void> { throw new Error("Open the web app to connect Spotify."); }
export async function finishSpotifyCallback(): Promise<void> { throw new Error("Open the web app to sign in."); }
