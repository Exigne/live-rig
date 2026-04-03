/**
 * App.jsx — Live Rig Performance Suite
 *
 * Key changes in this version:
 *  ✓ DRAG FIX — drag state stored in a ref, not React state (eliminates stale closure bug)
 *  ✓ POLYPHONIC SEQ — steps hold { notes:[{note,oct},...], len } for chords
 *  ✓ DRUM MACHINE MODS — per-track velocity, tune (±24st), decay, pan knobs
 *  ✓ 3-BAND EQ — low shelf / mid peak / high shelf on every mixer channel
 *  ✓ Piano roll previews notes via keyboard click
 *  ✓ Chord display in sequencer steps (e.g. "C+E+G")
 */

import { useState, useEffect, useRef, useCallback, useReducer } from "react";
import { PianoRoll } from "./PianoRoll";
import { AudioEngine, noteFreq, stepToChord } from "./AudioEngine";
import { auth as authAPI, songs as songsAPI, cloudinary } from "./api";

// ─── CONSTANTS ────────────────────────────────────────────────────────────────
const NOTES      = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const PAD_KEYS   = ['Q','W','E','R','A','S','D','F'];
const DRUM_IDS   = ['kick','snare','hh','bass'];
const DRUM_NAMES = ['KICK','SNARE','HIHAT','BASS'];
const DRUM_COLS  = ['#c4400f','#a03018','#7a5010','#d05030'];

const DEVICE_TYPES = {
  poly: { name:'POLY SYNTH',   col:'#1566a8', pitched:true,  def:{ note:'A', oct:4, wave:'sawtooth', atk:20,  rel:600,  flt:2000 } },
  str:  { name:'STRING PAD',   col:'#7030a0', pitched:true,  def:{ note:'C', oct:3, detune:8, spread:7, atk:800, rel:1200, flt:3500 } },
  rr:   { name:'ROAD RASH FM', col:'#8a6500', pitched:true,  def:{ note:'E', oct:2, mr:1.0, mi:3.5, det:18, flt:1800, atk:5, rel:180, drv:70, arp:true } },
  acid: { name:'ACID BASS',    col:'#5a8800', pitched:true,  def:{ note:'A', oct:1, wave:'sawtooth', cut:400, res:80, env:3000, dec:250, dist:60 } },
  samp: { name:'SAMPLER NN-8', col:'#1a7a3a', pitched:'pad', def:{ pads:Array(8).fill(null).map((_,i)=>({ name:`PAD ${i+1}`, buf:null, vol:100, pitch:0, cloudUrl:null })) } },
  rv:   { name:'REVERB UNIT',  col:'#1a6080', pitched:false, def:{ room:'hall', preDly:20, decay:3.0, damp:30, mix:40 } },
};

const ROOM_TYPES = ['hall','room','plate','cath','spring'];

const MIX_KEYS = ['drums','synth','rr','samp'];
const MIX_CH   = [
  { key:'drums', name:'DRUMS',  col:'#c4400f' },
  { key:'synth', name:'SYNTH',  col:'#1566a8' },
  { key:'rr',    name:'RR FM',  col:'#8a6500' },
  { key:'samp',  name:'SAMP',   col:'#1a7a3a' },
  { key:'master',name:'MASTER', col:'#5050a0' },
];

// ─── THEME ────────────────────────────────────────────────────────────────────
const L = {
  bg:'#f2efe9', panel:'#ffffff', panelB:'#f8f7f4',
  border:'#e2dfd8', borderHi:'#ccc9c0',
  text:'#1a1716', muted:'#7a7570', dim:'#b0aba5', accent:'#e8950a',
  shadow:'0 1px 4px rgba(0,0,0,0.07), 0 4px 16px rgba(0,0,0,0.04)',
};
const mono = "'JetBrains Mono','Fira Code','Courier New',monospace";

// ─── DEFAULT STATE ────────────────────────────────────────────────────────────
const mkDrumParams = () => ({
  kick:  { vel:100, tune:0, decay:1.0, pan:0 },
  snare: { vel:100, tune:0, decay:1.0, pan:0 },
  hh:    { vel:80,  tune:0, decay:1.0, pan:0 },
  bass:  { vel:100, tune:0, decay:1.0, pan:0 },
});

const mkMix = () => ({
  drums:  { vol:80, pan:0, mute:false, solo:false, eq:{ lo:0, mid:0, hi:0, midFreq:1000 } },
  synth:  { vol:75, pan:0, mute:false, solo:false, eq:{ lo:0, mid:0, hi:0, midFreq:1000 } },
  rr:     { vol:70, pan:0, mute:false, solo:false, eq:{ lo:0, mid:0, hi:0, midFreq:1000 } },
  samp:   { vol:80, pan:0, mute:false, solo:false, eq:{ lo:0, mid:0, hi:0, midFreq:1000 } },
  master: { vol:85, pan:0 },
});

const DEFAULT_DEVICES = () => [
  { id:'poly-1', type:'poly', ...DEVICE_TYPES.poly.def },
  { id:'rr-1',   type:'rr',   ...DEVICE_TYPES.rr.def   },
  { id:'samp-1', type:'samp', ...DEVICE_TYPES.samp.def  },
];

const mkSeq = (devIds=[], len=16) => {
  const base = {
    kick:  Array(len).fill(false).map((_,i)=>[1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0][i%16]===1),
    snare: Array(len).fill(false).map((_,i)=>[0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0][i%16]===1),
    hh:    Array(len).fill(false).map((_,i)=>[1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0][i%16]===1),
    bass:  Array(len).fill(false).map((_,i)=>[1,0,0,0,0,0,1,0,0,0,1,0,0,0,0,0][i%16]===1),
  };
  devIds.forEach(id => { base[id] = Array(len).fill(null); });
  return base;
};

const engine = new AudioEngine();

// ─── SMALL COMPONENTS ─────────────────────────────────────────────────────────
function Screw() {
  return (
    <div style={{ width:10,height:10,borderRadius:'50%',flexShrink:0,
      background:'radial-gradient(circle at 35% 30%,#d8d5d0,#a8a5a0)',
      border:'1px solid #c0bdb8',position:'relative' }}>
      <div style={{ position:'absolute',inset:0,display:'flex',alignItems:'center',justifyContent:'center' }}>
        <div style={{ width:'65%',height:1,background:'rgba(0,0,0,0.2)',position:'absolute' }}/>
        <div style={{ width:1,height:'65%',background:'rgba(0,0,0,0.14)',position:'absolute' }}/>
      </div>
    </div>
  );
}

function Ear({ side }) {
  return (
    <div style={{ width:22,flexShrink:0,
      background:side==='left'?'linear-gradient(to right,#e0ddd8,#eae7e2)':'linear-gradient(to left,#e0ddd8,#eae7e2)',
      borderLeft:side==='left'?`1px solid ${L.borderHi}`:'none',
      borderRight:side==='right'?`1px solid ${L.borderHi}`:'none',
      display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'space-around',padding:'5px 0' }}>
      <Screw/><Screw/><Screw/>
    </div>
  );
}

function DevHeader({ label, subtitle, col, open, onToggle, onRemove }) {
  return (
    <div style={{ height:26,padding:'0 12px',display:'flex',alignItems:'center',gap:10,
      borderBottom:`1px solid ${L.border}`,background:L.panel,userSelect:'none',borderLeft:`4px solid ${col}` }}>
      <div onClick={onToggle} style={{ flex:1,display:'flex',alignItems:'center',gap:10,cursor:'pointer' }}>
        <div style={{ width:7,height:7,borderRadius:'50%',background:col,flexShrink:0,boxShadow:`0 0 4px ${col}80` }}/>
        <span style={{ fontSize:10,fontWeight:700,letterSpacing:2,color:L.text,textTransform:'uppercase' }}>{label}</span>
        {subtitle&&<span style={{ fontSize:9,color:L.muted,letterSpacing:1 }}>{subtitle}</span>}
        <span style={{ marginLeft:'auto',fontSize:9,color:L.dim,marginRight:onRemove?6:0 }}>{open?'▼':'►'}</span>
      </div>
      {onRemove&&<button onClick={e=>{e.stopPropagation();onRemove();}}
        style={{ background:'transparent',border:'none',color:L.muted,fontSize:14,cursor:'pointer',padding:'0 2px',lineHeight:1,flexShrink:0 }}>✕</button>}
    </div>
  );
}

function RackUnit({ children }) {
  return (
    <div style={{ display:'flex',flexShrink:0,border:`1px solid ${L.border}`,borderRadius:4,
      overflow:'hidden',boxShadow:L.shadow,marginBottom:4 }}>
      <Ear side="left"/>
      <div style={{ flex:1,background:L.panel,minWidth:0 }}>{children}</div>
      <Ear side="right"/>
    </div>
  );
}

