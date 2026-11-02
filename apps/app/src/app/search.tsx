import React, { useEffect, useState } from "react";
import { Image, Linking, Pressable, View } from "react-native";
import { useRouter } from "expo-router";
import { Button, Chip, Field, Label, Notice, Row, Title } from "../ui/components";
import { IconChevronRight, IconMusic, IconPlayerPlay } from "../ui/icons";
import { useTheme } from "../ui/theme";
import { useSpotify } from "../services/spotify/use-spotify";
import { useSpotifyPlayer } from "../services/spotify/player-provider";
import { getSpotifyAuth } from "../services/spotify/client";
import { searchSpotify, type LibraryItem, type SearchType } from "../services/spotify/library";

const chips: {type:SearchType;label:string}[] = [
  {type:"all",label:"All"},{type:"track",label:"Songs"},{type:"show",label:"Podcasts"},
  {type:"episode",label:"Episodes"},{type:"album",label:"Albums"},{type:"playlist",label:"Playlists"},{type:"artist",label:"Artists"},
];
const sections: {group:keyof NonNullable<Awaited<ReturnType<typeof searchSpotify>>["groups"]>;label:string;type:SearchType}[] = [
  {group:"track",label:"Songs",type:"track"},{group:"episode",label:"Episodes",type:"episode"},
  {group:"show",label:"Podcasts",type:"show"},{group:"album",label:"Albums",type:"album"},
  {group:"playlist",label:"Playlists",type:"playlist"},{group:"artist",label:"Artists",type:"artist"},
];
type Groups = Awaited<ReturnType<typeof searchSpotify>>["groups"];

