import * as Schema from "effect/Schema";

const PendingLogin = Schema.Struct({
  verifier: Schema.String,
  state: Schema.String,
  clientId: Schema.String,
  redirectUri: Schema.String,
  createdAt: Schema.Number,
});
const TokenResponse = Schema.Struct({
  access_token: Schema.NonEmptyString,
  token_type: Schema.Literal("Bearer"),
  expires_in: Schema.Number.pipe(Schema.positive()),
  refresh_token: Schema.optional(Schema.NonEmptyString),
  scope: Schema.optional(Schema.String),
});
const StoredSession = Schema.Struct({
  accessToken: Schema.NonEmptyString,
  refreshToken: Schema.NonEmptyString,
  expiresAt: Schema.Number,
  clientId: Schema.String,
  // Older sessions predate playback consent: absent scopes stay account-only.
  scopes: Schema.optional(Schema.Array(Schema.String)),
});
type Session = typeof StoredSession.Type;
export const SPOTIFY_PLAYBACK_SCOPES = [
  "user-read-private",
  "user-read-email",
  "streaming",
  "user-modify-playback-state",
] as const;
export type AuthSnapshot = {
  status: "disconnected" | "connecting" | "connected" | "error";
  displayName: string | null;
  error: string | null;
};
export const AUTH_KEYS = {
  pending: "audio-angel:spotify:pkce:v1",
  session: "audio-angel:spotify:session:v1",
};
export interface AuthStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}
export type AuthEnvironment = {
  clientId: string;
  redirectUri: string;
  storage: AuthStorage;
  crypto: Crypto;
  fetch: (input: string, init?: RequestInit) => Promise<Response>;
  now?: () => number;
};
export class SpotifyAuthError extends Error {}
function base64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
export async function pkceChallenge(
  verifier: string,
  crypto: Crypto,
): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier),
  );
  return base64Url(new Uint8Array(digest));
}

