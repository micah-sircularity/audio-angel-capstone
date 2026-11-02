import React from "react";
import { useRouter } from "expo-router";
import { Button, Label, Title } from "../ui/components";
export default function NotFound() {
  const router = useRouter();
  return (
    <>
      <Title>Page not found.</Title>
      <Label muted style={{ marginBottom: 20 }}>
        Return to your player to keep listening.
      </Label>
      <Button onPress={() => router.replace("/")}>Go to Now Playing</Button>
    </>
  );
}
