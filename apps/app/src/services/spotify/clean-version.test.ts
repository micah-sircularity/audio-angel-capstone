import {describe,it,expect,vi} from "vitest";
import {chooseCleanVersion,resolveCleanVersion} from "./clean-version";
const original={id:"1111111111111111111111",name:"Fixture",explicit:true,duration_ms:240000,artists:[{id:"artist",name:"Artist"}],album:{id:"album"}};
const clean={...original,id:"2222222222222222222222",explicit:false};
describe("clean recording selection",()=>{
  it("selects the same recording's non-explicit version",()=>expect(chooseCleanVersion(original,[{...clean,name:"Fixture (Clean)"}])).toBe(`spotify:track:${clean.id}`));
  it.each([{name:"Fixture (Live)"},{artists:[{id:"cover",name:"Artist"}]},{duration_ms:210000},{explicit:true},{explicit:undefined},{is_playable:false},{restrictions:{reason:"market"}},{is_local:true}])("rejects mismatched or unavailable versions %o",patch=>expect(chooseCleanVersion(original,[{...clean,...patch}])).toBeNull());
  it("does not swap recordings already labeled non-explicit",()=>expect(chooseCleanVersion({...original,explicit:false},[clean])).toBeNull());
  it("prefers the same album among otherwise matching versions",()=>expect(chooseCleanVersion(original,[{...clean,album:{id:"compilation"}},{...clean,id:"3333333333333333333333"}])).toBe("spotify:track:3333333333333333333333"));
  it("fetches metadata and bounded catalog results with the user's token",async()=>{
    const fetcher=vi.fn().mockResolvedValueOnce(Response.json(original)).mockResolvedValueOnce(Response.json({tracks:{items:[clean]}}));
    expect(await resolveCleanVersion(`spotify:track:${original.id}`,{getToken:async()=>"token",fetch:fetcher,signal:new AbortController().signal})).toMatchObject({uri:`spotify:track:${clean.id}`,status:"clean"});
    expect(fetcher.mock.calls[1][0]).toContain("limit=10");
    expect(fetcher.mock.calls[0][1].headers.Authorization).toBe("Bearer token");
  });
  it("reports a failed lookup without claiming a clean version",async()=>{
    expect(await resolveCleanVersion(`spotify:track:${original.id}`,{getToken:async()=>"token",fetch:vi.fn().mockResolvedValue(new Response(null,{status:429})),signal:new AbortController().signal})).toMatchObject({uri:`spotify:track:${original.id}`,status:"unavailable"});
  });
  it("does not swallow cancellation or look up podcasts",async()=>{
    const controller=new AbortController();controller.abort();
    await expect(resolveCleanVersion(`spotify:track:${original.id}`,{getToken:async()=>{throw Error("cancelled");},fetch,signal:controller.signal})).rejects.toThrow();
    const fetcher=vi.fn();await resolveCleanVersion("spotify:episode:1111111111111111111111",{getToken:async()=>"token",fetch:fetcher,signal:controller.signal});expect(fetcher).not.toHaveBeenCalled();
  });
});