function Knob({ val, min, max, step=1, col, label, fmt, onVal, size=24 }) {
  const drag=useRef(false), sY=useRef(0), sV=useRef(val);
  const pct=(val-min)/(max-min), ang=-145+pct*290;

  useEffect(()=>{
    const mv=e=>{
      if(!drag.current) return;
      let nv=sV.current+((sY.current-e.clientY)/130)*(max-min);
      nv=Math.max(min,Math.min(max,Math.round(nv/step)*step));
      onVal(nv);
    };
    const up=()=>{drag.current=false;};
    window.addEventListener('mousemove',mv); window.addEventListener('mouseup',up);
    return()=>{ window.removeEventListener('mousemove',mv); window.removeEventListener('mouseup',up); };
  },[min,max,step,onVal]);

  return (
    <div style={{ display:'flex',flexDirection:'column',alignItems:'center',gap:2,flexShrink:0 }}>
      <div onMouseDown={e=>{drag.current=true;sY.current=e.clientY;sV.current=val;e.preventDefault();}}
        style={{ width:size,height:size,borderRadius:'50%',cursor:'ns-resize',
          background:`radial-gradient(circle at 40% 35%,#fff,${col}18)`,
          border:`2px solid ${col}55`,
          boxShadow:`0 2px 5px rgba(0,0,0,0.1),inset 0 1px 2px rgba(255,255,255,0.9)`,
          position:'relative',userSelect:'none' }}>
        <div style={{ position:'absolute',top:'14%',left:'50%',width:2,height:'28%',background:col,
          borderRadius:2,transformOrigin:'bottom center',
          transform:`translateX(-50%) rotate(${ang}deg)`,boxShadow:`0 0 3px ${col}80` }}/>
      </div>
      <div style={{ fontSize:7,color:L.muted,letterSpacing:0.5,textTransform:'uppercase',whiteSpace:'nowrap' }}>{label}</div>
      <div style={{ fontSize:7,color:col,fontFamily:mono,fontWeight:700 }}>{fmt?fmt(val):val}</div>
    </div>
  );
}

function Pill({ label, active, col, onClick, tiny }) {
  return (
    <button onClick={onClick} style={{
      fontFamily:mono,fontSize:tiny?8:9,letterSpacing:1,textTransform:'uppercase',
      padding:tiny?'3px 7px':'4px 10px',borderRadius:20,cursor:'pointer',
      border:`1.5px solid ${active?col:L.border}`,
      background:active?col:L.panel, color:active?'#fff':L.muted,
      fontWeight:active?700:400, transition:'all 0.1s',
    }}>{label}</button>
  );
}

// EQ band knob with centre detent colour
function EQKnob({ val, col, label, onVal }) {
  const knobCol = val > 0 ? col : val < 0 ? '#c4400f' : L.dim;
  return (
    <div style={{ display:'flex',flexDirection:'column',alignItems:'center',gap:1,flexShrink:0 }}>
      <Knob val={val} min={-15} max={15} step={0.5} col={knobCol} label={label}
        fmt={v=>v===0?'0 dB':(v>0?'+':'')+v.toFixed(1)} onVal={onVal} size={20}/>
    </div>
  );
}

// ─── CHORD DISPLAY HELPER ─────────────────────────────────────────────────────
function chordLabel(step) {
  if (!step) return '';
  const c = step.notes ? step : step.note ? { notes:[{note:step.note,oct:step.oct}] } : null;
  if (!c) return '';
  if (c.notes.length === 1) return c.notes[0].note + c.notes[0].oct;
  if (c.notes.length <= 3)  return c.notes.map(n=>n.note).join('+');
  return `${c.notes.length}♪`;
}

