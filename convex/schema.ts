import { defineSchema } from "convex/server";
// Better Auth's component owns accounts, encrypted OAuth tokens and sessions.
// Spotify library content is fetched on demand, never copied into this database.
export default defineSchema({});