export default function Search() {
  const spotify=useSpotify();const live=useSpotifyPlayer();const router=useRouter();const t=useTheme();
  const [query,setQuery]=useState("");
  const [type,setType]=useState<SearchType>("all");
  const [submitted,setSubmitted]=useState<{query:string;type:SearchType;offset:number;retry:number}|null>(null);
  const [loaded,setLoaded]=useState<{key:string;groups:Groups}|null>(null);
  const [failed,setFailed]=useState<{key:string;message:string}|null>(null);
  const key=JSON.stringify([submitted,spotify.accountId]);
  const groups=loaded?.key===key ? loaded.groups : null;
  const error=failed?.key===key ? failed.message : null;
  const connected=spotify.status==="connected";
  useEffect(()=>{
    const auth=getSpotifyAuth();
    if(!connected || !submitted || !auth) return;
    const controller=new AbortController();
    void searchSpotify({...submitted,getToken:()=>auth.getPlaybackAccessToken(),signal:controller.signal}).then(result=>{
      if(!controller.signal.aborted) setLoaded({key,groups:result.groups});
    }).catch((caught:unknown)=>{
      if(!controller.signal.aborted) setFailed({key,message:caught instanceof Error?caught.message:"Search failed. Try again."});
    });
    return ()=>controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- key captures submitted query and account.
  },[key,connected]);
  const search=(text=query,searchType=type)=>{if(text.trim()) setSubmitted({query:text.trim(),type:searchType,offset:0,retry:(submitted?.retry??0)+1});};
  const selectType=(next:SearchType)=>{setType(next);if(submitted) setSubmitted({...submitted,type:next,offset:0});};
  const open=(item:LibraryItem)=>{
    if(item.kind==="album"||item.kind==="playlist"||item.kind==="show"){
      router.navigate({pathname:"/library",params:{collectionKind:item.kind,collectionId:item.id,collectionName:item.name}});return;
    }
    if(item.kind==="artist"){setQuery(item.name);selectType("track");setSubmitted({query:`artist:"${item.name}"`,type:"track",offset:0,retry:(submitted?.retry??0)+1});return;}
    if(item.playable){
      if(live.service&&live.snapshot.status==="ready"){live.startPlayback(item.uri);router.navigate("/");}
      else router.navigate({pathname:"/",params:{uri:item.uri}});
    }
    else void Linking.openURL(item.url);
  };
  const renderRow=(item:LibraryItem)=>{
    const playable=item.playable&&(item.kind==="track"||item.kind==="episode");
    const label=item.kind==="album"||item.kind==="playlist"||item.kind==="show"?`Open ${item.name}`:item.kind==="artist"?`Find songs by ${item.name}`:`${item.playable?"Select":"Open in Spotify"} ${item.name} by ${item.subtitle}`;
    return <Pressable key={`${item.kind}:${item.id}`} accessibilityRole="button" accessibilityLabel={label} onPress={()=>open(item)} style={({pressed})=>({minHeight:80,paddingVertical:12,borderBottomWidth:1,borderBottomColor:t.border,opacity:pressed?0.65:1})}>
      <Row>
        {item.imageUrl?<Image source={{uri:item.imageUrl}} accessibilityLabel={`Artwork for ${item.name}`} style={{width:48,height:48,borderRadius:6}}/>:<View style={{width:48,height:48,backgroundColor:t.grouped,alignItems:"center",justifyContent:"center",borderRadius:6}}><IconMusic size={20} color={t.muted}/></View>}
        <View style={{flex:1,minWidth:0}}><Label bold>{item.name}</Label><Label muted size={12}>{item.subtitle||item.kind}{item.albumName?` · ${item.albumName}`:""}</Label>{item.explicit && <Label muted size={11}>Explicit</Label>}{!item.playable&&(item.kind==="track"||item.kind==="episode")&&<Label muted size={11}>Unavailable here · Open in Spotify</Label>}</View>
        {playable?<IconPlayerPlay size={20} color={t.text}/>:<IconChevronRight size={20} color={t.muted}/>}
      </Row>
    </Pressable>;
  };
  return <View style={{gap:16}}>
    <Title>Search Spotify</Title>
    <Label muted>Find songs, podcasts, episodes, albums, playlists and artists across Spotify.</Label>
    <Field value={query} onChangeText={setQuery} label="Search Spotify" placeholder="Songs, podcasts, albums, playlists or artists" onSubmitEditing={()=>search()}/>
    <Button disabled={!query.trim() || !connected} onPress={()=>search()}>Search</Button>
    {connected && <View style={{flexDirection:"row",flexWrap:"wrap",gap:8}}>
      {chips.map(chip=><Chip key={chip.type} selected={type===chip.type} onPress={()=>selectType(chip.type)}>{chip.label}</Chip>)}
    </View>}
    {!connected ? <Notice><Label>Connect Spotify to search the catalog.</Label><View style={{marginTop:12}}><Button secondary onPress={()=>router.navigate("/settings")}>Connect Spotify</Button></View></Notice> : <>
      {!submitted && <Notice>
        <Label bold>Try the first filtering test</Label>
        <Label muted size={12} style={{marginVertical:8}}>Creep by Radiohead, from Pablo Honey. Choose the original album recording. Enable Cuss words in your profile, then turn on filtering in the player.</Label>
        <Button secondary onPress={()=>{setQuery("Creep Radiohead");setType("track");search("track:Creep artist:Radiohead","track");}}>Find Creep by Radiohead</Button>
      </Notice>}
      {submitted && type!=="all" && <Label muted size={12}>Results for “{submitted.query}” · page {Math.floor(submitted.offset/10)+1}</Label>}
      {submitted && !groups && !error && <Label muted>Searching Spotify…</Label>}
      {error && <Notice><Label>{error}</Label><View style={{marginTop:12}}><Button secondary onPress={()=>setSubmitted(s=>s?{...s,retry:s.retry+1}:s)}>Retry search</Button></View></Notice>}
      {groups && submitted?.type==="all" && <>
        {!sections.some(s=>(groups[s.group]?.items.length??0)>0) && <Notice><Label>No results. Try a different search.</Label></Notice>}
        {sections.map(section=>{
          const page=groups[section.group];
          if(!page?.items.length) return null;
          return <View key={section.group} style={{gap:4}}>
            <Row><Label bold size={18}>{section.label}</Label></Row>
            {page.items.slice(0,4).map(renderRow)}
            {page.total>4&&<Button secondary onPress={()=>selectType(section.type)}>See all {section.label.toLowerCase()}</Button>}
          </View>;
        })}
      </>}
      {groups && submitted && submitted.type!=="all" && (()=>{
        const page=groups[submitted.type as keyof Groups];
        if(!page) return null;
        return <>
          {!page.items.length && <Notice><Label>No results. Try a different search.</Label></Notice>}
          {page.items.map(renderRow)}
          <Row>{submitted.offset>0&&<Button secondary onPress={()=>setSubmitted(s=>s?{...s,offset:Math.max(0,s.offset-10)}:s)}>Previous page</Button>}{page.nextOffset!==null&&<Button secondary onPress={()=>setSubmitted(s=>s?{...s,offset:page.nextOffset!}:s)}>Next page</Button>}</Row>
        </>;
      })()}
    </>}
    <Button secondary onPress={()=>router.navigate("/library")}>Your library</Button>
  </View>;
}
