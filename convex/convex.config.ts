import { defineApp } from "convex/server";
import { v } from "convex/values";
import betterAuth from "@convex-dev/better-auth/convex.config";
import workflow from "@convex-dev/workflow/convex.config";
const app = defineApp({ env: {
  SITE_URL: v.optional(v.string()),
  AUTH_PUBLIC_URL: v.optional(v.string()),
  SPOTIFY_CLIENT_ID: v.optional(v.string()),
  SPOTIFY_CLIENT_SECRET: v.optional(v.string()),
  BETTER_AUTH_SECRET: v.optional(v.string()),
  // Audio-native lane secrets. Declared only; real values are set as
  // Convex deployment env vars and pipeline code errors cleanly without them.
  DEEPGRAM_API_KEY: v.optional(v.string()),
  OPENROUTER_API_KEY: v.optional(v.string()),
  REPLICATE_API_TOKEN: v.optional(v.string()),
  MEDIA_SEPARATE_URL: v.optional(v.string()),
  MEDIA_RENDER_URL: v.optional(v.string()),
  MEDIA_PREVIEW_URL: v.optional(v.string()),
  MEDIA_WORKER_TOKEN: v.optional(v.string()),
} });
app.use(betterAuth);
app.use(workflow);
export default app;
