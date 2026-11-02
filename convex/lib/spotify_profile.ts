/** Spotify Dev Mode no longer guarantees /me.email. No email/password login is enabled. */
export async function spotifyProfile(value: unknown) {
  if (!value || typeof value !== "object") throw new Error("Spotify returned an invalid account.");
  const profile = value as Record<string, unknown>;
  if (typeof profile.id !== "string" || !/^[A-Za-z0-9_.-]{1,100}$/.test(profile.id)) throw new Error("Spotify returned an invalid account ID.");
  // Hash the case-sensitive provider ID into a fixed-length, non-deliverable account key.
  // .invalid is reserved and non-deliverable. This is an internal account key, not a contact address.
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(profile.id));
  const encoded = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
  const firstImage = Array.isArray(profile.images) ? profile.images[0] : null;
  const image = firstImage && typeof firstImage === "object" && "url" in firstImage && typeof firstImage.url === "string" && firstImage.url.startsWith("https://") ? firstImage.url : undefined;
  return {
    id: profile.id,
    name: typeof profile.display_name === "string" && profile.display_name.trim() ? profile.display_name : "Spotify listener",
    email: `${encoded}@accounts.audio-angel.invalid`,
    emailVerified: false,
    image,
  };
}