/** Browser auth only: no audio, no client secret, no server token forwarding. */
export class SpotifyAuth {
  private snapshot: AuthSnapshot = {
    status: "disconnected",
    displayName: null,
    error: null,
  };
  private listeners = new Set<() => void>();
  private session: Session | null = null;
  private refreshInFlight: Promise<string> | null = null;
  private callbackInFlight: Promise<void> | null = null;
  private initialization: Promise<void> | null = null;
  private generation = 0;
  private now: () => number;
  constructor(private readonly env: AuthEnvironment) {
    this.now = env.now ?? Date.now;
  }
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private update(snapshot: AuthSnapshot) {
    this.snapshot = snapshot;
    this.listeners.forEach((fn) => fn());
  }
  private clearSession() {
    this.session = null;
    try {
      this.env.storage.removeItem(AUTH_KEYS.session);
    } catch {
      /* In-memory tokens are cleared even when storage is blocked. */
    }
  }
  private persist(session: Session) {
    this.env.storage.setItem(AUTH_KEYS.session, JSON.stringify(session));
    this.session = session;
  }
  private checkConfig() {
    if (!/^[a-f0-9]{32}$/i.test(this.env.clientId))
      throw new SpotifyAuthError(
        "Add your Spotify app's 32-character public Client ID.",
      );
    const redirect = new URL(this.env.redirectUri);
    if (
      redirect.protocol !== "https:" &&
      !(
        redirect.protocol === "http:" &&
        ["127.0.0.1", "[::1]"].includes(redirect.hostname)
      )
    )
      throw new SpotifyAuthError(
        "Spotify sign-in needs HTTPS or a loopback IP address.",
      );
    if (!this.env.crypto?.subtle)
      throw new SpotifyAuthError(
        "This browser cannot use secure Spotify sign-in.",
      );
  }
  async createAuthorizationUrl(): Promise<string> {
    this.checkConfig();
    this.callbackInFlight = null;
    const random = () =>
      base64Url(this.env.crypto.getRandomValues(new Uint8Array(48)));
    const verifier = random();
    const state = random();
    const challenge = await pkceChallenge(verifier, this.env.crypto);
    this.env.storage.setItem(
      AUTH_KEYS.pending,
      JSON.stringify({
        verifier,
        state,
        clientId: this.env.clientId,
        redirectUri: this.env.redirectUri,
        createdAt: this.now(),
      }),
    );
    const url = new URL("https://accounts.spotify.com/authorize");
    url.search = new URLSearchParams({
      client_id: this.env.clientId,
      response_type: "code",
      redirect_uri: this.env.redirectUri,
      state,
      scope: SPOTIFY_PLAYBACK_SCOPES.join(" "),
      show_dialog: "true",
      code_challenge_method: "S256",
      code_challenge: challenge,
    }).toString();
    return url.toString();
  }
  initialize(): Promise<void> {
    if (this.initialization) return this.initialization;
    const generation = this.generation;
    this.initialization = (async () => {
      try {
        const raw = this.env.storage.getItem(AUTH_KEYS.session);
        if (!raw) return;
        const session = Schema.decodeUnknownSync(StoredSession)(
          JSON.parse(raw),
        );
        if (session.clientId !== this.env.clientId) {
          this.clearSession();
          return;
        }
        this.session = session;
        const token = await this.getAccessToken();
        await this.loadProfile(token, generation);
      } catch (error) {
        if (generation === this.generation) this.fail(error);
      }
    })();
    return this.initialization;
  }
  finishLogin(callback: URL): Promise<void> {
    // React Strict Mode and route remounts must not redeem a code twice.
    if (this.callbackInFlight) return this.callbackInFlight;
    this.callbackInFlight = this.exchangeCallback(callback);
    return this.callbackInFlight;
  }
  private async exchangeCallback(callback: URL) {
    const generation = ++this.generation;
    this.update({ status: "connecting", displayName: null, error: null });
    try {
      this.checkConfig();
      const raw = this.env.storage.getItem(AUTH_KEYS.pending);
      this.env.storage.removeItem(AUTH_KEYS.pending);
      if (!raw)
        throw new SpotifyAuthError(
          "No sign-in request was found. Start again from Settings.",
        );
      const pending = Schema.decodeUnknownSync(PendingLogin)(JSON.parse(raw));
      if (
        callback.searchParams.get("state") !== pending.state ||
        pending.clientId !== this.env.clientId ||
        pending.redirectUri !== this.env.redirectUri ||
        this.now() - pending.createdAt > 10 * 60_000 ||
        this.now() < pending.createdAt
      )
        throw new SpotifyAuthError(
          "This sign-in request expired or did not match. Start again from Settings.",
        );
      const expected = new URL(pending.redirectUri);
      if (
        callback.origin !== expected.origin ||
        callback.pathname !== expected.pathname
      )
        throw new SpotifyAuthError(
          "The sign-in redirect did not match this app.",
        );
      if (callback.searchParams.has("error"))
        throw new SpotifyAuthError(
          "Spotify sign-in was cancelled. You can try again from Settings.",
        );
      const code = callback.searchParams.get("code");
      if (!code)
        throw new SpotifyAuthError(
          "Spotify did not return a sign-in code. Try again.",
        );
      const tokens = await this.requestTokens(
        new URLSearchParams({
          grant_type: "authorization_code",
          code,
          redirect_uri: pending.redirectUri,
          client_id: this.env.clientId,
          code_verifier: pending.verifier,
        }),
      );
      if (!tokens.refresh_token)
        throw new SpotifyAuthError(
          "Spotify did not return a refresh token. Please sign in again.",
        );
      if (generation !== this.generation) return;
      this.persist({
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt: this.now() + tokens.expires_in * 1000,
        clientId: this.env.clientId,
        scopes: tokens.scope ? tokens.scope.split(/\s+/).filter(Boolean) : [],
      });
      await this.loadProfile(tokens.access_token, generation);
    } catch (error) {
      if (generation === this.generation) this.fail(error);
      throw new SpotifyAuthError(
        this.snapshot.error ?? "Spotify sign-in did not complete.",
      );
    }
  }
  private async requestTokens(body: URLSearchParams) {
    let response: Response;
    try {
      response = await this.env.fetch(
        "https://accounts.spotify.com/api/token",
        {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: body.toString(),
          cache: "no-store",
        },
      );
    } catch {
      throw new SpotifyAuthError(
        "Could not reach Spotify. Check your connection and sign in again.",
      );
    }
    if (!response.ok)
      throw new SpotifyAuthError(
        response.status === 429
          ? "Spotify is rate limiting sign-in. Wait a moment and try again."
          : "Spotify rejected the sign-in session. Please sign in again.",
      );
    return Schema.decodeUnknownSync(TokenResponse)(await response.json());
  }
  hasPlaybackPermissions(): boolean {
    if (!this.session) return false;
    const granted = this.session.scopes ?? [];
    return SPOTIFY_PLAYBACK_SCOPES.every((scope) => granted.includes(scope));
  }
  async getPlaybackAccessToken(): Promise<string> {
    if (!this.hasPlaybackPermissions())
      throw new SpotifyAuthError(
        "Reconnect Spotify from Settings to allow live playback.",
      );
    const token = await this.getAccessToken();
    // A refresh may return narrower scopes: recheck before handing it out.
    if (!this.hasPlaybackPermissions())
      throw new SpotifyAuthError(
        "Reconnect Spotify from Settings to allow live playback.",
      );
    return token;
  }
  async getAccessToken(): Promise<string> {
    if (!this.session) throw new SpotifyAuthError("Sign in to Spotify first.");
    if (this.session.expiresAt > this.now() + 30_000)
      return this.session.accessToken;
    if (this.refreshInFlight) return this.refreshInFlight;
    const session = this.session;
    const generation = this.generation;
    const refresh = async () => {
      try {
        const tokens = await this.requestTokens(
          new URLSearchParams({
            grant_type: "refresh_token",
            refresh_token: session.refreshToken,
            client_id: this.env.clientId,
          }),
        );
        if (generation !== this.generation)
          throw new SpotifyAuthError("Spotify has been disconnected.");
        this.persist({
          ...session,
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token ?? session.refreshToken,
          expiresAt: this.now() + tokens.expires_in * 1000,
          scopes: tokens.scope
            ? tokens.scope.split(/\s+/).filter(Boolean)
            : session.scopes,
        });
        return tokens.access_token;
      } catch (error) {
        if (generation === this.generation) this.fail(error);
        throw new SpotifyAuthError("Your Spotify session needs a new sign-in.");
      }
    };
    this.refreshInFlight = refresh().finally(() => {
      this.refreshInFlight = null;
    });
    return this.refreshInFlight;
  }
  private async loadProfile(token: string, generation: number) {
    const response = await this.env.fetch("https://api.spotify.com/v1/me", {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (!response.ok)
      throw new SpotifyAuthError(
        response.status === 403
          ? "This Spotify account cannot access the app. Check the developer allowlist and Premium requirements."
          : "Could not verify your Spotify account. Please sign in again.",
      );
    const profile = Schema.decodeUnknownSync(
      Schema.Struct({
        id: Schema.NonEmptyString,
        display_name: Schema.NullOr(Schema.String),
      }),
    )(await response.json());
    if (generation === this.generation)
      this.update({
        status: "connected",
        displayName: profile.display_name || profile.id,
        error: null,
      });
  }
  private fail(error: unknown) {
    this.clearSession();
    this.update({
      status: "error",
      displayName: null,
      error:
        error instanceof SpotifyAuthError
          ? error.message
          : "Spotify sign-in could not be completed. Please try again.",
    });
  }
  disconnect() {
    this.generation++;
    this.clearSession();
    try {
      this.env.storage.removeItem(AUTH_KEYS.pending);
    } catch {
      /* Storage may be blocked. */
    }
    this.update({ status: "disconnected", displayName: null, error: null });
  }
}
