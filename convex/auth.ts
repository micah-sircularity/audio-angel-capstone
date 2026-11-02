import { createClient, type GenericCtx } from "@convex-dev/better-auth";
import { convex, crossDomain } from "@convex-dev/better-auth/plugins";
import { betterAuth } from "better-auth/minimal";
import { components } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";
import { env, query } from "./_generated/server";
import { spotifyProfile } from "./lib/spotify_profile";
import authConfig from "./auth.config";

export const authComponent = createClient<DataModel>(components.betterAuth);
export const SPOTIFY_SCOPES = [
  "user-read-private", "user-read-email", "streaming", "user-modify-playback-state",
  "user-library-read", "playlist-read-private", "playlist-read-collaborative",
  "user-follow-read", "user-read-playback-position",
];
export const createAuth = (ctx: GenericCtx<DataModel>) => betterAuth({
  appName: "Audio Angel",
  baseURL: env.AUTH_PUBLIC_URL ?? env.CONVEX_SITE_URL,
  secret: env.BETTER_AUTH_SECRET,
  trustedOrigins: env.SITE_URL ? [env.SITE_URL] : [],
  database: authComponent.adapter(ctx),
  account: { encryptOAuthTokens: true, accountLinking: {enabled: false} },
  // No password signup: each app account is connected to Spotify.
  socialProviders: env.SPOTIFY_CLIENT_ID && env.SPOTIFY_CLIENT_SECRET ? {
    spotify: { clientId: env.SPOTIFY_CLIENT_ID, clientSecret: env.SPOTIFY_CLIENT_SECRET, scope: SPOTIFY_SCOPES,
      getUserInfo: async (token) => {
        const response = await fetch("https://api.spotify.com/v1/me", {headers: {Authorization: `Bearer ${token.accessToken}`}});
        if (!response.ok) return null;
        const profile: unknown = await response.json();
        return {user: await spotifyProfile(profile), data: profile as Record<string, unknown>};
      },
    },
  } : {},
  plugins: [crossDomain({ siteUrl: env.SITE_URL ?? "http://127.0.0.1:3101" }), convex({ authConfig })],
});
export const configuration = query({
  args: {},
  handler: () => ({
    spotifyConfigured: Boolean(env.SPOTIFY_CLIENT_ID && env.SPOTIFY_CLIENT_SECRET && env.BETTER_AUTH_SECRET && env.SITE_URL),
    redirectUri: `${env.AUTH_PUBLIC_URL ?? env.CONVEX_SITE_URL}/api/auth/callback/spotify`,
  }),
});
