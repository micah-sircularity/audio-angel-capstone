import { describe, expect, it } from "vitest";
import { spotifyProfile } from "../convex/lib/spotify_profile";
describe("Spotify account identity",()=>{
  it("supports current dev-mode profiles without email or images",async()=>{
    expect(await spotifyProfile({id:"Listener123",display_name:"Listener"})).toMatchObject({id:"Listener123",name:"Listener",emailVerified:false});
    expect((await spotifyProfile({id:"Listener123"})).email).toMatch(/@accounts\.audio-angel\.invalid$/);
  });
  it("uses a stable provider identity even if email changes",async()=>{
    expect((await spotifyProfile({id:"abc",email:"one@example.com"})).email).toBe((await spotifyProfile({id:"abc",email:"two@example.com"})).email);
    expect((await spotifyProfile({id:"Abc"})).email).not.toBe((await spotifyProfile({id:"abc"})).email);
  });
  it("rejects missing IDs and unsafe artwork",async()=>{
    await expect(spotifyProfile({email:"one@example.com"})).rejects.toThrow();
    expect((await spotifyProfile({id:"abc",images:[{url:"javascript:alert(1)"}]})).image).toBeUndefined();
  });
});
