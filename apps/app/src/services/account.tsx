import React from "react";
import { ConvexReactClient } from "convex/react";
import { ConvexBetterAuthProvider, type AuthClient } from "@convex-dev/better-auth/react";
import { convexClient, crossDomainClient } from "@convex-dev/better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

const url = process.env.EXPO_PUBLIC_CONVEX_URL;
const siteUrl = process.env.EXPO_PUBLIC_CONVEX_SITE_URL;
export const accountConfigured = Boolean(url && siteUrl);
export const authClient = createAuthClient({
  baseURL: siteUrl,
  plugins: [convexClient(), crossDomainClient()],
});
export const convex = url ? new ConvexReactClient(url) : null;
export function AccountProvider({ children }: React.PropsWithChildren) {
  if (!convex) return <>{children}</>;
  // The component's broad plugin generic does not accept Better Auth 1.6 + TS 6 inference.
  // Both required plugins are explicitly installed above; runtime API is unchanged.
  return <ConvexBetterAuthProvider client={convex} authClient={authClient as unknown as AuthClient}>{children}</ConvexBetterAuthProvider>;
}
