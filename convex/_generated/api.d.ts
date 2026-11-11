/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as auth from "../auth.js";
import type * as http from "../http.js";
import type * as lib_audius from "../lib/audius.js";
import type * as lib_deepgram from "../lib/deepgram.js";
import type * as lib_itunes from "../lib/itunes.js";
import type * as lib_jev from "../lib/jev.js";
import type * as lib_mediaPlan from "../lib/mediaPlan.js";
import type * as lib_mediaValidators from "../lib/mediaValidators.js";
import type * as lib_pipeline from "../lib/pipeline.js";
import type * as lib_questions from "../lib/questions.js";
import type * as lib_rss from "../lib/rss.js";
import type * as lib_safeFetch from "../lib/safeFetch.js";
import type * as lib_spotify_profile from "../lib/spotify_profile.js";
import type * as listen from "../listen.js";
import type * as media from "../media.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  auth: typeof auth;
  http: typeof http;
  "lib/audius": typeof lib_audius;
  "lib/deepgram": typeof lib_deepgram;
  "lib/itunes": typeof lib_itunes;
  "lib/jev": typeof lib_jev;
  "lib/mediaPlan": typeof lib_mediaPlan;
  "lib/mediaValidators": typeof lib_mediaValidators;
  "lib/pipeline": typeof lib_pipeline;
  "lib/questions": typeof lib_questions;
  "lib/rss": typeof lib_rss;
  "lib/safeFetch": typeof lib_safeFetch;
  "lib/spotify_profile": typeof lib_spotify_profile;
  listen: typeof listen;
  media: typeof media;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  betterAuth: import("@convex-dev/better-auth/_generated/component.js").ComponentApi<"betterAuth">;
  workflow: import("@convex-dev/workflow/_generated/component.js").ComponentApi<"workflow">;
};
