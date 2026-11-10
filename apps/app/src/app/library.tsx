import { TactilePressable } from "../ui/tactile-pressable";
import React, { useEffect, useState } from "react";
import { Image, Linking, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Button, Chip, Field, Label, Notice, Row, Title } from "../ui/components";
import { IconMusic, IconPlayerPlay } from "../ui/icons";
import { useTheme } from "../ui/theme";
import { useSpotify } from "../services/spotify/use-spotify";
import { useSpotifyPlayer } from "../services/spotify/player-provider";
import { getSpotifyAuth } from "../services/spotify/client";
import { fetchLibraryPage, type Collection, type LibraryItem, type LibraryKind } from "../services/spotify/library";
import { time } from "../data/defaults";
const tabs: {kind: LibraryKind; label: string}[] = [
  {kind:"tracks",label:"Liked songs"}, {kind:"playlists",label:"Playlists"}, {kind:"albums",label:"Albums"},
  {kind:"shows",label:"Podcasts"}, {kind:"episodes",label:"Saved episodes"}, {kind:"artists",label:"Artists"},
];
export default function Library() {
  const spotify = useSpotify();
  const live = useSpotifyPlayer();
  const router = useRouter();
  const t = useTheme();
  const params = useLocalSearchParams<{collectionKind?:string;collectionId?:string;collectionName?:string}>();
  const paramCollection = (()=>{const k=params.collectionKind;const i=params.collectionId;const n=params.collectionName;
    if((k==="album"||k==="playlist"||k==="show")&&typeof i==="string"&&/^[A-Za-z0-9]{22}$/.test(i)&&typeof n==="string"&&n.length>0&&n.length<=200)
      return {kind:k,id:i,name:n,url:`https://open.spotify.com/${k}/${i}`} as Collection;
    return undefined;})();
  const [kind, setKind] = useState<LibraryKind>("tracks");
  const [collection, setCollection] = useState<Collection | undefined>(paramCollection);
  const [fromSearch] = useState(Boolean(paramCollection));
  const [query, setQuery] = useState("");
  const [page, setPage] = useState({offset:0,after:undefined as string | undefined});
  const [retry, setRetry] = useState(0);
  const [loaded, setLoaded] = useState<{key:string;items:LibraryItem[];nextOffset:number|null;after:string|null;total:number} | null>(null);
  const [failure, setFailure] = useState<{key:string;message:string} | null>(null);
  const key = JSON.stringify([kind,collection?.id,page, retry,spotify.accountId]);
  useEffect(() => {
    if (!spotify.libraryAuthorized) return;
    const auth = getSpotifyAuth();
    if (!auth) return;
    const controller = new AbortController();
    void fetchLibraryPage({kind,collection,offset:page.offset,after:page.after,getToken:()=>auth.getPlaybackAccessToken(),signal:controller.signal})
      .then(result => {if(!controller.signal.aborted) setLoaded({key,...result});})
      .catch((error:unknown) => {if(!controller.signal.aborted) setFailure({key,message:error instanceof Error ? error.message : "Your library could not be loaded. Try again."});});
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- key captures all selection fields.
  }, [key, spotify.libraryAuthorized]);
  const result = loaded?.key === key ? loaded : null;
  const error = failure?.key === key ? failure.message : null;
  const select = (selected:LibraryKind) => {setKind(selected);setCollection(undefined);setPage({offset:0,after:undefined});setQuery("");};
  const open = (item:LibraryItem) => {
    if (item.kind === "album" || item.kind === "playlist" || item.kind === "show") {
      setCollection({kind:item.kind,id:item.id,name:item.name,url:item.url});setPage({offset:0,after:undefined});setQuery("");
    } else if (item.playable) {
      if(live.service&&live.snapshot.status==="ready"){live.startPlayback(item.uri);router.navigate("/");}
      else router.navigate({pathname:"/",params:{uri:item.uri}});
    }
    else void Linking.openURL(item.url);
  };
  return <View style={{gap:16}}>
    <Title>{collection?.name ?? "Your library"}</Title>
    <Button onPress={()=>router.navigate("/search")}>Search all Spotify</Button>
    {spotify.status === "connecting" || spotify.permissionsLoading ? <Label muted>Connecting to your Spotify library…</Label>
    : !spotify.libraryAuthorized ? <Notice>
      <Label bold>Bring your Spotify library here</Label>
      <Label muted style={{marginTop:6}}>Connect Spotify to browse your liked songs, playlists, albums and followed podcasts.</Label>
      {spotify.error && <Label style={{marginTop:8}}>{spotify.error}</Label>}
      <View style={{marginTop:16}}><Button onPress={()=>router.navigate("/filtering")}>{spotify.status === "connected" ? "Update Spotify permissions" : "Connect Spotify"}</Button></View>
    </Notice> : <>
      {collection ? <Button secondary onPress={()=>fromSearch?(router.canGoBack()?router.back():router.navigate("/search")):select(kind)}>{fromSearch?"Back to search":`Back to ${tabs.find(tab=>tab.kind===kind)?.label.toLowerCase()}`}</Button> : <View style={{flexDirection:"row",flexWrap:"wrap",gap:8}}>
        {tabs.map(tab=><Chip key={tab.kind} selected={kind===tab.kind} onPress={()=>select(tab.kind)}>{tab.label}</Chip>)}
      </View>}
      <Field value={query} onChangeText={setQuery} label="Find in this page" placeholder="Find in this page" />
      {error ? <Notice><Label>{collection?.kind==="playlist"&&error.includes("not allow")?"Spotify doesn't let this app open this playlist (Spotify-curated playlists are restricted). Open it in Spotify.":error}</Label><View style={{marginTop:12}}><Button secondary onPress={()=>{setFailure(null);setRetry(n=>n+1);}}>Retry library</Button></View>
        {collection && <View style={{marginTop:8}}><Button secondary onPress={()=>void Linking.openURL(collection.url)}>Open in Spotify</Button></View>}
        <View style={{marginTop:8}}><Button secondary onPress={()=>router.navigate("/filtering")}>Connection settings</Button></View>
      </Notice> : !result ? <Label muted>Loading your library…</Label> : <>
        <Row><Label muted size={12}>{result.total} {result.total === 1 ? "item" : "items"}</Label><Button secondary onPress={()=>setRetry(n=>n+1)}>Refresh</Button></Row>
        {result.items.length === 0 ? <Notice><Label>No items here yet.</Label><Label muted>Save or follow content in Spotify, then refresh.</Label></Notice> : null}
        {result.items.length > 0 && !result.items.some(item=>`${item.name} ${item.subtitle}`.toLowerCase().includes(query.toLowerCase())) ? <Label muted>No matches on this page.</Label> : null}
        <View>{result.items.filter(item=>`${item.name} ${item.subtitle}`.toLowerCase().includes(query.toLowerCase())).map(item=><TactilePressable feedback="highlight"
          key={`${item.kind}:${item.id}`} accessibilityRole="button" accessibilityLabel={`${item.playable ? "Play" : item.kind==="artist" ? "Open in Spotify" : "Open"} ${item.name}`}
          onPress={()=>open(item)} style={{minHeight:80,paddingVertical:12,borderBottomWidth:1,borderBottomColor:t.border}}>
          <Row>
            {item.imageUrl ? <Image source={{uri:item.imageUrl}} accessibilityLabel={`Artwork for ${item.name}`} style={{width:48,height:48,borderRadius:6}}/> : <View style={{width:48,height:48,backgroundColor:t.grouped,borderRadius:6,alignItems:"center",justifyContent:"center"}}><IconMusic size={20} color={t.muted}/></View>}
            <View style={{flex:1,minWidth:0}}><Label bold>{item.name}</Label><Label muted size={12}>{item.subtitle || item.kind}</Label>{!item.playable && (item.kind==="track" || item.kind==="episode") && <Label muted size={11}>Open in Spotify · playback unavailable here</Label>}</View>
            {item.durationMs !== null && <Label muted size={11}>{time(item.durationMs)}</Label>}
            {item.playable && <IconPlayerPlay size={20} color={t.text}/>}
          </Row>
        </TactilePressable>)}</View>
        <Row>
          {page.offset>0 && <Button secondary onPress={()=>setPage({offset:0,after:undefined})}>First page</Button>}
          {result.nextOffset!==null && <Button secondary onPress={()=>setPage({offset:result.nextOffset!,after:result.after??undefined})}>Next page</Button>}
        </Row>
      </>}
      {kind === "shows" || kind === "episodes" || collection?.kind === "show" ? <Label muted size={12}>Following a podcast does not guarantee access to paid episodes. Podcast transcripts come from Taddy when available. Filtering is off for podcasts.</Label> : null}
      <Label muted size={12}>Content from Spotify. Set up experimental filtering in the player.</Label>
    </>}
  </View>;
}
