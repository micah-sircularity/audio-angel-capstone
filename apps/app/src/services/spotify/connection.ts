/** Only the short-lived access token needed by Spotify's browser SDK is exposed. */
export interface SpotifyConnection {
  getPlaybackAccessToken(): Promise<string>;
}
