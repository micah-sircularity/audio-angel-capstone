import { defineApp } from "convex/server";
import { v } from "convex/values";
import betterAuth from "@convex-dev/better-auth/convex.config";
const app = defineApp({ env: {
  SITE_URL: v.optional(v.string()),
  AUTH_PUBLIC_URL: v.optional(v.string()),
  SPOTIFY_CLIENT_ID: v.optional(v.string()),
  SPOTIFY_CLIENT_SECRET: v.optional(v.string()),
  BETTER_AUTH_SECRET: v.optional(v.string()),
} });
app.use(betterAuth);
export default app;
