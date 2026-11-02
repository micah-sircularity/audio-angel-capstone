import React, { useEffect } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Label } from "../ui/components";

/** The live player moved to the Now Playing tab; keep ?uri= links working. */
export default function SpotifyRedirect() {
  const router = useRouter();
  const params = useLocalSearchParams<{ uri?: string }>();
  const uri = typeof params.uri === "string" ? params.uri : undefined;
  useEffect(() => {
    router.replace({ pathname: "/", params: uri ? { uri } : {} });
  }, [router, uri]);
  return <Label muted>Opening the player…</Label>;
}
