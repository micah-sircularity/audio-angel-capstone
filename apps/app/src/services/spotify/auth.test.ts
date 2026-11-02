import { describe, expect, it, vi } from "vitest";
import {
  AUTH_KEYS,
  SPOTIFY_PLAYBACK_SCOPES,
  SpotifyAuth,
  pkceChallenge,
  type AuthStorage,
} from "./auth";

const clientId = "a".repeat(32);
const redirectUri = "https://audio-angel.example/auth/callback";
const tokens = {
  access_token: "access-token",
  refresh_token: "refresh-token",
  token_type: "Bearer",
  expires_in: 3600,
  scope: SPOTIFY_PLAYBACK_SCOPES.join(" "),
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
function setup() {
  const data = new Map<string, string>();
  const storage: AuthStorage = {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
    removeItem: (key) => {
      data.delete(key);
    },
  };
  const fetcher =
    vi.fn<(input: string, init?: RequestInit) => Promise<Response>>();
  let now = 1_000_000;
  const auth = new SpotifyAuth({
    clientId,
    redirectUri,
    storage,
    crypto: globalThis.crypto,
    fetch: fetcher,
    now: () => now,
  });
  const callback = async () => {
    const url = new URL(await auth.createAuthorizationUrl());
    return new URL(
      `${redirectUri}?code=one-time-code&state=${url.searchParams.get("state")}`,
    );
  };
  const login = async () => {
    fetcher
      .mockResolvedValueOnce(json(tokens))
      .mockResolvedValueOnce(
        json({ id: "listener", display_name: "Listener" }),
      );
    await auth.finishLogin(await callback());
  };
  return {
    auth,
    data,
    storage,
    fetcher,
    callback,
    login,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe("Spotify PKCE", () => {
  it("matches the RFC 7636 S256 example", async () => {
    expect(
      await pkceChallenge(
        "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk",
        globalThis.crypto,
      ),
    ).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });
  it("creates random single-use attempts with S256 and no client secret", async () => {
    const { auth, data } = setup();
    const first = new URL(await auth.createAuthorizationUrl());
    const pending = JSON.parse(data.get(AUTH_KEYS.pending)!);
    expect(first.origin).toBe("https://accounts.spotify.com");
    expect(first.searchParams.get("code_challenge_method")).toBe("S256");
    expect(first.searchParams.get("code_challenge")).toBe(
      await pkceChallenge(pending.verifier, globalThis.crypto),
    );
    expect(pending.verifier.length).toBeGreaterThanOrEqual(43);
    expect(first.searchParams.get("scope")).toBe(
      SPOTIFY_PLAYBACK_SCOPES.join(" "),
    );
    expect(first.searchParams.get("show_dialog")).toBe("true");
    expect(first.searchParams.has("client_secret")).toBe(false);
    const second = new URL(await auth.createAuthorizationUrl());
    expect(second.searchParams.get("state")).not.toBe(
      first.searchParams.get("state"),
    );
  });
  it("exchanges the code and exposes only account display data", async () => {
    const { auth, fetcher, data, login } = setup();
    await login();
    expect(auth.getSnapshot()).toEqual({
      status: "connected",
      displayName: "Listener",
      error: null,
    });
    const body = new URLSearchParams(fetcher.mock.calls[0][1]?.body as string);
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code_verifier")).toBeTruthy();
    expect(body.has("client_secret")).toBe(false);
    expect(data.has(AUTH_KEYS.pending)).toBe(false);
    expect(JSON.stringify(auth.getSnapshot())).not.toContain(
      tokens.access_token,
    );
  });
  it("redeems a callback only once under concurrent React effects", async () => {
    const { auth, fetcher, callback } = setup();
    fetcher
      .mockResolvedValueOnce(json(tokens))
      .mockResolvedValueOnce(json({ id: "listener", display_name: null }));
    const url = await callback();
    await Promise.all([auth.finishLogin(url), auth.finishLogin(url)]);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(auth.getSnapshot().displayName).toBe("listener");
  });
  it("rejects mismatched state before any network call", async () => {
    const { auth, fetcher, callback, data } = setup();
    const url = await callback();
    url.searchParams.set("state", "wrong");
    await expect(auth.finishLogin(url)).rejects.toThrow("did not match");
    expect(fetcher).not.toHaveBeenCalled();
    expect(data.has(AUTH_KEYS.pending)).toBe(false);
  });
  it("rejects an expired attempt", async () => {
    const { auth, callback, advance, fetcher } = setup();
    const url = await callback();
    advance(600_001);
    await expect(auth.finishLogin(url)).rejects.toThrow("expired");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("handles a user's cancellation without redeeming a code", async () => {
    const { auth, callback, fetcher } = setup();
    const url = await callback();
    url.searchParams.delete("code");
    url.searchParams.set("error", "access_denied");
    await expect(auth.finishLogin(url)).rejects.toThrow("cancelled");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("rejects callbacks without a pending request", async () => {
    const { auth, fetcher } = setup();
    await expect(
      auth.finishLogin(new URL(`${redirectUri}?code=unsolicited&state=none`)),
    ).rejects.toThrow("No sign-in request");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("handles account allowlist errors and discards tokens", async () => {
    const { auth, fetcher, callback, data } = setup();
    fetcher
      .mockResolvedValueOnce(json(tokens))
      .mockResolvedValueOnce(json({}, 403));
    await expect(auth.finishLogin(await callback())).rejects.toThrow(
      "allowlist",
    );
    expect(data.has(AUTH_KEYS.session)).toBe(false);
  });
  it("does not display raw token-provider error payloads", async () => {
    const { auth, fetcher, callback } = setup();
    fetcher.mockResolvedValueOnce(
      json({ error_description: "secret-value" }, 400),
    );
    await expect(auth.finishLogin(await callback())).rejects.toThrow(
      "Spotify rejected",
    );
    expect(JSON.stringify(auth.getSnapshot())).not.toContain("secret-value");
  });
});

describe("Spotify sessions", () => {
  it("uses a valid token without another request", async () => {
    const { auth, login, fetcher } = setup();
    await login();
    fetcher.mockClear();
    expect(await auth.getAccessToken()).toBe(tokens.access_token);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("deduplicates refreshes and preserves the previous refresh token if not rotated", async () => {
    const { auth, login, fetcher, advance, data } = setup();
    await login();
    advance(3_600_000);
    fetcher.mockClear();
    fetcher.mockResolvedValueOnce(
      json({
        access_token: "new-access",
        token_type: "Bearer",
        expires_in: 3600,
      }),
    );
    expect(
      await Promise.all([auth.getAccessToken(), auth.getAccessToken()]),
    ).toEqual(["new-access", "new-access"]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(JSON.parse(data.get(AUTH_KEYS.session)!).refreshToken).toBe(
      tokens.refresh_token,
    );
  });
  it("stores rotated refresh tokens", async () => {
    const { auth, login, fetcher, advance, data } = setup();
    await login();
    advance(3_600_000);
    fetcher.mockResolvedValueOnce(
      json({ ...tokens, refresh_token: "rotated" }),
    );
    await auth.getAccessToken();
    expect(JSON.parse(data.get(AUTH_KEYS.session)!).refreshToken).toBe(
      "rotated",
    );
  });
  it("clears rejected refresh sessions", async () => {
    const { auth, login, fetcher, advance, data } = setup();
    await login();
    advance(3_600_000);
    fetcher.mockResolvedValueOnce(json({}, 400));
    await expect(auth.getAccessToken()).rejects.toThrow("new sign-in");
    expect(data.has(AUTH_KEYS.session)).toBe(false);
    expect(auth.getSnapshot().status).toBe("error");
  });
  it("cannot restore a session after disconnect during refresh", async () => {
    const { auth, login, fetcher, advance, data } = setup();
    await login();
    advance(3_600_000);
    let release!: (response: Response) => void;
    fetcher.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const refresh = auth.getAccessToken();
    auth.disconnect();
    release(json(tokens));
    await expect(refresh).rejects.toThrow();
    expect(auth.getSnapshot().status).toBe("disconnected");
    expect(data.has(AUTH_KEYS.session)).toBe(false);
  });
  it("restores a stored session and verifies the account", async () => {
    const { login, storage, fetcher } = setup();
    await login();
    fetcher.mockClear();
    fetcher.mockResolvedValueOnce(
      json({ id: "listener", display_name: "Listener" }),
    );
    const restored = new SpotifyAuth({
      clientId,
      redirectUri,
      storage,
      crypto: globalThis.crypto,
      fetch: fetcher,
      now: () => 1_000_000,
    });
    await restored.initialize();
    expect(restored.getSnapshot().status).toBe("connected");
  });
  it("rejects corrupt stored data without logging it", async () => {
    const { auth, data } = setup();
    data.set(AUTH_KEYS.session, "bad-json");
    await auth.initialize();
    expect(auth.getSnapshot().status).toBe("error");
    expect(data.has(AUTH_KEYS.session)).toBe(false);
  });
  it("stores granted playback scopes from the token response", async () => {
    const { auth, login, data } = setup();
    await login();
    expect(auth.hasPlaybackPermissions()).toBe(true);
    expect(JSON.parse(data.get(AUTH_KEYS.session)!).scopes).toEqual([
      ...SPOTIFY_PLAYBACK_SCOPES,
    ]);
    expect(await auth.getPlaybackAccessToken()).toBe(tokens.access_token);
  });
  it("keeps legacy sessions connected without playback permissions", async () => {
    const { data, storage, fetcher } = setup();
    data.set(
      AUTH_KEYS.session,
      JSON.stringify({
        accessToken: "legacy-access",
        refreshToken: "legacy-refresh",
        expiresAt: 1_000_000 + 3_600_000,
        clientId,
      }),
    );
    fetcher.mockResolvedValueOnce(
      json({ id: "listener", display_name: "Listener" }),
    );
    const restored = new SpotifyAuth({
      clientId,
      redirectUri,
      storage,
      crypto: globalThis.crypto,
      fetch: fetcher,
      now: () => 1_000_000,
    });
    await restored.initialize();
    expect(restored.getSnapshot().status).toBe("connected");
    expect(restored.hasPlaybackPermissions()).toBe(false);
    fetcher.mockClear();
    await expect(restored.getPlaybackAccessToken()).rejects.toThrow(
      "Reconnect Spotify",
    );
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("rejects playback tokens when any required scope is missing", async () => {
    const { auth, fetcher, callback } = setup();
    fetcher
      .mockResolvedValueOnce(
        json({ ...tokens, scope: "user-read-private streaming" }),
      )
      .mockResolvedValueOnce(
        json({ id: "listener", display_name: "Listener" }),
      );
    await auth.finishLogin(await callback());
    expect(auth.getSnapshot().status).toBe("connected");
    expect(auth.hasPlaybackPermissions()).toBe(false);
    await expect(auth.getPlaybackAccessToken()).rejects.toThrow(
      "Reconnect Spotify",
    );
  });
  it("preserves scopes on refresh unless new scopes are supplied", async () => {
    const { auth, login, fetcher, advance, data } = setup();
    await login();
    advance(3_600_000);
    fetcher.mockResolvedValueOnce(
      json({
        access_token: "new-access",
        token_type: "Bearer",
        expires_in: 3600,
      }),
    );
    await auth.getAccessToken();
    expect(JSON.parse(data.get(AUTH_KEYS.session)!).scopes).toEqual([
      ...SPOTIFY_PLAYBACK_SCOPES,
    ]);
    advance(3_600_000);
    fetcher.mockResolvedValueOnce(
      json({
        access_token: "narrow-access",
        token_type: "Bearer",
        expires_in: 3600,
        scope: "user-read-private",
      }),
    );
    await auth.getAccessToken();
    expect(JSON.parse(data.get(AUTH_KEYS.session)!).scopes).toEqual([
      "user-read-private",
    ]);
    expect(auth.hasPlaybackPermissions()).toBe(false);
  });
  it("rejects a playback token when refresh returns reduced scopes", async () => {
    const { auth, login, fetcher, advance, data } = setup();
    await login();
    advance(3_600_000);
    fetcher.mockResolvedValueOnce(
      json({
        access_token: "narrow-access",
        token_type: "Bearer",
        expires_in: 3600,
        scope: "user-read-private",
      }),
    );
    // Profile access still works...
    expect(await auth.getAccessToken()).toBe("narrow-access");
    // ...but the narrowed refresh must not hand out a playback token.
    await expect(auth.getPlaybackAccessToken()).rejects.toThrow(
      "Reconnect Spotify",
    );
    expect(JSON.stringify(auth.getSnapshot())).not.toContain("narrow-access");
    expect(data.has(AUTH_KEYS.session)).toBe(true); // Session is preserved.
  });
  it("disconnect removes pending attempts and tokens", async () => {
    const { auth, login, data } = setup();
    await login();
    await auth.createAuthorizationUrl();
    auth.disconnect();
    expect(data.size).toBe(0);
    expect(auth.getSnapshot().status).toBe("disconnected");
  });
});
