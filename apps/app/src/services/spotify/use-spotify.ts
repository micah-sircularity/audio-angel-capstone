import { useEffect, useState } from "react";
import { Platform } from "react-native";
import { accountConfigured, authClient } from "../account";
const playbackScopes = ["streaming", "user-modify-playback-state"];
const libraryScopes = ["user-library-read", "playlist-read-private", "playlist-read-collaborative", "user-follow-read"];
export function useSpotify() {
  const session = authClient.useSession();
  const userId = session.data?.user.id;
  const [permissions, setPermissions] = useState<{userId: string; scopes: string[]; error: string | null} | null>(null);
  useEffect(() => {
    if (!accountConfigured || !userId) return;
    let active = true;
    void authClient.listAccounts().then((result) => {
      if (!active) return;
      const account = result.data?.find((item) => item.providerId === "spotify");
      setPermissions({userId, scopes: account?.scopes ?? [], error: result.error ? "Could not check Spotify permissions. Reconnect to try again." : null});
    }).catch(() => { if (active) setPermissions({userId, scopes: [], error: "Could not check Spotify permissions. Reconnect to try again."}); });
    return () => { active = false; };
  }, [userId]);
  const scopes = permissions?.userId === userId ? permissions?.scopes ?? [] : [];
  return {
    accountId: userId ?? null,
    available: accountConfigured && Platform.OS === "web",
    status: session.isPending ? "connecting" : session.error ? "error" : userId ? "connected" : "disconnected",
    displayName: session.data?.user.name ?? null,
    error: session.error?.message ?? (permissions?.userId === userId ? permissions?.error : null),
    playbackAuthorized: Boolean(userId && playbackScopes.every(scope => scopes.includes(scope))),
    libraryAuthorized: Boolean(userId && libraryScopes.every(scope => scopes.includes(scope))),
    permissionsLoading: Boolean(userId && permissions?.userId !== userId),
    disconnect: async () => {
      const result = await authClient.signOut();
      if (result.error) throw new Error("Could not sign out. Try again.");
      setPermissions(null);
    },
  };
}
