/** Metadata-only matching. Spotify's explicit flag is a label, not a content guarantee. */
type Recording = { id:string; uri:string; name:string; explicit:boolean; duration:number; artists:string[]; artistNames:string[]; albumId:string };
const record=(value:unknown):Recording|null=>{
  if(!value || typeof value!=="object") return null;
  const v=value as Record<string,unknown>;
  const artists=Array.isArray(v.artists)?v.artists:[];
  if(typeof v.id!=="string" || !/^[A-Za-z0-9]{22}$/.test(v.id) || typeof v.name!=="string" || typeof v.explicit!=="boolean" || typeof v.duration_ms!=="number" || v.duration_ms<=0 || v.is_local===true || v.is_playable===false || (v.restrictions as {reason?:string}|undefined)?.reason) return null;
  if(!artists.length || artists.some(a=>typeof a?.id!=="string" || typeof a?.name!=="string")) return null;
  return {id:v.id,uri:`spotify:track:${v.id}`,name:v.name,explicit:v.explicit,duration:v.duration_ms,artists:artists.map(a=>a.id).sort(),artistNames:artists.map(a=>a.name),albumId:(v.album as {id?:string}|undefined)?.id??""};
};
const title=(value:string)=>value.normalize("NFKC").toLowerCase().replace(/\s*[([](?:clean|explicit|edited)(?: version)?[)\]]/g,"").replace(/\s*-\s*(?:clean|explicit|edited)(?: version)?$/g,"").replace(/\s+/g," ").trim();
export type CleanChoice={uri:string;status:"clean"|"original"|"not-found"|"unavailable";originalName?:string};
export function chooseCleanVersion(original:unknown,candidates:unknown[]):string|null {
  const source=record(original);
  if(!source || !source.explicit) return null;
  const matches=candidates.map(record).filter((c):c is Recording=>Boolean(c && !c.explicit && c.id!==source.id && title(c.name)===title(source.name) && c.artists.join(",")===source.artists.join(",") && Math.abs(c.duration-source.duration)<=Math.min(5000,source.duration*0.02)));
  matches.sort((a,b)=>Number(b.albumId===source.albumId)-Number(a.albumId===source.albumId)||Math.abs(a.duration-source.duration)-Math.abs(b.duration-source.duration)||a.id.localeCompare(b.id));
  return matches[0]?.uri??null;
}
export async function resolveCleanVersion(uri:string,options:{getToken:()=>Promise<string>;fetch:(input:string,init?:RequestInit)=>Promise<Response>;signal:AbortSignal}):Promise<CleanChoice> {
  if(!uri.startsWith("spotify:track:")) return {uri,status:"original"};
  const get=async(path:string)=>{
    const response=await options.fetch(`https://api.spotify.com/v1${path}`,{headers:{Authorization:`Bearer ${await options.getToken()}`},signal:options.signal,cache:"no-store"});
    if(!response.ok) throw new Error("Clean-version lookup unavailable");
    return response.json();
  };
  try {
    const raw=await get(`/tracks/${uri.split(":")[2]}`);
    const source=record(raw);
    if(!source) return {uri,status:"unavailable"};
    if(!source.explicit) return {uri,status:"original"};
    const q=`track:${source.name} artist:${source.artistNames[0]}`.slice(0,200);
    const data=await get(`/search?${new URLSearchParams({q,type:"track",limit:"10"})}`);
    const match=chooseCleanVersion(raw,Array.isArray(data?.tracks?.items)?data.tracks.items:[]);
    return match?{uri:match,status:"clean",originalName:source.name}:{uri,status:"not-found"};
  } catch(error) {
    if(options.signal.aborted) throw error;
    return {uri,status:"unavailable"};
  }
}
