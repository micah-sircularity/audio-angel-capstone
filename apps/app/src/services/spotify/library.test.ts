import { describe, expect, it, vi } from "vitest";
import { fetchLibraryPage, libraryPath, type LibraryFetch } from "./library";
const id = "3AJwUDP919kvQ9QcozQPxg";
const track = {type:"track",id,name:"Song",artists:[{name:"Artist"}],album:{type:"album",id:"1111111111111111111111",name:"Album",images:[{url:"https://i.scdn.co/image/cover"}]},duration_ms:120000};
const getToken = async () => "short-lived-test-token";
const response = (data:unknown) => vi.fn<LibraryFetch>().mockResolvedValue(new Response(JSON.stringify(data),{status:200}));
describe("Spotify library",()=>{
  it("unwraps saved tracks without replacing a direct track with its album",async()=>{
    const fetcher=response({items:[{track},track,null,{track:null}],total:4,next:null});
    const page=await fetchLibraryPage({kind:"tracks",getToken,fetch:fetcher});
    expect(page.items).toHaveLength(2);
    expect(page.items[0]).toMatchObject({kind:"track",name:"Song",subtitle:"Artist",playable:true,imageUrl:"https://i.scdn.co/image/cover"});
    expect(fetcher.mock.calls[0][1]?.headers).toEqual({Authorization:"Bearer short-lived-test-token"});
  });
  it("supports renamed playlist item wrappers and unavailable tracks",async()=>{
    const fetcher=response({items:[{item:track},{item:{...track,is_playable:false}},{item:{...track,is_local:true}}],total:3,next:null});
    const page=await fetchLibraryPage({kind:"playlists",collection:{kind:"playlist",id,name:"Playlist",url:"https://open.spotify.com/playlist/"+id},getToken,fetch:fetcher});
    expect(String(fetcher.mock.calls[0][0])).toContain(`/playlists/${id}/items?`);
    expect(page.items.map(x=>x.playable)).toEqual([true,false,false]);
  });
  it("paginates followed artists with a cursor, not offset",async()=>{
    const fetcher=response({artists:{items:[{id,type:"artist",name:"Artist"}],next:"https://api.spotify.com/page",cursors:{after:id},total:40}});
    const page=await fetchLibraryPage({kind:"artists",offset:30,after:id,getToken,fetch:fetcher});
    expect(String(fetcher.mock.calls[0][0])).not.toContain("offset");
    expect(String(fetcher.mock.calls[0][0])).toContain(`after=${id}`);
    expect(page.after).toBe(id);
  });
  it("reads saved shows and episodes without asserting subscription access",async()=>{
    const page=await fetchLibraryPage({kind:"shows",getToken,fetch:response({items:[{show:{id,type:"show",name:"Podcast",publisher:"Publisher"}}],total:1,next:null})});
    expect(page.items[0]).toMatchObject({kind:"show",playable:false,subtitle:"Publisher"});
    const episodes=await fetchLibraryPage({kind:"episodes",getToken,fetch:response({items:[{episode:{id,type:"episode",name:"Episode",is_playable:false,show:{name:"Podcast"}}}],total:1,next:null})});
    expect(episodes.items[0]).toMatchObject({kind:"episode",playable:false,subtitle:"Podcast"});
  });
  it.each([401,403,429,503])("reports a recoverable error for status %s",async(status)=>{
    await expect(fetchLibraryPage({kind:"tracks",getToken,fetch:vi.fn<LibraryFetch>().mockResolvedValue(new Response("private error body",{status}))})).rejects.toMatchObject({status});
  });
  it("rejects malformed pages and prevents arbitrary request paths",async()=>{
    expect(()=>libraryPath("tracks",-1)).toThrow();
    expect(()=>libraryPath("tracks",0,{kind:"album",id:"../../me",name:"Invalid",url:""})).toThrow();
    await expect(fetchLibraryPage({kind:"tracks",getToken,fetch:response({items:"invalid"})})).rejects.toThrow("unreadable");
  });
  it("does not send a library request if the token cannot be obtained",async()=>{
    const fetcher=response({items:[]});
    await expect(fetchLibraryPage({kind:"tracks",getToken:async()=>{throw new Error("Reconnect");},fetch:fetcher})).rejects.toThrow("Reconnect");
    expect(fetcher).not.toHaveBeenCalled();
  });
});