// ─── APP ──────────────────────────────────────────────────────────────────────
export default function App() {
  // Auth
  const [authed,    setAuthed]    = useState(false);
  const [token,     setToken]     = useState(()=>localStorage.getItem('lr_token')||'');
  const [loginU,    setLoginU]    = useState('');
  const [loginP,    setLoginP]    = useState('');
  const [loginErr,  setLoginErr]  = useState('');
  const [loginMode, setLoginMode] = useState('login');
  const [authBusy,  setAuthBusy]  = useState(false);

  // Transport
  const [playing,      setPlaying]      = useState(false);
  const [bpm,          setBpmS]         = useState(120);
  const [step,         setStep]         = useState(-1);
  const [seqLen,       setSeqLen]       = useState(16);
  const [stepsPerBeat, setStepsPerBeat] = useState(4);

  // Core state
  const [devices,    setDevices]    = useState(DEFAULT_DEVICES);
  const [seq,        setSeq]        = useState(()=>mkSeq(['poly-1','rr-1','samp-1']));
  const [mx,         setMx]         = useState(mkMix);
  const [drumParams, setDrumParams] = useState(mkDrumParams);

  // FX
  const [fxDist,setFxDist]=useState(0); const [fxDlyT,setFxDlyT]=useState(30);
  const [fxDlyFb,setFxDlyFb]=useState(25); const [fxDlyW,setFxDlyW]=useState(0);
  const [fxRvW,setFxRvW]=useState(0);

  // UI
  const [open,      setOpen]      = useState({ mix:true, drum:true, fx:false });
  const [pianoRoll, setPianoRoll] = useState(null);

  // Songs
  const [songs,      setSongs]      = useState([]);
  const [showSongs,  setShowSongs]  = useState(false);
  const [songName,   setSongName]   = useState('New Song');
  const [activeSong, setActiveSong] = useState(null);
  const [songBusy,   setSongBusy]   = useState(false);
  const [songMsg,    setSongMsg]    = useState('');

  // ── Refs ───────────────────────────────────────────────────────────────────
  const schedRef     = useRef(null);
  const stepRef      = useRef(0);
  const nextTRef     = useRef(0);
  const bpmRef       = useRef(bpm);
  const seqRef       = useRef(seq);
  const seqLenRef    = useRef(seqLen);
  const spbRef       = useRef(stepsPerBeat);
  const devicesRef   = useRef(devices);
  const drumPRef     = useRef(drumParams);

  // !! Key fix: dragState as a plain ref — never triggers re-renders, always fresh in event handlers
  const dragRef = useRef(null); // { trackId, startSi, hasDragged }
  // Trigger a re-render when note block visuals need updating (after drag extends)
  const [, tickRender] = useReducer(x=>x+1, 0);

  bpmRef.current     = bpm;
  seqRef.current     = seq;
  seqLenRef.current  = seqLen;
  spbRef.current     = stepsPerBeat;
  devicesRef.current = devices;
  drumPRef.current   = drumParams;

  const ea = useCallback(()=>{ engine.init(); engine.resume(); },[]);

  // ── Side-effects ──────────────────────────────────────────────────────────
  useEffect(()=>{ engine.applyMixer(mx); },[mx]);
  useEffect(()=>{ engine.applyFX({ dist:fxDist, dlyT:fxDlyT, dlyFb:fxDlyFb, dlyW:fxDlyW, rvW:fxRvW }); },
    [fxDist,fxDlyT,fxDlyFb,fxDlyW,fxRvW]);

  // Push EQ changes to engine whenever mx changes
  useEffect(()=>{
    if (!engine.ready) return;
    MIX_KEYS.forEach(k => { if (mx[k]?.eq) engine.applyEQ(k, mx[k].eq); });
  },[mx]);

  // Reverb unit sync
  const prevRvRef = useRef({});
  useEffect(()=>{
    const rv = devices.find(d=>d.type==='rv');
    if (!rv||!engine.ready) return;
    const p = prevRvRef.current;
    if (p.room!==rv.room||p.decay!==rv.decay||p.damp!==rv.damp)
      engine.setMasterReverb({ room:rv.room, decay:rv.decay, damp:rv.damp });
    engine.revW.gain.value = (rv.mix/100)*2;
    prevRvRef.current = { ...rv };
  },[devices]);

  // Auth + songs
  useEffect(()=>{
    if(!token) return;
    authAPI.verify(token).then(()=>setAuthed(true)).catch(()=>{ localStorage.removeItem('lr_token'); setToken(''); });
  },[]);
  useEffect(()=>{ if(!authed||!token) return; songsAPI.list(token).then(d=>setSongs(d.songs||[])).catch(()=>{}); },[authed,token]);

  const doAuth = async()=>{
    setAuthBusy(true); setLoginErr('');
    try {
      const fn=loginMode==='login'?authAPI.login:authAPI.register;
      const { token:t }=await fn(loginU,loginP);
      localStorage.setItem('lr_token',t); setToken(t); setAuthed(true);
    } catch(e){ setLoginErr(e.message); } finally{ setAuthBusy(false); }
  };

  // ── Audio dispatch helpers ────────────────────────────────────────────────
  const playPolyVoice = useCallback((t,freq,d,dur)=>{
    if(!engine.ready) return;
    engine.playSynthVoice(t, freq, { wave:d.wave, atk:d.atk, rel:d.rel, flt:d.flt }, dur);
  },[]);

  const playStringVoice = useCallback((t,freq,d,dur)=>{
    engine.playString(t, freq, { detune:d.detune, spread:d.spread, atk:d.atk, rel:d.rel, flt:d.flt }, dur);
  },[]);

  const playAcidVoice = useCallback((t,freq,d,dur)=>{
    engine.playAcid(t, freq, { wave:d.wave, cut:d.cut, res:d.res, env:d.env, dec:d.dec, dist:d.dist }, dur);
  },[]);

  const playDeviceChord = useCallback((t, chord, device, dur)=>{
    if (!chord?.notes?.length) return;
    chord.notes.forEach(({note,oct})=>{
      const freq=noteFreq(note,oct);
      if (device.type==='poly')       playPolyVoice(t,freq,device,dur);
      else if (device.type==='str')   playStringVoice(t,freq,device,dur);
      else if (device.type==='acid')  playAcidVoice(t,freq,device,dur);
      else if (device.type==='rr'&&device.arp) engine.playRR(freq,t,dur,device);
    });
  },[playPolyVoice,playStringVoice,playAcidVoice]);

  const previewNote = useCallback((d,note,oct)=>{
    ea();
    const freq=noteFreq(note,oct);
    if (d.type==='poly') playPolyVoice(engine.ctx.currentTime,freq,d,0.25);
    if (d.type==='str')  playStringVoice(engine.ctx.currentTime,freq,d,0.5);
    if (d.type==='rr')   engine.playRR(freq,engine.ctx.currentTime,0.5,d);
    if (d.type==='acid') playAcidVoice(engine.ctx.currentTime,freq,d,0.2);
  },[ea,playPolyVoice,playStringVoice,playAcidVoice]);

  // ── Scheduler ─────────────────────────────────────────────────────────────
  const schedStep = useCallback((s,t)=>{
    const q   = seqRef.current;
    const dp  = drumPRef.current;
    const spb = (60/bpmRef.current)/spbRef.current;

    if(q.kick?.[s])  engine.playKick(t,  dp.kick);
    if(q.snare?.[s]) engine.playSnare(t, dp.snare);
    if(q.hh?.[s])    engine.playHH(t,    dp.hh);
    if(q.bass?.[s])  engine.playBass(t, 82+(s%8)*3, dp.bass);

    devicesRef.current.forEach(d=>{
      if(d.type==='rv') return;
      const raw=q[d.id]?.[s];
      if(!raw&&d.type!=='samp') return;
      const dur=spb*((raw?.len)||(raw?.notes?.[0]?1:1)||1);

      if(d.type==='samp'){ if(raw!=null){ const pad=d.pads[raw]; if(pad?.buf) engine.playPad(pad.buf,pad.vol,pad.pitch); } return; }

      const chord = raw?.notes ? raw : raw?.note ? { notes:[{note:raw.note,oct:raw.oct}], len:raw.len||1 } : null;
      if(chord) playDeviceChord(t,chord,d,dur);
    });
  },[playDeviceChord]);

  const startSeq=useCallback(()=>{
    ea(); stepRef.current=0; nextTRef.current=engine.ctx.currentTime+0.05;
    const tick=()=>{
      while(nextTRef.current<engine.ctx.currentTime+0.12){
        const s=stepRef.current;
        schedStep(s,nextTRef.current);
        const delay=Math.max(0,(nextTRef.current-engine.ctx.currentTime)*1000);
        setTimeout(()=>setStep(s),delay);
        nextTRef.current+=(60/bpmRef.current)/spbRef.current;
        stepRef.current=(stepRef.current+1)%seqLenRef.current;
      }
      schedRef.current=setTimeout(tick,20);
    };tick();
  },[ea,schedStep]);

  useEffect(()=>{
    if(playing) startSeq(); else{ clearTimeout(schedRef.current); setStep(-1); }
    return()=>clearTimeout(schedRef.current);
  },[playing,startSeq]);

  // ── Keyboard ──────────────────────────────────────────────────────────────
  useEffect(()=>{
    const onKey=e=>{
      if(e.target.tagName==='INPUT') return;
      if(e.key===' '){ e.preventDefault(); ea(); setPlaying(p=>!p); return; }
      const i=PAD_KEYS.indexOf(e.key.toUpperCase());
      if(i>=0){ const samp=devices.find(d=>d.type==='samp'); if(samp?.pads[i]?.buf){ ea(); engine.playPad(samp.pads[i].buf,samp.pads[i].vol,samp.pads[i].pitch); } }
    };
    window.addEventListener('keydown',onKey);
    return()=>window.removeEventListener('keydown',onKey);
  },[devices,ea]);

  // ── Drag-to-extend — ALL via window mouseup ref approach ──────────────────
  useEffect(()=>{
    const onUp=()=>{
      const ds=dragRef.current;
      if(!ds) return;
      if(!ds.hasDragged){
        // Pure click — toggle or open piano roll
        const isDrum=DRUM_IDS.includes(ds.trackId);
        const T=isDrum?{pitched:false}:DEVICE_TYPES[devices.find(d=>d.id===ds.trackId)?.type]||{};
        if(T.pitched&&T.pitched!=='pad'){
          setPianoRoll({ trackId:ds.trackId, highlightStep:ds.startSi });
        } else {
          toggleStep(ds.trackId,ds.startSi);
        }
      }
      dragRef.current=null;
    };
    window.addEventListener('mouseup',onUp);
    return()=>window.removeEventListener('mouseup',onUp);
  },[devices]); // eslint-disable-line

  // ── Device management ─────────────────────────────────────────────────────
  const updDev=(id,field,val)=>setDevices(prev=>prev.map(d=>d.id===id?{...d,[field]:val}:d));

  const addDevice=type=>{
    const id=`${type}-${Date.now()}`;
    setDevices(prev=>[...prev,{ id,type,...DEVICE_TYPES[type].def }]);
    if(type!=='rv') setSeq(prev=>({...prev,[id]:Array(seqLen).fill(null)}));
    setOpen(prev=>({...prev,[id]:true}));
  };

  const removeDevice=id=>{
    setDevices(prev=>prev.filter(d=>d.id!==id));
    setSeq(prev=>{ const n={...prev}; delete n[id]; return n; });
    const dev=devices.find(d=>d.id===id);
    if(dev?.type==='rv'&&engine.ready){ engine.setMasterReverb({ room:'hall',decay:2.5,damp:20 }); engine.revW.gain.value=fxRvW/50; }
  };

  const updateSeqLen=newLen=>{
    const len=Math.max(1,Math.min(128,newLen));
    setSeqLen(len);
    setSeq(prev=>{
      const next={};
      for(const k in prev){
        const fill=DRUM_IDS.includes(k)?false:null;
        next[k]=prev[k].length>=len?prev[k].slice(0,len):[...prev[k],...Array(len-prev[k].length).fill(fill)];
      }
      return next;
    });
  };

  // ── Sequencer step toggle ─────────────────────────────────────────────────
  const toggleStep=useCallback((trackId,si)=>{
    const isDrum=DRUM_IDS.includes(trackId);
    const T=isDrum?{pitched:false}:DEVICE_TYPES[devices.find(d=>d.id===trackId)?.type]||{};
    if(T.pitched&&T.pitched!=='pad'){ setPianoRoll({trackId,highlightStep:si}); return; }
    ea();
    setSeq(prev=>{
      const next={...prev,[trackId]:[...(prev[trackId]||[])]};
      if(T.pitched==='pad'){
        next[trackId][si]=prev[trackId][si]==null?0:prev[trackId][si]<7?prev[trackId][si]+1:null;
      } else {
        next[trackId][si]=!prev[trackId][si];
        if(next[trackId][si]){
          if(trackId==='kick')  engine.playKick(engine.ctx.currentTime,drumPRef.current.kick);
          if(trackId==='snare') engine.playSnare(engine.ctx.currentTime,drumPRef.current.snare);
          if(trackId==='hh')    engine.playHH(engine.ctx.currentTime,drumPRef.current.hh);
          if(trackId==='bass')  engine.playBass(engine.ctx.currentTime,82,drumPRef.current.bass);
        }
      }
      return next;
    });
  },[ea,devices]);

  // ── Piano roll update ─────────────────────────────────────────────────────
  const onPianoUpdate=useCallback((si,noteObj)=>{
    if(!pianoRoll) return;
    const {trackId}=pianoRoll;
    if(si==='clear'){ setSeq(prev=>({...prev,[trackId]:Array(seqLen).fill(null)})); return; }
    setSeq(prev=>{
      const next={...prev,[trackId]:[...prev[trackId]]};
      if(noteObj){
        const existing=next[trackId][si];
        if(existing?.len) noteObj={ ...noteObj, len:existing.len };
      }
      next[trackId][si]=noteObj;
      return next;
    });
  },[pianoRoll,seqLen]);

  // ── Mixer EQ helper ───────────────────────────────────────────────────────
  const updMxEQ=(chKey,field,val)=>{
    setMx(prev=>{
      const eq={ ...prev[chKey].eq, [field]:val };
      engine.applyEQ(chKey,eq);
      return { ...prev,[chKey]:{ ...prev[chKey],eq } };
    });
  };

  // ── Pad loader ────────────────────────────────────────────────────────────
  const loadPad=async(deviceId,padIdx,file)=>{
    ea(); const buf=await engine.ctx.decodeAudioData(await file.arrayBuffer());
    setDevices(prev=>prev.map(d=>{ if(d.id!==deviceId) return d; const np=[...d.pads]; np[padIdx]={...np[padIdx],buf,name:file.name.replace(/\.[^.]+$/,'').slice(0,14)}; return{...d,pads:np}; }));
  };

  // ── Song save/load ────────────────────────────────────────────────────────
  const captureState=(safeDevices)=>({
    bpm,seqLen,stepsPerBeat,seq,mx,drumParams,
    fx:{dist:fxDist,dlyT:fxDlyT,dlyFb:fxDlyFb,dlyW:fxDlyW,rvW:fxRvW},
    devices:(safeDevices||devices).map(d=>d.type!=='samp'?d:{ ...d,pads:d.pads.map(p=>({name:p.name,vol:p.vol,pitch:p.pitch,cloudUrl:p.cloudUrl})) }),
  });

  const applyState=async(raw)=>{
    let s=raw;
    if(typeof s==='string'){ try{s=JSON.parse(s);}catch{throw new Error('State is not valid JSON');} }
    if(!s||typeof s!=='object') throw new Error('State is empty');
    if(s.bpm)          setBpmS(s.bpm);
    if(s.seqLen)       setSeqLen(s.seqLen);
    if(s.stepsPerBeat) setStepsPerBeat(s.stepsPerBeat);
    if(s.mx)           setMx(prev=>{ const next=mkMix(); MIX_KEYS.forEach(k=>{ if(s.mx[k]) next[k]={...next[k],...s.mx[k],eq:{...next[k].eq,...(s.mx[k].eq||{})}}; }); if(s.mx.master) next.master={...s.mx.master}; return next; });
    if(s.drumParams)   setDrumParams(prev=>({ ...mkDrumParams(),...s.drumParams }));
    if(s.fx){ setFxDist(s.fx.dist??0); setFxDlyT(s.fx.dlyT??30); setFxDlyFb(s.fx.dlyFb??25); setFxDlyW(s.fx.dlyW??0); setFxRvW(s.fx.rvW??0); }
    ea();
    let devs=s.devices;
    let loadSeq=s.seq||{};
    if(!devs){
      devs=[];
      if(s.synth) devs.push({ id:'poly-1',type:'poly',...DEVICE_TYPES.poly.def,...s.synth });
      if(s.rr)    devs.push({ id:'rr-1',type:'rr',...DEVICE_TYPES.rr.def,...s.rr });
      if(s.pads)  devs.push({ id:'samp-1',type:'samp',pads:s.pads });
      if(loadSeq.synth){ loadSeq['poly-1']=loadSeq.synth; delete loadSeq.synth; }
      if(loadSeq.rr)   { loadSeq['rr-1']=loadSeq.rr;    delete loadSeq.rr; }
      if(loadSeq.samp) { loadSeq['samp-1']=loadSeq.samp; delete loadSeq.samp; }
    }
    const hydrated=await Promise.all((devs||[]).map(async d=>{
      if(d.type!=='samp') return d;
      const pads=d.pads||Array(8).fill(null).map((_,i)=>({ name:`PAD ${i+1}`,buf:null,vol:100,pitch:0,cloudUrl:null }));
      const np=await Promise.all(pads.map(async p=>{ if(!p.cloudUrl) return{...p,buf:null}; try{ return{...p,buf:await cloudinary.fetchPad(engine.ctx,p.cloudUrl)};}catch{return{...p,buf:null};} }));
      return{...d,pads:np};
    }));
    setDevices(hydrated); setSeq(loadSeq);
  };

  const saveSong=async()=>{
    if(!token||!songName.trim()) return; setSongBusy(true); setSongMsg('');
    try{
      const safeDevices=await Promise.all(devices.map(async d=>{ if(d.type!=='samp') return d; const np=await Promise.all(d.pads.map(async(p,i)=>{ if(!p.buf||p.cloudUrl) return p; const{url}=await cloudinary.uploadPad(token,p.buf,p.name||`pad-${i}`); return{...p,cloudUrl:url}; })); return{...d,pads:np}; }));
      setDevices(safeDevices);
      const state=captureState(safeDevices);
      const result=activeSong?await songsAPI.update(token,activeSong.id,songName,state):await songsAPI.save(token,songName,state);
      const saved={...result.song,state:result.song.state||state};
      setActiveSong(saved); setSongs(prev=>{ const idx=prev.findIndex(s=>s.id===saved.id); return idx>=0?prev.map((s,i)=>i===idx?saved:s):[...prev,saved]; });
      setSongMsg('✓ Saved');
    }catch(e){ setSongMsg('Save error: '+e.message); }
    finally{ setSongBusy(false); setTimeout(()=>setSongMsg(''),3500); }
  };

  const loadSong=async(song)=>{
    setSongBusy(true); setSongMsg('');
    try{
      let st=song.state;
      if(typeof st==='string'){ try{st=JSON.parse(st);}catch{} }
      if(!st||typeof st!=='object'||!Object.keys(st).length){
        setSongMsg('Fetching…');
        const full=await songsAPI.get(token,song.id);
        st=full.song?.state??full.state;
        if(typeof st==='string'){ try{st=JSON.parse(st);}catch{} }
      }
      if(!st||typeof st!=='object') throw new Error('Song data unavailable — please re-save this song once.');
      await applyState(st);
      setActiveSong({...song,state:st}); setSongName(song.name||'Loaded Song'); setShowSongs(false); setSongMsg('✓ Loaded');
    }catch(e){ setSongMsg('Load error: '+e.message); }
    finally{ setSongBusy(false); setTimeout(()=>setSongMsg(''),4000); }
  };

  const deleteSong=async id=>{
    try{ await songsAPI.delete(token,id); setSongs(prev=>prev.filter(s=>s.id!==id)); if(activeSong?.id===id) setActiveSong(null); }
    catch(e){ setSongMsg('Delete error: '+e.message); }
  };

  const newSong=()=>{
    if(!window.confirm('Start a new song? Unsaved changes will be lost.')) return;
    setBpmS(120); setSeqLen(16); setStepsPerBeat(4);
    const devs=DEFAULT_DEVICES(); setDevices(devs);
    setSeq(mkSeq(devs.map(d=>d.id))); setMx(mkMix()); setDrumParams(mkDrumParams());
    setFxDist(0);setFxDlyT(30);setFxDlyFb(25);setFxDlyW(0);setFxRvW(0);
    setActiveSong(null); setSongName('New Song');
  };

  // ─── LOGIN SCREEN ──────────────────────────────────────────────────────────
  if(!authed) return (
    <div style={{ minHeight:'100vh',background:L.bg,display:'flex',alignItems:'center',justifyContent:'center',fontFamily:mono }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&display=swap');*{box-sizing:border-box;margin:0;padding:0}input{outline:none;font-family:inherit}`}</style>
      <div style={{ width:360,background:L.panel,borderRadius:12,boxShadow:'0 8px 48px rgba(0,0,0,0.12)',overflow:'hidden' }}>
        <div style={{ height:6,background:'linear-gradient(to right,#c4400f,#1566a8,#1a7a3a,#7030a0)' }}/>
        <div style={{ padding:'36px 40px' }}>
          <div style={{ fontSize:10,color:L.muted,letterSpacing:3,marginBottom:8 }}>◆ LIVE RIG</div>
          <div style={{ fontSize:24,fontWeight:700,letterSpacing:1,color:L.text,marginBottom:4 }}>{loginMode==='login'?'Sign In':'Create Account'}</div>
          <div style={{ fontSize:11,color:L.dim,marginBottom:28 }}>Neon auth · Cloudinary samples</div>
          {[['text',loginU,setLoginU,'Username'],['password',loginP,setLoginP,'Password']].map(([t,v,s,ph])=>(
            <input key={ph} type={t} placeholder={ph} value={v} onChange={e=>s(e.target.value)} onKeyDown={e=>e.key==='Enter'&&doAuth()}
              style={{ display:'block',width:'100%',padding:'11px 14px',marginBottom:12,border:`1.5px solid ${L.border}`,borderRadius:8,fontSize:13,color:L.text,background:L.panelB }}/>
          ))}
          {loginErr&&<div style={{ fontSize:11,color:'#c4400f',marginBottom:12,padding:'8px 12px',background:'#fef2ee',borderRadius:6 }}>{loginErr}</div>}
          <button onClick={doAuth} disabled={authBusy} style={{ width:'100%',padding:'13px',fontSize:13,fontWeight:700,letterSpacing:2,background:'#1a1716',color:'#fff',border:'none',borderRadius:8,cursor:'pointer',fontFamily:mono,opacity:authBusy?0.6:1 }}>{authBusy?'…':loginMode==='login'?'SIGN IN':'CREATE ACCOUNT'}</button>
          <div style={{ textAlign:'center',marginTop:20,fontSize:11,color:L.muted }}>
            <span onClick={()=>{setLoginMode(m=>m==='login'?'register':'login');setLoginErr('');}} style={{ color:'#1566a8',cursor:'pointer',fontWeight:700 }}>{loginMode==='login'?'Create an account':'Sign in instead'}</span>
          </div>
        </div>
      </div>
    </div>
  );

  // ─── BUILD SEQ TRACK LIST ──────────────────────────────────────────────────
  const seqTracks=[
    ...DRUM_IDS.map((id,i)=>({ id,name:DRUM_NAMES[i],col:DRUM_COLS[i],pitched:false,isDrum:true })),
    ...devices.filter(d=>d.type!=='rv').map(d=>({ id:d.id,name:DEVICE_TYPES[d.type].name,col:DEVICE_TYPES[d.type].col,pitched:DEVICE_TYPES[d.type].pitched,isDrum:false })),
  ];

  // ─── MAIN APP ──────────────────────────────────────────────────────────────
  return (
    <div style={{ height:'100vh',display:'flex',flexDirection:'column',background:L.bg,fontFamily:mono,color:L.text,overflow:'hidden' }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&display=swap');
        *{box-sizing:border-box;margin:0;padding:0}
        input[type=range]{-webkit-appearance:none;height:3px;border-radius:2px;outline:none}
        input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:13px;height:13px;border-radius:50%;cursor:pointer;background:#1a1716;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,0.18)}
        ::-webkit-scrollbar{width:5px;height:5px}::-webkit-scrollbar-track{background:#f0ede8}::-webkit-scrollbar-thumb{background:#d0cdc8;border-radius:4px}
        button:hover{filter:brightness(0.92)}button{transition:filter 0.1s}input{outline:none;font-family:inherit}
        .seq-scroll::-webkit-scrollbar{display:none}
      `}</style>

      {/* ── TRANSPORT ── */}
      <div style={{ height:52,flexShrink:0,background:L.panel,borderBottom:`1.5px solid ${L.border}`,display:'flex',alignItems:'center',gap:12,padding:'0 14px',boxShadow:'0 1px 0 rgba(0,0,0,0.04)' }}>
        <div style={{ fontSize:11,fontWeight:700,letterSpacing:3,color:L.text,paddingRight:12,borderRight:`1.5px solid ${L.border}`,flexShrink:0 }}>◆ LIVE RIG</div>
        <button onClick={()=>{ea();setPlaying(p=>!p);}} style={{ fontFamily:mono,fontSize:11,letterSpacing:2,padding:'7px 16px',border:'none',borderRadius:6,cursor:'pointer',fontWeight:700,flexShrink:0,background:playing?'#c4400f':'#1a7a3a',color:'#fff' }}>{playing?'■ STOP':'▶ PLAY'}</button>
        <div style={{ display:'flex',alignItems:'center',gap:7,flexShrink:0 }}>
          <div><div style={{ fontSize:7,color:L.muted,letterSpacing:1.5 }}>BPM</div><div style={{ fontSize:21,fontWeight:700,color:L.accent,letterSpacing:1,lineHeight:1 }}>{bpm}</div></div>
          <div style={{ display:'flex',flexDirection:'column',gap:1 }}>{[[1,'▲'],[-1,'▼']].map(([d,l])=>(
            <button key={l} onClick={()=>setBpmS(b=>Math.max(60,Math.min(200,b+d)))} style={{ width:14,height:12,background:L.panelB,border:`1px solid ${L.border}`,fontSize:8,cursor:'pointer',borderRadius:2,fontFamily:mono,color:L.muted,padding:0,lineHeight:1 }}>{l}</button>
          ))}</div>
          <input type="range" min={60} max={200} value={bpm} onChange={e=>setBpmS(+e.target.value)} style={{ width:88 }}/>
        </div>
        <div style={{ padding:'3px 10px',background:L.panelB,border:`1px solid ${L.border}`,borderRadius:6,fontSize:11,fontWeight:700,color:playing?'#1a7a3a':L.dim,letterSpacing:2,minWidth:76,textAlign:'center',flexShrink:0 }}>
          {playing?`${String(step+1).padStart(2,'0')} / ${seqLen}`:`— / ${seqLen}`}
        </div>
        <div style={{ display:'flex',alignItems:'center',gap:8,flex:1,maxWidth:380 }}>
          <input value={songName} onChange={e=>setSongName(e.target.value)} style={{ flex:1,padding:'6px 10px',border:`1.5px solid ${L.border}`,borderRadius:6,fontSize:12,background:L.panelB,color:L.text }}/>
          <button onClick={saveSong} disabled={songBusy} style={{ fontFamily:mono,fontSize:10,letterSpacing:1,padding:'7px 14px',border:'none',background:'#1566a8',color:'#fff',borderRadius:6,cursor:'pointer',fontWeight:700,flexShrink:0,opacity:songBusy?0.6:1 }}>{songBusy?'…':activeSong?'UPDATE':'SAVE'}</button>
          {songMsg&&<span style={{ fontSize:10,color:songMsg.startsWith('✓')?'#1a7a3a':'#c4400f',flexShrink:0 }}>{songMsg}</span>}
        </div>
        <button onClick={()=>setShowSongs(s=>!s)} style={{ fontFamily:mono,fontSize:10,letterSpacing:1,padding:'7px 12px',border:`1.5px solid ${L.border}`,background:showSongs?L.text:L.panel,color:showSongs?'#fff':L.muted,borderRadius:6,cursor:'pointer',flexShrink:0 }}>SONGS{songs.length>0?` (${songs.length})`:''}</button>
        <button onClick={newSong} style={{ fontFamily:mono,fontSize:10,padding:'7px 10px',border:`1.5px solid ${L.border}`,background:'transparent',color:L.muted,borderRadius:6,cursor:'pointer',flexShrink:0 }}>NEW</button>
        <button onClick={()=>{localStorage.removeItem('lr_token');setAuthed(false);setToken('');}} style={{ fontFamily:mono,fontSize:9,padding:'5px 9px',border:`1px solid ${L.border}`,background:'transparent',color:L.dim,borderRadius:5,cursor:'pointer',flexShrink:0 }}>OUT</button>
      </div>

      {/* Songs panel */}
      {showSongs&&(
        <div style={{ background:L.panel,borderBottom:`1.5px solid ${L.border}`,padding:'12px 14px',zIndex:100,flexShrink:0,maxHeight:200,overflowY:'auto' }}>
          {!songs.length?<div style={{ fontSize:12,color:L.muted,textAlign:'center',padding:'12px' }}>No songs yet.</div>:songs.map(s=>(
            <div key={s.id} style={{ display:'flex',alignItems:'center',padding:'7px 12px',borderRadius:6,marginBottom:4,border:`1px solid ${activeSong?.id===s.id?'#1566a8':L.border}`,background:activeSong?.id===s.id?'#edf4ff':L.panelB }}>
              <div><div style={{ fontSize:12,fontWeight:700,color:L.text }}>{s.name}</div><div style={{ fontSize:10,color:L.muted }}>{new Date(s.updated_at||s.created_at).toLocaleDateString()}</div></div>
              <div style={{ marginLeft:'auto',display:'flex',gap:6 }}>
                <button onClick={()=>loadSong(s)} disabled={songBusy} style={{ fontFamily:mono,fontSize:10,padding:'5px 12px',background:'#1566a8',color:'#fff',border:'none',borderRadius:5,cursor:'pointer',fontWeight:700 }}>LOAD</button>
                <button onClick={()=>deleteSong(s.id)} style={{ fontFamily:mono,fontSize:10,padding:'5px 10px',background:'transparent',color:'#c4400f',border:`1px solid #c4400f`,borderRadius:5,cursor:'pointer' }}>✕</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add device bar */}
      <div style={{ height:38,flexShrink:0,background:L.panelB,borderBottom:`1px solid ${L.border}`,display:'flex',alignItems:'center',justifyContent:'center',gap:7 }}>
        <span style={{ fontSize:9,color:L.muted,letterSpacing:2,fontWeight:700,marginRight:4 }}>+ DEVICE:</span>
        {[['poly','#1566a8','Poly'],['str','#7030a0','Strings'],['rr','#8a6500','Road Rash'],['acid','#5a8800','Acid'],['samp','#1a7a3a','Sampler'],['rv','#1a6080','Reverb']].map(([type,col,label])=>(
          <Pill key={type} label={`+ ${label}`} active={false} col={col} onClick={()=>addDevice(type)} tiny/>
        ))}
      </div>

      {/* ── RACK ── */}
      <div style={{ flex:1,overflowY:'auto',padding:'6px 8px',display:'flex',flexDirection:'column' }}>

        {/* MIXER with 3-band EQ */}
        <RackUnit>
          <DevHeader label="14:2 Mixer" subtitle="Vol · Pan · 3-Band EQ" col="#5050a0" open={open.mix} onToggle={()=>setOpen(o=>({...o,mix:!o.mix}))}/>
          {open.mix&&(
            <div style={{ display:'flex',overflowX:'auto',padding:'8px 12px',background:L.panelB,borderLeft:'4px solid #5050a0' }}>
              {MIX_CH.map(({key,name,col})=>{
                const m=key==='master'?mx.master:mx[key];
                const eq=mx[key]?.eq;
                const isMaster=key==='master';
                return (
                  <div key={key} style={{ display:'flex',flexDirection:'column',alignItems:'center',gap:4,padding:'6px 12px',borderRight:`1px solid ${L.border}`,minWidth:90,...(isMaster?{borderLeft:`2px solid ${L.borderHi}`,marginLeft:6}:{}) }}>
                    <div style={{ fontSize:9,fontWeight:700,color:col,letterSpacing:1,whiteSpace:'nowrap' }}>{name}</div>
                    {!isMaster&&(
                      <div style={{ display:'flex',gap:3 }}>
                        <Pill tiny label="S" active={m.solo} col={col} onClick={()=>setMx(p=>({...p,[key]:{...p[key],solo:!m.solo}}))}/>
                        <Pill tiny label="M" active={m.mute} col="#c4400f" onClick={()=>setMx(p=>({...p,[key]:{...p[key],mute:!m.mute}}))}/>
                      </div>
                    )}
                    {/* Fader */}
                    <div style={{ height:80,width:28,display:'flex',alignItems:'center',justifyContent:'center',overflow:'hidden' }}>
                      <input type="range" min={0} max={100} value={m.vol} onChange={e=>setMx(p=>({...p,[key]:{...p[key],vol:+e.target.value}}))} style={{ width:80,transform:'rotate(-90deg)',transformOrigin:'center',cursor:'pointer',margin:0 }}/>
                    </div>
                    <div style={{ fontSize:10,fontWeight:700,color:col,fontFamily:mono }}>{m.vol}%</div>
                    {/* Pan */}
                    <div style={{ fontSize:7,color:L.muted }}>PAN</div>
                    <input type="range" min={-100} max={100} value={m.pan} onChange={e=>setMx(p=>({...p,[key]:{...p[key],pan:+e.target.value}}))} style={{ width:60 }}/>
                    <div style={{ fontSize:8,color:L.muted,fontFamily:mono }}>{m.pan===0?'C':m.pan>0?`R${m.pan}`:`L${Math.abs(m.pan)}`}</div>
                    {/* 3-band EQ */}
                    {!isMaster&&eq&&(
                      <>
                        <div style={{ width:'100%',height:1,background:L.border,margin:'3px 0' }}/>
                        <div style={{ fontSize:7,color:L.dim,letterSpacing:1 }}>EQ</div>
                        <div style={{ display:'flex',gap:6 }}>
                          <EQKnob val={eq.lo}  col={col} label="LO"  onVal={v=>updMxEQ(key,'lo',v)}/>
                          <EQKnob val={eq.mid} col={col} label="MID" onVal={v=>updMxEQ(key,'mid',v)}/>
                          <EQKnob val={eq.hi}  col={col} label="HI"  onVal={v=>updMxEQ(key,'hi',v)}/>
                        </div>
                        <div style={{ fontSize:7,color:L.dim }}>MID Hz</div>
                        <input type="range" min={200} max={5000} value={eq.midFreq||1000} onChange={e=>updMxEQ(key,'midFreq',+e.target.value)} style={{ width:62 }}/>
                        <div style={{ fontSize:7,color:L.muted,fontFamily:mono }}>{eq.midFreq>=1000?(eq.midFreq/1000).toFixed(1)+'k':eq.midFreq+'Hz'}</div>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </RackUnit>

        {/* DRUM MACHINE with per-track mods */}
        <RackUnit>
          <DevHeader label="Drum Machine" subtitle={`${seqLen}-step · Per-hit Vel/Tune/Decay/Pan`} col="#c4400f" open={open.drum} onToggle={()=>setOpen(o=>({...o,drum:!o.drum}))}/>
          {open.drum&&(
            <div style={{ display:'flex',flexDirection:'column',padding:'8px 12px',borderLeft:'4px solid #c4400f',background:L.panelB,gap:0,overflowX:'auto' }}>
              {DRUM_IDS.map((id,ti)=>{
                const p=drumParams[id]; const col=DRUM_COLS[ti];
                return (
                  <div key={id} style={{ display:'flex',alignItems:'center',gap:6,borderBottom:`1px solid ${L.border}`,padding:'5px 0' }}>
                    {/* Label */}
                    <div style={{ width:40,fontSize:8,color:col,letterSpacing:1,textAlign:'right',flexShrink:0,fontWeight:700 }}>{DRUM_NAMES[ti]}</div>
                    {/* Step grid */}
                    <div style={{ display:'flex',gap:2,flexShrink:0 }}>
                      {Array(seqLen).fill(0).map((_,si)=>(
                        <div key={si} style={{ display:'flex',alignItems:'center',gap:2 }}>
                          {si>0&&si%stepsPerBeat===0&&<div style={{ width:1,height:20,background:L.borderHi }}/>}
                          <div onClick={()=>toggleStep(id,si)} style={{
                            width:20,height:20,borderRadius:4,cursor:'pointer',flexShrink:0,
                            background:seq[id]?.[si]?col:'#f0ede8',
                            border:`1.5px solid ${seq[id]?.[si]?col:L.border}`,
                            outline:si===step?`2px solid ${col}80`:'none',outlineOffset:1,
                            boxShadow:seq[id]?.[si]?`0 1px 4px ${col}50`:'none',transition:'all 0.06s',
                          }}/>
                        </div>
                      ))}
                    </div>
                    {/* Per-hit knobs */}
                    <div style={{ display:'flex',gap:8,paddingLeft:10,borderLeft:`1px solid ${L.border}`,flexShrink:0 }}>
                      <Knob val={p.vel}   min={0}   max={100}  col={col}    label="VEL"   fmt={v=>v+'%'}    size={20} onVal={v=>setDrumParams(prev=>({...prev,[id]:{...prev[id],vel:v}}))}/>
                      <Knob val={p.tune}  min={-24} max={24}   col={col}    label="TUNE"  fmt={v=>v+'st'}   size={20} onVal={v=>setDrumParams(prev=>({...prev,[id]:{...prev[id],tune:v}}))}/>
                      <Knob val={p.decay} min={0.2} max={3.0} step={0.05} col={col} label="DECAY" fmt={v=>v.toFixed(2)+'x'} size={20} onVal={v=>setDrumParams(prev=>({...prev,[id]:{...prev[id],decay:v}}))}/>
                      <Knob val={p.pan}   min={-100} max={100} col={col}   label="PAN"   fmt={v=>v===0?'C':v>0?`R${v}`:`L${Math.abs(v)}`} size={20} onVal={v=>setDrumParams(prev=>({...prev,[id]:{...prev[id],pan:v}}))}/>
                    </div>
                    {/* Quick preview */}
                    <button onClick={()=>{ea();if(id==='kick')engine.playKick(engine.ctx.currentTime,p);if(id==='snare')engine.playSnare(engine.ctx.currentTime,p);if(id==='hh')engine.playHH(engine.ctx.currentTime,p);if(id==='bass')engine.playBass(engine.ctx.currentTime,82,p);}}
                      style={{ fontFamily:mono,fontSize:8,padding:'2px 8px',background:'transparent',border:`1px solid ${col}`,borderRadius:4,cursor:'pointer',color:col,flexShrink:0 }}>▶</button>
                  </div>
                );
              })}
            </div>
          )}
        </RackUnit>

        {/* DYNAMIC DEVICES */}
        {devices.map(d=>{
          const T=DEVICE_TYPES[d.type];
          const isOpen=open[d.id]??true;
          return (
            <RackUnit key={d.id}>
              <DevHeader label={T.name} subtitle={`id: ${d.id}`} col={T.col} open={isOpen} onToggle={()=>setOpen(o=>({...o,[d.id]:!isOpen}))} onRemove={()=>removeDevice(d.id)}/>
              {isOpen&&(
                <div style={{ display:'flex',alignItems:'center',padding:'10px 12px',gap:12,borderLeft:`4px solid ${T.col}`,background:L.panelB,flexWrap:'wrap' }}>

                  {d.type==='poly'&&<>
                    <div style={{ display:'flex',flexDirection:'column',gap:5 }}>
                      <div style={{ fontSize:8,color:L.muted,letterSpacing:1.5 }}>WAVEFORM</div>
                      <div style={{ display:'flex',gap:3 }}>{['sawtooth','square','sine','triangle'].map(w=><Pill key={w} tiny label={w.slice(0,3).toUpperCase()} active={d.wave===w} col={T.col} onClick={()=>updDev(d.id,'wave',w)}/>)}</div>
                      <div style={{ fontSize:8,color:L.muted,letterSpacing:1.5,marginTop:3 }}>OCTAVE</div>
                      <div style={{ display:'flex',gap:3 }}>{[2,3,4,5,6].map(o=><Pill key={o} tiny label={String(o)} active={d.oct===o} col={T.col} onClick={()=>updDev(d.id,'oct',o)}/>)}</div>
                    </div>
                    <Knob val={d.atk} min={1} max={2000} col={T.col} label="ATK" fmt={v=>v+'ms'} onVal={v=>updDev(d.id,'atk',v)}/>
                    <Knob val={d.rel} min={50} max={4000} col={T.col} label="REL" fmt={v=>v+'ms'} onVal={v=>updDev(d.id,'rel',v)} size={28}/>
                    <Knob val={d.flt} min={100} max={8000} col={T.col} label="FILT" fmt={v=>v>999?Math.round(v/100)/10+'k':v+'Hz'} onVal={v=>updDev(d.id,'flt',v)} size={28}/>
                    <div>
                      <div style={{ fontSize:8,color:L.muted,letterSpacing:1.5,marginBottom:5 }}>NOTE — preview</div>
                      <div style={{ display:'flex',gap:3,flexWrap:'wrap',maxWidth:200 }}>{NOTES.map(n=><Pill key={n} tiny label={n} active={d.note===n} col={T.col} onClick={()=>{ updDev(d.id,'note',n); previewNote({...d,note:n},n,d.oct); }}/>)}</div>
                    </div>
                    <div style={{ fontFamily:mono,fontSize:13,fontWeight:700,color:T.col,background:T.col+'12',border:`1px solid ${T.col}40`,padding:'5px 12px',borderRadius:8 }}>{d.note}{d.oct} · {Math.round(noteFreq(d.note,d.oct))}Hz</div>
                  </>}

                  {d.type==='str'&&<>
                    <div style={{ display:'flex',flexDirection:'column',gap:5 }}>
                      <div style={{ fontSize:8,color:L.muted,letterSpacing:1.5 }}>OCTAVE</div>
                      <div style={{ display:'flex',gap:3 }}>{[1,2,3,4,5].map(o=><Pill key={o} tiny label={String(o)} active={d.oct===o} col={T.col} onClick={()=>updDev(d.id,'oct',o)}/>)}</div>
                      <div style={{ fontSize:8,color:L.muted,letterSpacing:1.5,marginTop:3 }}>NOTE — preview</div>
                      <div style={{ display:'flex',gap:3,flexWrap:'wrap',maxWidth:200 }}>{NOTES.map(n=><Pill key={n} tiny label={n} active={d.note===n} col={T.col} onClick={()=>{ updDev(d.id,'note',n); previewNote({...d,note:n},n,d.oct); }}/>)}</div>
                    </div>
                    <Knob val={d.detune} min={0} max={24} col={T.col} label="DETUNE" fmt={v=>v+'st'} onVal={v=>updDev(d.id,'detune',v)}/>
                    <Knob val={d.spread} min={0} max={10} step={0.5} col={T.col} label="SPREAD" fmt={v=>v.toFixed(1)} onVal={v=>updDev(d.id,'spread',v)}/>
                    <Knob val={d.atk} min={50} max={3000} col={T.col} label="ATK" fmt={v=>v+'ms'} onVal={v=>updDev(d.id,'atk',v)} size={28}/>
                    <Knob val={d.rel} min={100} max={5000} col={T.col} label="REL" fmt={v=>v+'ms'} onVal={v=>updDev(d.id,'rel',v)} size={28}/>
                    <Knob val={d.flt} min={200} max={8000} col={T.col} label="FILT" fmt={v=>v>999?Math.round(v/100)/10+'k':v+'Hz'} onVal={v=>updDev(d.id,'flt',v)}/>
                    <div style={{ fontFamily:mono,fontSize:13,fontWeight:700,color:T.col,background:T.col+'12',border:`1px solid ${T.col}40`,padding:'5px 12px',borderRadius:8 }}>{d.note}{d.oct} · {Math.round(noteFreq(d.note,d.oct))}Hz</div>
                  </>}

                  {d.type==='rr'&&<>
                    <Knob val={d.mr} min={0.1} max={4} step={0.1} col={T.col} label="MOD R" fmt={v=>v.toFixed(1)} onVal={v=>updDev(d.id,'mr',v)}/>
                    <Knob val={d.mi} min={0} max={8} step={0.1} col={T.col} label="MOD I" fmt={v=>v.toFixed(1)} onVal={v=>updDev(d.id,'mi',v)}/>
                    <Knob val={d.det} min={0} max={50} col={T.col} label="DET" fmt={v=>v+'ct'} onVal={v=>updDev(d.id,'det',v)}/>
                    <Knob val={d.flt} min={200} max={6000} step={10} col={T.col} label="FILT" fmt={v=>v+'Hz'} onVal={v=>updDev(d.id,'flt',v)} size={28}/>
                    <Knob val={d.atk} min={1} max={200} col="#c08020" label="ATK" fmt={v=>v+'ms'} onVal={v=>updDev(d.id,'atk',v)}/>
                    <Knob val={d.rel} min={20} max={800} col="#c08020" label="REL" fmt={v=>v+'ms'} onVal={v=>updDev(d.id,'rel',v)}/>
                    <Knob val={d.drv} min={0} max={100} col="#c06010" label="DRIVE" fmt={v=>v+'%'} onVal={v=>updDev(d.id,'drv',v)} size={28}/>
                    <div style={{ display:'flex',flexDirection:'column',gap:5,paddingLeft:10,borderLeft:`1px solid ${L.border}` }}>
                      <Pill tiny label={d.arp?'ARP ON':'ARP OFF'} active={d.arp} col={T.col} onClick={()=>updDev(d.id,'arp',!d.arp)}/>
                      <Pill tiny label="▶ TEST" active={false} col={T.col} onClick={()=>{ ea(); engine.playRR(noteFreq('E',2),engine.ctx.currentTime,0.5,d); }}/>
                    </div>
                    <div style={{ fontFamily:mono,fontSize:11,fontWeight:700,color:T.col,background:T.col+'12',border:`1px solid ${T.col}40`,padding:'5px 12px',borderRadius:8 }}>{`FM R=${d.mr.toFixed(1)} I=${d.mi.toFixed(1)} DRV=${d.drv}%`}</div>
                  </>}

                  {d.type==='acid'&&<>
                    <div style={{ display:'flex',flexDirection:'column',gap:5 }}>
                      <div style={{ fontSize:8,color:L.muted,letterSpacing:1.5 }}>WAVE</div>
                      <div style={{ display:'flex',gap:3 }}>{['sawtooth','square'].map(w=><Pill key={w} tiny label={w.slice(0,3).toUpperCase()} active={d.wave===w} col={T.col} onClick={()=>updDev(d.id,'wave',w)}/>)}</div>
                      <div style={{ fontSize:8,color:L.muted,letterSpacing:1.5,marginTop:3 }}>OCTAVE</div>
                      <div style={{ display:'flex',gap:3 }}>{[1,2,3].map(o=><Pill key={o} tiny label={String(o)} active={d.oct===o} col={T.col} onClick={()=>updDev(d.id,'oct',o)}/>)}</div>
                      <div style={{ fontSize:8,color:L.muted,letterSpacing:1.5,marginTop:3 }}>NOTE</div>
                      <div style={{ display:'flex',gap:3,flexWrap:'wrap',maxWidth:180 }}>{NOTES.map(n=><Pill key={n} tiny label={n} active={d.note===n} col={T.col} onClick={()=>{ updDev(d.id,'note',n); ea(); engine.playAcid(engine.ctx.currentTime,noteFreq(n,d.oct),{...d,note:n},0.2); }}/>)}</div>
                    </div>
                    <Knob val={d.cut} min={50} max={2000} col={T.col} label="CUT" fmt={v=>v+'Hz'} onVal={v=>updDev(d.id,'cut',v)} size={28}/>
                    <Knob val={d.res} min={0} max={100} col={T.col} label="RES" fmt={v=>v+'%'} onVal={v=>updDev(d.id,'res',v)} size={28}/>
                    <Knob val={d.env} min={0} max={5000} col={T.col} label="ENV" fmt={v=>v+'Hz'} onVal={v=>updDev(d.id,'env',v)}/>
                    <Knob val={d.dec} min={50} max={1000} col={T.col} label="DEC" fmt={v=>v+'ms'} onVal={v=>updDev(d.id,'dec',v)}/>
                    <Knob val={d.dist} min={0} max={100} col="#c4400f" label="DIST" fmt={v=>v+'%'} onVal={v=>updDev(d.id,'dist',v)}/>
                    <Pill tiny label="▶ TEST" active={false} col={T.col} onClick={()=>{ ea(); engine.playAcid(engine.ctx.currentTime,noteFreq(d.note||'A',d.oct||1),d,0.3); }}/>
                  </>}

                  {d.type==='samp'&&(
                    <div style={{ display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:5,flex:1,maxWidth:460 }}>
                      {d.pads.map((pad,i)=>(
                        <div key={i} style={{ display:'flex',flexDirection:'column',gap:3 }}>
                          <div onClick={()=>{ if(pad.buf){ea();engine.playPad(pad.buf,pad.vol,pad.pitch);}else document.getElementById(`pi-${d.id}-${i}`).click(); }}
                            style={{ border:`1.5px solid ${pad.buf?T.col:L.border}`,borderRadius:6,background:pad.buf?T.col+'10':L.panelB,cursor:'pointer',height:54,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:3,transition:'all 0.1s' }}>
                            <div style={{ fontSize:9,color:pad.buf?T.col:L.dim,letterSpacing:1,fontWeight:700 }}>{PAD_KEYS[i]}</div>
                            {pad.buf?<div style={{ fontSize:8,color:T.col,fontWeight:700,textAlign:'center',padding:'0 4px',overflow:'hidden',textOverflow:'ellipsis',maxWidth:82,whiteSpace:'nowrap' }}>{pad.name}</div>:<div style={{ fontSize:9,color:L.dim }}>EMPTY</div>}
                            {pad.cloudUrl&&<div style={{ fontSize:7,color:T.col+'80' }}>☁</div>}
                          </div>
                          {pad.buf&&(
                            <div style={{ display:'flex',gap:3 }}>
                              <button onClick={()=>document.getElementById(`pi-${d.id}-${i}`).click()} style={{ flex:1,fontSize:8,padding:'2px 0',background:'transparent',border:`1px solid ${L.border}`,borderRadius:4,cursor:'pointer',color:L.muted,fontFamily:mono }}>LOAD</button>
                              <button onClick={()=>{ const np=[...d.pads]; np[i]={name:`PAD ${i+1}`,buf:null,vol:100,pitch:0,cloudUrl:null}; updDev(d.id,'pads',np); }} style={{ fontSize:8,padding:'2px 6px',background:'transparent',border:`1px solid #c4400f`,borderRadius:4,cursor:'pointer',color:'#c4400f',fontFamily:mono }}>✕</button>
                            </div>
                          )}
                          <input id={`pi-${d.id}-${i}`} type="file" accept="audio/*" style={{ display:'none' }} onChange={e=>e.target.files[0]&&loadPad(d.id,i,e.target.files[0])}/>
                        </div>
                      ))}
                    </div>
                  )}

                  {d.type==='rv'&&<>
                    <div style={{ display:'flex',flexDirection:'column',gap:5 }}>
                      <div style={{ fontSize:8,color:L.muted,letterSpacing:1.5 }}>ROOM TYPE</div>
                      <div style={{ display:'flex',gap:4,flexWrap:'wrap' }}>{ROOM_TYPES.map(r=><Pill key={r} tiny label={r.toUpperCase()} active={d.room===r} col={T.col} onClick={()=>updDev(d.id,'room',r)}/>)}</div>
                      <div style={{ fontSize:9,color:T.col+'80',marginTop:2,maxWidth:160 }}>
                        {d.room==='hall'&&'Concert hall — smooth diffuse tail'}
                        {d.room==='room'&&'Small room — dense early reflections'}
                        {d.room==='plate'&&'Steel plate — shimmery metallic'}
                        {d.room==='cath'&&'Cathedral — enormous, airy'}
                        {d.room==='spring'&&'Spring — boingy retro wobble'}
                      </div>
                    </div>
                    <Knob val={d.decay} min={0.5} max={8} step={0.1} col={T.col} label="DECAY" fmt={v=>v.toFixed(1)+'s'} onVal={v=>updDev(d.id,'decay',v)} size={28}/>
                    <Knob val={d.damp} min={0} max={100} col={T.col} label="DAMP" fmt={v=>v+'%'} onVal={v=>updDev(d.id,'damp',v)}/>
                    <Knob val={d.preDly} min={0} max={100} col={T.col} label="PRE-DLY" fmt={v=>v+'ms'} onVal={v=>updDev(d.id,'preDly',v)}/>
                    <Knob val={d.mix} min={0} max={100} col={T.col} label="MIX" fmt={v=>v+'%'} onVal={v=>{ updDev(d.id,'mix',v); setFxRvW(v); }} size={28}/>
                    <div style={{ fontFamily:mono,fontSize:11,fontWeight:700,color:T.col,background:T.col+'10',border:`1px solid ${T.col}40`,padding:'6px 12px',borderRadius:8 }}>{d.room.toUpperCase()} · {d.decay.toFixed(1)}s · {d.damp}% DAMP</div>
                  </>}

                </div>
              )}
            </RackUnit>
          );
        })}

        {/* FX Rack */}
        <RackUnit>
          <DevHeader label="FX Rack" subtitle="Post-master · Dist · Delay · Reverb" col="#5a3a9a" open={open.fx} onToggle={()=>setOpen(o=>({...o,fx:!o.fx}))}/>
          {open.fx&&(
            <div style={{ display:'flex',alignItems:'center',padding:'10px 12px',gap:14,borderLeft:'4px solid #5a3a9a',background:L.panelB,flexWrap:'wrap' }}>
              <Knob val={fxDist}  min={0} max={100} col="#993556" label="DISTORT"  fmt={v=>v+'%'}               onVal={setFxDist}/>
              <Knob val={fxDlyT}  min={5} max={100} col="#1566a8" label="DLY TIME" fmt={v=>(v/100).toFixed(2)+'s'} onVal={setFxDlyT}/>
              <Knob val={fxDlyFb} min={0} max={85}  col="#1566a8" label="DLY FB"   fmt={v=>v+'%'}               onVal={setFxDlyFb}/>
              <Knob val={fxDlyW}  min={0} max={100} col="#1566a8" label="DLY MIX"  fmt={v=>v+'%'}               onVal={setFxDlyW}/>
              <Knob val={fxRvW}   min={0} max={100} col="#5a3a9a" label="REVERB"   fmt={v=>v+'%'}               onVal={setFxRvW} size={28}/>
            </div>
          )}
        </RackUnit>

      </div>

      {/* ── MIDI SEQUENCER ── */}
      <div style={{ height:220,flexShrink:0,background:L.panel,borderTop:`2px solid ${L.border}`,display:'flex',flexDirection:'column',userSelect:'none' }}>
        <div style={{ height:30,background:L.panelB,borderBottom:`1px solid ${L.border}`,display:'flex',alignItems:'center',padding:'0 12px',gap:10,flexShrink:0 }}>
          <span style={{ fontSize:9,letterSpacing:2.5,color:L.muted,fontWeight:700 }}>◈ MIDI SEQUENCER</span>
          <span style={{ fontSize:8,color:L.dim }}>Drum steps: click to toggle · Pitched tracks: click = piano roll · Drag note block RIGHT to extend length</span>
          <div style={{ marginLeft:'auto',display:'flex',gap:8,alignItems:'center' }}>
            <span style={{ fontSize:8,color:L.dim }}>LEN:</span>
            <input type="number" min={1} max={128} value={seqLen} onChange={e=>updateSeqLen(+e.target.value)} style={{ width:38,height:20,fontSize:10,background:L.panel,border:`1px solid ${L.border}`,borderRadius:3,textAlign:'center',color:L.text }}/>
            <span style={{ fontSize:8,color:L.dim }}>STEPS/BEAT:</span>
            <input type="number" min={1} max={16} value={stepsPerBeat} onChange={e=>setStepsPerBeat(Math.max(1,Math.min(16,+e.target.value)))} style={{ width:28,height:20,fontSize:10,background:L.panel,border:`1px solid ${L.border}`,borderRadius:3,textAlign:'center',color:L.text }}/>
          </div>
        </div>

        {/* Ruler */}
        <div style={{ height:14,background:'#f8f7f4',borderBottom:`1px solid ${L.border}`,display:'flex',flexShrink:0 }}>
          <div style={{ width:128,flexShrink:0,borderRight:`1px solid ${L.border}` }}/>
          <div className="seq-scroll" style={{ flex:1,display:'flex',alignItems:'center',padding:'0 3px',overflowX:'auto' }}>
            {Array(seqLen).fill(0).map((_,i)=>(
              <div key={i} style={{ flex:'0 0 28px',display:'flex',alignItems:'center',position:'relative' }}>
                {i>0&&i%stepsPerBeat===0&&<div style={{ position:'absolute',left:-1,width:1,height:10,background:L.borderHi }}/>}
                <div style={{ flex:1,fontSize:7,color:i%stepsPerBeat===0?L.muted:L.dim,fontWeight:i%stepsPerBeat===0?700:400,textAlign:'center' }}>
                  {i%stepsPerBeat===0?Math.floor(i/stepsPerBeat)+1:i+1}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Track rows */}
        <div style={{ flex:1,overflowY:'auto' }}>
          {seqTracks.map(track=>{
            let coveredUntil=-1;
            return (
              <div key={track.id} style={{ height:26,display:'flex',borderBottom:`1px solid #f0ede8` }}>
                {/* Track label */}
                <div onClick={()=>track.pitched&&setPianoRoll({trackId:track.id,highlightStep:null})}
                  style={{ width:128,flexShrink:0,display:'flex',alignItems:'center',gap:5,padding:'0 8px',borderRight:`1px solid ${L.border}`,cursor:track.pitched?'pointer':'default' }}>
                  <div style={{ width:3,height:14,borderRadius:2,background:track.col,flexShrink:0 }}/>
                  <div style={{ fontSize:8,letterSpacing:1,color:L.muted,textTransform:'uppercase',flex:1,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis' }}>{track.name}</div>
                  {track.pitched&&<span style={{ fontSize:8,color:track.col,opacity:0.5 }}>𝄞</span>}
                </div>

                {/* Steps */}
                <div className="seq-scroll"
                  style={{ flex:1,display:'flex',alignItems:'center',padding:'0 3px',overflowX:'auto' }}
                  onScroll={e=>{ document.querySelectorAll('.seq-scroll').forEach(s=>{ if(s!==e.target) s.scrollLeft=e.target.scrollLeft; }); }}>
                  {Array(seqLen).fill(0).map((_,si)=>{
                    const val    = seq[track.id]?.[si];
                    const on     = val!=null&&val!==false;
                    const covered= si<coveredUntil;
                    let label='', len=1;

                    if(on&&!covered){
                      if(track.pitched==='pad')          label=`P${(val||0)+1}`;
                      else if(track.pitched&&val?.notes){ label=chordLabel(val); len=Math.min(val.len||1,seqLen-si); }
                      else if(track.pitched&&val?.note)  { label=chordLabel(val); len=Math.min(val.len||1,seqLen-si); }
                      if(len>1) coveredUntil=si+len;
                    }
                    const isPlaying=step>=si&&step<si+len;

                    return (
                      <div key={si}
                        onMouseEnter={()=>{
                          // !! Uses ref — always reads the freshest drag state, no stale closure
                          const ds=dragRef.current;
                          if(!ds||ds.trackId!==track.id||ds.startSi>=si) return;
                          ds.hasDragged=true;
                          const newLen=Math.max(1,si-ds.startSi+1);
                          setSeq(prev=>{
                            const n={...prev,[track.id]:[...prev[track.id]]};
                            const cur=n[track.id][ds.startSi];
                            if(!cur||(!cur.notes&&!cur.note)) return n;
                            n[track.id][ds.startSi]={...cur,len:newLen};
                            // Clear cells consumed by extension
                            for(let x=ds.startSi+1;x<ds.startSi+newLen;x++) n[track.id][x]=null;
                            return n;
                          });
                          tickRender(); // force re-render so coveredUntil recalculates
                        }}
                        style={{ flex:'0 0 28px',display:'flex',alignItems:'center',position:'relative' }}>
                        {si>0&&si%stepsPerBeat===0&&<div style={{ position:'absolute',left:-1,width:1,height:14,background:L.borderHi,zIndex:1 }}/>}

                        {/* Base empty cell — for drum tracks handles click directly */}
                        <div
                          onClick={()=>!covered&&!track.pitched&&toggleStep(track.id,si)}
                          style={{ width:'100%',height:20,borderRadius:3,cursor:'pointer',
                            border:`1px solid ${L.border}`,
                            background:si===step?'#fffbe6':'transparent',
                            outline:si===step?`2px solid ${track.col}60`:'none',outlineOffset:-2 }}/>

                        {/* Note / chord block */}
                        {on&&!covered&&(
                          <div
                            onMouseDown={e=>{
                              e.stopPropagation();
                              if(track.pitched&&track.pitched!=='pad'){
                                // Start drag for extension
                                dragRef.current={ trackId:track.id, startSi:si, hasDragged:false };
                              } else if(!track.pitched){
                                // Drum: start drag to mark multiple steps quickly
                                dragRef.current={ trackId:track.id, startSi:si, hasDragged:false };
                              }
                            }}
                            onClick={e=>{
                              e.stopPropagation();
                              // If wasn't dragged and this is a pitched block, open piano roll
                              if(track.pitched&&track.pitched!=='pad'&&!dragRef.current?.hasDragged){
                                setPianoRoll({ trackId:track.id, highlightStep:si });
                              } else if(!track.pitched){
                                toggleStep(track.id,si);
                              }
                            }}
                            style={{
                              position:'absolute',left:0,top:'50%',transform:'translateY(-50%)',
                              height:20,width:Math.max(26,len*28+(len-1)*2),
                              borderRadius:3,cursor:track.pitched?'ew-resize':'pointer',zIndex:2,
                              border:`1px solid ${isPlaying?track.col:track.col+'70'}`,
                              background:isPlaying?track.col+'55':track.col+'28',
                              display:'flex',alignItems:'center',justifyContent:'center',
                              fontSize:7,color:track.col,fontWeight:700,letterSpacing:0.5,
                              boxShadow:`0 1px 6px ${track.col}25`,
                              overflow:'hidden', whiteSpace:'nowrap',
                            }}>
                            {label}
                            {track.pitched&&track.pitched!=='pad'&&len<=3&&(
                              <div style={{ position:'absolute',right:2,top:3,bottom:3,width:3,background:track.col,opacity:0.35,borderRadius:2 }}/>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── PIANO ROLL MODAL ── */}
      {pianoRoll&&(()=>{
        const dev=devices.find(d=>d.id===pianoRoll.trackId);
        if(!dev) return null;
        const T=DEVICE_TYPES[dev.type];
        return (
          <PianoRoll
            trackDef={{ ...T,name:T.name }}
            seqData={seq[pianoRoll.trackId]||Array(seqLen).fill(null)}
            currentStep={step}
            highlightStep={pianoRoll.highlightStep}
            seqLen={seqLen}
            stepsPerBeat={stepsPerBeat}
            onUpdate={onPianoUpdate}
            onClose={()=>setPianoRoll(null)}
            onPlayNote={(note,oct)=>previewNote(dev,note,oct)}
          />
        );
      })()}

    </div>
  );
}
