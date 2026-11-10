import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import AudioAngel from './examples/audio-angel';
import Gold from './examples/phone-touch';
import './kit/stageshow.css';
import './page.css';
function App(){
 const [replay,setReplay]=useState(0);
 const gold=new URLSearchParams(location.search).get('capture') === 'phone-touch';
 return <main><div className="host-intro"><p>Audio Angel</p><h1>A preference, then back to listening.</h1><p>A staged interaction study. Fictional music, simulated playback.</p></div><div id="example">{gold ? <Gold/> : <AudioAngel key={replay}/>}</div><div className="host-footer"><button onClick={()=>setReplay(v=>v+1)}>Replay walkthrough</button><span>Player → filters → preference saved</span></div></main>;
}
createRoot(document.getElementById('root')!).render(<App/>);
