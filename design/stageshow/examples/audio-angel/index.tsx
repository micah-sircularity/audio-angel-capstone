import { Stage, Phone, Expand, Row, Toggle, States, type Act } from '../../kit';
import { ChevronDown, SlidersHorizontal, SkipBack, SkipForward, Pause, ShieldCheck, Check, Heart } from 'lucide-react';
import './audio-angel.css';

type Scene = { open: boolean; sheet: boolean; avoid: boolean; confirmed: boolean };
const initial: Scene = { open: false, sheet: false, avoid: false, confirmed: false };
const rest = { x: 270, y: 580 };
const script = async (a: Act<Scene>) => {
  await a.wait(900);
  a.mark('expand');
  await a.click('compact');
  a.put({ open: true });
  await a.wait(1200);
  a.mark('filters');
  await a.click('filters');
  a.put({ sheet: true });
  await a.wait(1100);
  a.mark('preference');
  await a.click('preference');
  a.put({ avoid: true, confirmed: true });
  await a.wait(2100);
  a.mark('return');
  await a.click('return');
  a.put({ sheet: false });
  await a.wait(2100);
  a.mark('minimize');
  await a.click('minimize');
  a.put({ open: false });
  await a.wait(650);
  // Preference reset occurs behind the closed player's clip, not in view.
  await a.snap({ avoid: false, confirmed: false });
  await a.move(rest);
  await a.wait(200);
};

export default function AudioAngel() {
  return <Stage<Scene> width={560} height={620} compact={{below:480,width:358,height:480}}
    theme="light" fidelity="realistic" className="aa-scene" initial={initial}
    poster={{open:true,sheet:true,avoid:true,confirmed:true}} script={script}
    cursor={{at:rest,style:'touch'}}>
    {(s,rect,layout)=><Phone width={layout==='compact'?310:400} frame="silver" className="aa-phone" wallpaper="#f6f3ec">
      <div className="aa-library" data-back={s.open || undefined}>
        <div className="aa-home"><div className="aa-heading">Your listening space</div><div className="aa-muted">A little room for yourself.</div></div>
        <div className="aa-collection"><div className="aa-collection-art"><span>Open<br/>country</span></div><div className="aa-collection-copy"><div>Weekend drive</div><div className="aa-muted">Northbound & more</div></div></div>
        <div className="aa-section-label">Continue listening</div>
        <span className="aa-slot" data-target="compact" data-cursor="pointer" />
        <div className="aa-neighbors"><Row title="Blue hour" subtitle="The Lanterns" lead={<span className="aa-thumbnail aa-blue"/>}/><Row title="Stay awhile" subtitle="June & the Pines" lead={<span className="aa-thumbnail aa-sage"/>}/></div>
        <div className="aa-library-foot">Fictional music · illustrative playback</div>
      </div>
      <Expand open={s.open} from={rect('compact')} radius={18} duration={440} className="aa-player">
        <div className="aa-player-track" style={{transform:`translateY(${s.open?0:-170}px)`}}>
          <div className="aa-cover">
            
            <span className="aa-minimize" data-target="minimize" data-cursor="pointer"><ChevronDown size={22}/><span>Now playing</span></span>
            <div className="aa-track-title" style={{transform:`translateX(${s.open?0:24}px)`}}>A little further</div><div className="aa-track-artist" style={{transform:`translateX(${s.open?0:24}px)`}}>Northbound</div>
            <div className="aa-cover-play" data-full={s.open || undefined} style={{transform:`translateX(${s.open?0:-24}px)`}}><Pause size={24}/></div>
          </div>
          <div className="aa-player-body">
            <div className="aa-album-line"><span>Open country</span><Heart size={20}/></div>
            <div className="aa-timeline"><span/></div><div className="aa-times"><span>1:18</span><span>3:32</span></div>
            <div className="aa-transport"><SkipBack size={24}/><span className="aa-pause"><Pause size={24}/></span><SkipForward size={24}/></div>
            <div className="aa-filter-control" data-target="filters" data-cursor="pointer"><ShieldCheck size={20}/><span>Filters active <span className="aa-preview">· preview</span></span><SlidersHorizontal size={20}/></div>
            <div className="aa-disclaimer">Illustrative player. Detection may miss content.</div>
          </div>
        </div>
      </Expand>
      <div className="aa-dimmer" data-show={s.sheet || undefined}/>
      <div className="aa-sheet" data-show={s.sheet || undefined}>
        <div className="aa-sheet-heading">Your filters</div>
        <div className="aa-sheet-subtitle">A little further · playing · simulated</div>
        <div className="aa-filter-list">
          <Row title="Strong language" subtitle="Profanity and strong language."><Toggle on aria-label="Avoid strong language"/></Row>
          <Row title="Drug references" subtitle="References to substance use."><Toggle on={s.avoid} data-target="preference" data-cursor="pointer" aria-label="Avoid drug references"/></Row>
          <Row title="Graphic violence" subtitle="Descriptions of violence or injury."><Toggle on aria-label="Avoid graphic violence"/></Row>
        </div>
        <div className="aa-confirmation"><States value={s.confirmed?'saved':'count'} states={{saved:<><Check size={20}/><span>Preference updated</span></>,count:<span>2 active preferences</span>}}/></div>
        <div className="aa-return" data-target="return" data-cursor="pointer">Return to listening</div>
        <div className="aa-sheet-disclaimer">Preview only · examples stay hidden</div>
      </div>
    </Phone>}
  </Stage>;
}
