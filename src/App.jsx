/**
 * App.jsx — Live Rig Performance Suite
 *
 * What's fixed / new in this version:
 *  ✓ LOAD BUG FIXED — songs.list now returns state; fallback to songs.get if missing
 *  ✓ applyState is resilient — handles old formats, string JSON, partial data
 *  ✓ STRING PAD device — 6-osc detuned unison with stereo spread & air shelf
 *  ✓ REVERB UNIT device — 5 room types (Hall/Room/Plate/Cathedral/Spring),
 *      pre-delay, decay, damping, mix — uses engine._genIR convolution
 *  ✓ NEW SONG button to reset without refreshing
 *  ✓ Various UX tightening (scroll sync, drag-extend, note preview, etc.)
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { PianoRoll } from "./PianoRoll";
import { AudioEngine, noteFreq } from "./AudioEngine";
import { auth as authAPI, songs as songsAPI, cloudinary } from "./api";

// ─── CONSTANTS ────────────────────────────────────────────────────────────────
const NOTES      = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const PAD_KEYS   = ['Q','W','E','R','A','S','D','F'];
const DRUM_IDS   = ['kick','snare','hh','bass'];
const DRUM_NAMES = ['KICK','SNARE','HIHAT','BASS'];
const DRUM_COLS  = ['#c4400f','#a03018','#7a5010','#d05030'];

// ─── DEVICE TYPE REGISTRY ────────────────────────────────────────────────────
const DEVICE_TYPES = {
  poly: {
    name: 'POLY SYNTH',   col: '#1566a8', pitched: true,
    def:  { wave:'sawtooth', note:'A', oct:4, atk:20, rel:600, flt:2000 }
  },
  str: {
    name: 'STRING PAD',   col: '#7030a0', pitched: true,
    def:  { note:'C', oct:3, detune:8, spread:7, atk:800, rel:1200, flt:3500 }
  },
  rr: {
    name: 'ROAD RASH FM', col: '#8a6500', pitched: true,
    def:  { note:'E', oct:2, mr:1.0, mi:3.5, det:18, flt:1800, atk:5, rel:180, drv:70, arp:true }
  },
  acid: {
    name: 'ACID BASS',    col: '#5a8800', pitched: true,
    def:  { note:'A', oct:1, wave:'sawtooth', cut:400, res:80, env:3000, dec:250, dist:60 }
  },
  samp: {
    name: 'SAMPLER NN-8', col: '#1a7a3a', pitched: 'pad',
    def:  { pads: Array(8).fill(null).map((_,i) => ({ name:`PAD ${i+1}`, buf:null, vol:100, pitch:0, cloudUrl:null })) }
  },
  rv: {
    name: 'REVERB UNIT',  col: '#1a6080', pitched: false,
    def:  { room:'hall', preDly:20, decay:3.0, damp:30, mix:40 }
  },
};

const MIX_CH = [
  { key:'drums',  name:'DRUMS',  col:'#c4400f' },
  { key:'synth',  name:'SYNTH',  col:'#1566a8' },
  { key:'rr',     name:'RR FM',  col:'#8a6500' },
  { key:'samp',   name:'SAMP',   col:'#1a7a3a' },
  { key:'master', name:'MASTER', col:'#5050a0' },
];

const ROOM_TYPES = ['hall','room','plate','cath','spring'];

// ─── LIGHT THEME ─────────────────────────────────────────────────────────────
const L = {
  bg:'#f2efe9', panel:'#ffffff', panelB:'#f8f7f4',
  border:'#e2dfd8', borderHi:'#ccc9c0',
  text:'#1a1716', muted:'#7a7570', dim:'#b0aba5', accent:'#e8950a',
  shadow:'0 1px 4px rgba(0,0,0,0.07), 0 4px 16px rgba(0,0,0,0.04)',
};

const mono = "'JetBrains Mono','Fira Code','Courier New',monospace";

// ─── DEFAULT STATE FACTORIES ───────────────────────────────────────────────────
const mkSeq = (len = 16) => ({
  kick:  Array(len).fill(false).map((_,i) => [1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0][i % 16] === 1),
  snare: Array(len).fill(false).map((_,i) => [0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0][i % 16] === 1),
  hh:    Array(len).fill(false).map((_,i) => [1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0][i % 16] === 1),
  bass:  Array(len).fill(false).map((_,i) => [1,0,0,0,0,0,1,0,0,0,1,0,0,0,0,0][i % 16] === 1),
});

const mkMix = () => ({
  drums: {vol:80,pan:0,mute:false,solo:false},
  synth: {vol:75,pan:0,mute:false,solo:false},
  rr:    {vol:70,pan:0,mute:false,solo:false},
  samp:  {vol:80,pan:0,mute:false,solo:false},
  master:{vol:85,pan:0},
});

const DEFAULT_DEVICES = () => [
  { id:'poly-1', type:'poly', ...DEVICE_TYPES.poly.def },
  { id:'rr-1',   type:'rr',   ...DEVICE_TYPES.rr.def   },
  { id:'samp-1', type:'samp', ...DEVICE_TYPES.samp.def  },
];

const DEFAULT_SEQ = (devIds = ['poly-1','rr-1','samp-1'], len = 16) => ({
  ...mkSeq(len),
  'poly-1': Array(len).fill(null),
  'rr-1':   ['E','E',null,'E','G',null,'A','G','E',null,'D',null,'E','B',null,'E']
              .map(n => n ? {note:n,oct:2} : null),
  'samp-1': Array(len).fill(null),
});

// ─── SINGLETON ENGINE ─────────────────────────────────────────────────────────
const engine = new AudioEngine();

// ─── UI COMPONENTS ────────────────────────────────────────────────────────────
function Screw() {
  return (
    <div style={{ width:10,height:10,borderRadius:'50%',flexShrink:0,
      background:'radial-gradient(circle at 35% 30%,#d8d5d0,#a8a5a0)',
      border:'1px solid #c0bdb8',position:'relative' }}>
      <div style={{ position:'absolute',inset:0,display:'flex',alignItems:'center',justifyContent:'center' }}>
        <div style={{ width:'65%',height:1,background:'rgba(0,0,0,0.2)',position:'absolute' }}/>
        <div style={{ width:1,height:'65%',background:'rgba(0,0,0,0.15)',position:'absolute' }}/>
      </div>
    </div>
  );
}

function Ear({ side }) {
  return (
    <div style={{
      width:22,flexShrink:0,
      background:side==='left'?'linear-gradient(to right,#e0ddd8,#eae7e2)':'linear-gradient(to left,#e0ddd8,#eae7e2)',
      borderLeft:side==='left'?`1px solid ${L.borderHi}`:'none',
      borderRight:side==='right'?`1px solid ${L.borderHi}`:'none',
      display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'space-around',padding:'5px 0',
    }}>
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
        {subtitle && <span style={{ fontSize:9,color:L.muted,letterSpacing:1 }}>{subtitle}</span>}
        <span style={{ marginLeft:'auto',fontSize:9,color:L.dim,marginRight:onRemove?6:0 }}>{open?'▼':'►'}</span>
      </div>
      {onRemove && (
        <button onClick={e=>{e.stopPropagation();onRemove();}}
          style={{ background:'transparent',border:'none',color:L.muted,fontSize:14,cursor:'pointer',
            padding:'0 2px',lineHeight:1,flexShrink:0 }} title="Remove device">✕</button>
      )}
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

function Knob({ val, min, max, step=1, col, label, fmt, onVal, size=26 }) {
  const dragging=useRef(false), startY=useRef(0), startV=useRef(val);
  const pct = (val-min)/(max-min); const ang = -145+pct*290;

  useEffect(() => {
    const mv = e => {
      if (!dragging.current) return;
      let nv = startV.current + ((startY.current-e.clientY)/130)*(max-min);
      nv = Math.max(min, Math.min(max, Math.round(nv/step)*step));
      onVal(nv);
    };
    const up = () => { dragging.current=false; };
    window.addEventListener('mousemove',mv); window.addEventListener('mouseup',up);
    return () => { window.removeEventListener('mousemove',mv); window.removeEventListener('mouseup',up); };
  }, [min,max,step,onVal]);

  return (
    <div style={{ display:'flex',flexDirection:'column',alignItems:'center',gap:3,flexShrink:0 }}>
      <div onMouseDown={e=>{dragging.current=true;startY.current=e.clientY;startV.current=val;e.preventDefault();}}
        style={{ width:size,height:size,borderRadius:'50%',cursor:'ns-resize',
          background:`radial-gradient(circle at 40% 35%,#fff,${col}18)`,
          border:`2px solid ${col}55`,
          boxShadow:`0 2px 6px rgba(0,0,0,0.1),inset 0 1px 2px rgba(255,255,255,0.9)`,
          position:'relative' }}>
        <div style={{ position:'absolute',top:'14%',left:'50%',width:2,height:'28%',background:col,
          borderRadius:2,transformOrigin:'bottom center',transform:`translateX(-50%) rotate(${ang}deg)`,
          boxShadow:`0 0 3px ${col}80` }}/>
      </div>
      <div style={{ fontSize:7,color:L.muted,letterSpacing:0.5,textTransform:'uppercase',whiteSpace:'nowrap' }}>{label}</div>
      <div style={{ fontSize:8,color:col,fontFamily:mono,fontWeight:700 }}>{fmt?fmt(val):val}</div>
    </div>
  );
}

function Pill({ label, active, col, onClick, style:extra }) {
  return (
    <button onClick={onClick} style={{
      fontFamily:mono,fontSize:9,letterSpacing:1,textTransform:'uppercase',
      padding:'4px 10px',borderRadius:20,cursor:'pointer',
      border:`1.5px solid ${active?col:L.border}`,
      background:active?col:L.panel,
      color:active?'#fff':L.muted,
      fontWeight:active?700:400,
      transition:'all 0.1s',
      ...extra,
    }}>{label}</button>
  );
}

function NoteDisplay({ col, note, oct, freq }) {
  return (
    <div style={{ fontFamily:mono,fontSize:13,fontWeight:700,color:col,
      background:col+'12',border:`1px solid ${col}40`,padding:'5px 12px',
      borderRadius:8,letterSpacing:1,flexShrink:0,alignSelf:'flex-start' }}>
      {note}{oct} · {Math.round(freq)}Hz
    </div>
  );
}

// ─── APP ──────────────────────────────────────────────────────────────────────
export default function App() {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const [authed,    setAuthed]    = useState(false);
  const [token,     setToken]     = useState(() => localStorage.getItem('lr_token') || '');
  const [loginU,    setLoginU]    = useState('');
  const [loginP,    setLoginP]    = useState('');
  const [loginErr,  setLoginErr]  = useState('');
  const [loginMode, setLoginMode] = useState('login');
  const [authBusy,  setAuthBusy]  = useState(false);

  // ── Transport ─────────────────────────────────────────────────────────────
  const [playing,      setPlaying]      = useState(false);
  const [bpm,          setBpmS]         = useState(120);
  const [step,         setStep]         = useState(-1);
  const [seqLen,       setSeqLen]       = useState(16);
  const [stepsPerBeat, setStepsPerBeat] = useState(4);

  // ── Devices & Seq ─────────────────────────────────────────────────────────
  const [devices, setDevices] = useState(DEFAULT_DEVICES);
  const [seq,     setSeq]     = useState(() => DEFAULT_SEQ());
  const [mx,      setMx]      = useState(mkMix);

  // ── FX ────────────────────────────────────────────────────────────────────
  const [fxDist,  setFxDist]  = useState(0);
  const [fxDlyT,  setFxDlyT]  = useState(30);
  const [fxDlyFb, setFxDlyFb] = useState(25);
  const [fxDlyW,  setFxDlyW]  = useState(0);
  const [fxRvW,   setFxRvW]   = useState(0);

  // ── UI State ──────────────────────────────────────────────────────────────
  const [open,      setOpen]      = useState({ mix:true, drum:true, fx:false });
  const [pianoRoll, setPianoRoll] = useState(null);
  const [dragState, setDragState] = useState(null);

  // ── Songs ─────────────────────────────────────────────────────────────────
  const [songs,       setSongs]       = useState([]);
  const [showSongs,   setShowSongs]   = useState(false);
  const [songName,    setSongName]    = useState('New Song');
  const [activeSong,  setActiveSong]  = useState(null);
  const [songBusy,    setSongBusy]    = useState(false);
  const [songMsg,     setSongMsg]     = useState('');

  // ── Scheduler refs ────────────────────────────────────────────────────────
  const schedRef       = useRef(null);
  const stepRef        = useRef(0);
  const nextTRef       = useRef(0);
  const bpmRef         = useRef(bpm);
  const seqRef         = useRef(seq);
  const seqLenRef      = useRef(seqLen);
  const spbRef         = useRef(stepsPerBeat);
  const devicesRef     = useRef(devices);

  bpmRef.current   = bpm;
  seqRef.current   = seq;
  seqLenRef.current = seqLen;
  spbRef.current   = stepsPerBeat;
  devicesRef.current = devices;

  const ea = useCallback(() => { engine.init(); engine.resume(); }, []);

  // ── Side-effects ──────────────────────────────────────────────────────────
  useEffect(() => { engine.applyMixer(mx); }, [mx]);
  useEffect(() => { engine.applyFX({ dist:fxDist, dlyT:fxDlyT, dlyFb:fxDlyFb, dlyW:fxDlyW, rvW:fxRvW }); },
    [fxDist,fxDlyT,fxDlyFb,fxDlyW,fxRvW]);

  // Sync Reverb Unit device → engine master reverb
  const prevRvRef = useRef({});
  useEffect(() => {
    const rvDev = devices.find(d => d.type === 'rv');
    if (!rvDev || !engine.ready) return;
    const prev = prevRvRef.current;
    const needsIR = prev.room !== rvDev.room || prev.decay !== rvDev.decay || prev.damp !== rvDev.damp;
    if (needsIR) { engine.setMasterReverb({ room:rvDev.room, decay:rvDev.decay, damp:rvDev.damp }); }
    engine.revW.gain.value = (rvDev.mix / 100) * 2;
    prevRvRef.current = { room:rvDev.room, decay:rvDev.decay, damp:rvDev.damp, mix:rvDev.mix };
  }, [devices]);

  // Auto-verify token, load songs
  useEffect(() => {
    if (!token) return;
    authAPI.verify(token)
      .then(() => setAuthed(true))
      .catch(() => { localStorage.removeItem('lr_token'); setToken(''); });
  }, []);
  useEffect(() => {
    if (!authed || !token) return;
    songsAPI.list(token).then(d => setSongs(d.songs || [])).catch(() => {});
  }, [authed, token]);

  // ── Auth ──────────────────────────────────────────────────────────────────
  const doAuth = async () => {
    setAuthBusy(true); setLoginErr('');
    try {
      const fn = loginMode === 'login' ? authAPI.login : authAPI.register;
      const { token: t } = await fn(loginU, loginP);
      localStorage.setItem('lr_token', t);
      setToken(t); setAuthed(true);
    } catch (e) { setLoginErr(e.message); }
    finally { setAuthBusy(false); }
  };

  // ── Audio dispatch helpers ─────────────────────────────────────────────────
  const playPoly = useCallback((t, freq, d, dur) => {
    if (!engine.ready) return;
    const ctx = engine.ctx;
    const osc = ctx.createOscillator(); osc.type = d.wave; osc.frequency.setValueAtTime(freq, t);
    const flt = ctx.createBiquadFilter(); flt.type = 'lowpass'; flt.frequency.setValueAtTime(d.flt, t);
    const vca = ctx.createGain();
    const atkS = d.atk/1000, relS = d.rel/1000;
    vca.gain.setValueAtTime(0, t);
    vca.gain.linearRampToValueAtTime(0.55, t + atkS);
    vca.gain.setValueAtTime(0.55, Math.max(t + atkS, t + dur));
    vca.gain.exponentialRampToValueAtTime(0.001, Math.max(t + atkS, t + dur) + relS);
    osc.connect(flt); flt.connect(vca); vca.connect(engine.chS.gain);
    osc.start(t); osc.stop(Math.max(t + atkS, t + dur) + relS + 0.1);
  }, []);

  const playString = useCallback((t, freq, d, dur) => {
    engine.playString(t, freq, d, dur);
  }, []);

  const playAcid = useCallback((t, freq, d, dur) => {
    if (!engine.ready) return;
    const ctx = engine.ctx;
    const osc = ctx.createOscillator(); osc.type = d.wave; osc.frequency.setValueAtTime(freq, t);
    const flt = ctx.createBiquadFilter(); flt.type = 'lowpass'; flt.Q.value = (d.res / 100) * 25;
    flt.frequency.setValueAtTime(d.cut + d.env, t);
    flt.frequency.exponentialRampToValueAtTime(Math.max(40, d.cut), t + Math.max(0.01, dur));
    const shaper = ctx.createWaveShaper();
    const crv = new Float32Array(400); const k = d.dist;
    for (let i=0;i<400;i++){const x=i*2/400-1;crv[i]=(3+k)*x*20*Math.PI/180/(Math.PI+k*Math.abs(x));}
    shaper.curve = crv;
    const vca = ctx.createGain();
    vca.gain.setValueAtTime(0, t); vca.gain.linearRampToValueAtTime(0.65, t + 0.01);
    vca.gain.setValueAtTime(0.65, t + dur); vca.gain.exponentialRampToValueAtTime(0.001, t + dur + d.dec/1000);
    osc.connect(flt); flt.connect(shaper); shaper.connect(vca); vca.connect(engine.chD.gain);
    osc.start(t); osc.stop(t + dur + d.dec/1000 + 0.1);
  }, []);

  // ── Scheduler ─────────────────────────────────────────────────────────────
  const schedStep = useCallback((s, t) => {
    const q   = seqRef.current;
    const spb = (60 / bpmRef.current) / spbRef.current;

    if (q.kick?.[s])  engine.playKick(t);
    if (q.snare?.[s]) engine.playSnare(t);
    if (q.hh?.[s])    engine.playHH(t);
    if (q.bass?.[s])  engine.playBass(t, 82 + (s % 8) * 3);

    devicesRef.current.forEach(d => {
      if (d.type === 'rv') return; // not a sound generator
      const noteObj = q[d.id]?.[s];
      if (!noteObj && d.type !== 'samp') return;

      const dur = spb * ((noteObj?.len) || 1);

      if      (d.type === 'poly') playPoly(t, noteFreq(noteObj.note, noteObj.oct), d, dur);
      else if (d.type === 'str')  playString(t, noteFreq(noteObj.note, noteObj.oct), d, dur);
      else if (d.type === 'rr' && d.arp) engine.playRR(noteFreq(noteObj.note, noteObj.oct), t, dur, d);
      else if (d.type === 'acid') playAcid(t, noteFreq(noteObj.note, noteObj.oct), d, dur);
      else if (d.type === 'samp' && noteObj != null) {
        const pad = d.pads[noteObj];
        if (pad?.buf) engine.playPad(pad.buf, pad.vol, pad.pitch);
      }
    });
  }, [playPoly, playString, playAcid]);

  const startSeq = useCallback(() => {
    ea(); stepRef.current = 0; nextTRef.current = engine.ctx.currentTime + 0.05;
    const tick = () => {
      while (nextTRef.current < engine.ctx.currentTime + 0.12) {
        const s = stepRef.current;
        schedStep(s, nextTRef.current);
        const delay = Math.max(0, (nextTRef.current - engine.ctx.currentTime) * 1000);
        setTimeout(() => setStep(s), delay);
        nextTRef.current += (60 / bpmRef.current) / spbRef.current;
        stepRef.current = (stepRef.current + 1) % seqLenRef.current;
      }
      schedRef.current = setTimeout(tick, 20);
    };
    tick();
  }, [ea, schedStep]);

  useEffect(() => {
    if (playing) startSeq();
    else { clearTimeout(schedRef.current); setStep(-1); }
    return () => clearTimeout(schedRef.current);
  }, [playing, startSeq]);

  // ── Keyboard ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = e => {
      if (e.target.tagName === 'INPUT') return;
      if (e.key === ' ') { e.preventDefault(); ea(); setPlaying(p=>!p); return; }
      const i = PAD_KEYS.indexOf(e.key.toUpperCase());
      if (i >= 0) {
        const samp = devices.find(d => d.type === 'samp');
        if (samp?.pads[i]?.buf) { ea(); engine.playPad(samp.pads[i].buf, samp.pads[i].vol, samp.pads[i].pitch); }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [devices, ea]);

  // ── Drag-to-extend mouse up ────────────────────────────────────────────────
  useEffect(() => {
    const onUp = () => {
      if (!dragState) return;
      if (!dragState.hasDragged) {
        const isDrum = DRUM_IDS.includes(dragState.trackId);
        const T = isDrum ? {pitched:false} : DEVICE_TYPES[devices.find(d=>d.id===dragState.trackId)?.type] || {};
        if (T.pitched && T.pitched !== 'pad') setPianoRoll({ trackId:dragState.trackId, highlightStep:dragState.startSi });
        else toggleStep(dragState.trackId, dragState.startSi);
      }
      setDragState(null);
    };
    window.addEventListener('mouseup', onUp);
    return () => window.removeEventListener('mouseup', onUp);
  }, [dragState, devices]);

  // ── Device management ─────────────────────────────────────────────────────
  const updDev = (id, field, val) =>
    setDevices(prev => prev.map(d => d.id === id ? {...d, [field]:val} : d));

  const addDevice = type => {
    const id = `${type}-${Date.now()}`;
    setDevices(prev => [...prev, { id, type, ...DEVICE_TYPES[type].def }]);
    if (type !== 'rv') {
      setSeq(prev => ({ ...prev, [id]: Array(seqLen).fill(null) }));
    }
    setOpen(prev => ({ ...prev, [id]:true }));
  };

  const removeDevice = id => {
    setDevices(prev => prev.filter(d => d.id !== id));
    setSeq(prev => { const n = {...prev}; delete n[id]; return n; });
    // If it was the reverb unit, reset to basic IR
    const dev = devices.find(d => d.id === id);
    if (dev?.type === 'rv' && engine.ready) {
      engine.setMasterReverb({ room:'hall', decay:2.5, damp:20 });
      engine.revW.gain.value = fxRvW / 50;
    }
  };

  const updateSeqLen = newLen => {
    const len = Math.max(1, Math.min(128, newLen));
    setSeqLen(len);
    setSeq(prev => {
      const next = {};
      for (const k in prev) {
        const isNull = !DRUM_IDS.includes(k);
        const fill   = isNull ? null : false;
        if (prev[k].length >= len) next[k] = prev[k].slice(0, len);
        else next[k] = [...prev[k], ...Array(len - prev[k].length).fill(fill)];
      }
      return next;
    });
  };

  // ── Sequencer step toggle ─────────────────────────────────────────────────
  const toggleStep = useCallback((trackId, si) => {
    const isDrum = DRUM_IDS.includes(trackId);
    const T = isDrum ? {pitched:false} : DEVICE_TYPES[devices.find(d=>d.id===trackId)?.type] || {};

    if (T.pitched && T.pitched !== 'pad') {
      setPianoRoll({ trackId, highlightStep: si });
      return;
    }
    ea();
    setSeq(prev => {
      const next = { ...prev, [trackId]: [...(prev[trackId] || [])] };
      if (T.pitched === 'pad') {
        next[trackId][si] = prev[trackId][si] == null ? 0 : prev[trackId][si] < 7 ? prev[trackId][si]+1 : null;
      } else {
        next[trackId][si] = !prev[trackId][si];
        if (next[trackId][si]) {
          if (trackId==='kick')  engine.playKick(engine.ctx.currentTime);
          if (trackId==='snare') engine.playSnare(engine.ctx.currentTime);
          if (trackId==='hh')    engine.playHH(engine.ctx.currentTime);
          if (trackId==='bass')  engine.playBass(engine.ctx.currentTime);
        }
      }
      return next;
    });
  }, [ea, devices]);

  // ── Piano roll update ──────────────────────────────────────────────────────
  const onPianoUpdate = useCallback((si, noteObj) => {
    if (!pianoRoll) return;
    const {trackId} = pianoRoll;
    if (si === 'clear') { setSeq(prev => ({...prev, [trackId]: Array(seqLen).fill(null)})); return; }
    setSeq(prev => {
      const next = { ...prev, [trackId]: [...prev[trackId]] };
      const existing = next[trackId][si];
      if (noteObj && existing?.len) noteObj.len = existing.len; // preserve stretch
      next[trackId][si] = noteObj;
      return next;
    });
    if (noteObj) {
      ea();
      const d = devices.find(x => x.id === trackId);
      if (!d) return;
      if (d.type === 'poly')  playPoly(engine.ctx.currentTime, noteFreq(noteObj.note, noteObj.oct), d, 0.2);
      else if (d.type === 'str')  playString(engine.ctx.currentTime, noteFreq(noteObj.note, noteObj.oct), d, 0.4);
      else if (d.type === 'rr')   engine.playRR(noteFreq(noteObj.note, noteObj.oct), engine.ctx.currentTime, 0.5, d);
      else if (d.type === 'acid') playAcid(engine.ctx.currentTime, noteFreq(noteObj.note, noteObj.oct), d, 0.2);
    }
  }, [pianoRoll, ea, devices, seqLen, playPoly, playString, playAcid]);

  // ── Pad loader ─────────────────────────────────────────────────────────────
  const loadPad = async (deviceId, padIdx, file) => {
    ea();
    const buf = await engine.ctx.decodeAudioData(await file.arrayBuffer());
    setDevices(prev => prev.map(d => {
      if (d.id !== deviceId) return d;
      const np = [...d.pads]; np[padIdx] = {...np[padIdx], buf, name:file.name.replace(/\.[^.]+$/,'').slice(0,14)};
      return {...d, pads:np};
    }));
  };

  // ── New song ───────────────────────────────────────────────────────────────
  const newSong = () => {
    if (!window.confirm('Start a new song? Unsaved changes will be lost.')) return;
    setBpmS(120); setSeqLen(16); setStepsPerBeat(4);
    const devs = DEFAULT_DEVICES();
    setDevices(devs);
    setSeq(DEFAULT_SEQ());
    setMx(mkMix());
    setFxDist(0); setFxDlyT(30); setFxDlyFb(25); setFxDlyW(0); setFxRvW(0);
    setActiveSong(null); setSongName('New Song');
  };

  // ─────────────────────────────────────────────────────────────────────────
  // SAVE / LOAD — The state stored in Neon is pure JSON (no AudioBuffers).
  // Pad audio lives in Cloudinary; only the URL is stored in state.
  // ─────────────────────────────────────────────────────────────────────────
  const captureState = (safeDevices) => ({
    bpm, seqLen, stepsPerBeat, seq,
    mx, fx: { dist:fxDist, dlyT:fxDlyT, dlyFb:fxDlyFb, dlyW:fxDlyW, rvW:fxRvW },
    devices: (safeDevices || devices).map(d =>
      d.type !== 'samp' ? d
      : { ...d, pads: d.pads.map(p => ({ name:p.name, vol:p.vol, pitch:p.pitch, cloudUrl:p.cloudUrl })) }
    ),
  });

  // Restore state from a saved song. Handles:
  //   • New dynamic-device format    (s.devices array)
  //   • Old static format            (s.synth, s.rr, s.pads)
  //   • JSONB sometimes string-serialised by Neon
  const applyState = async (raw) => {
    let s = raw;
    if (typeof s === 'string') { try { s = JSON.parse(s); } catch { throw new Error('State is not valid JSON'); } }
    if (!s || typeof s !== 'object') throw new Error('State is empty or not an object');

    // Restore transport + FX
    if (s.bpm)          setBpmS(s.bpm);
    if (s.seqLen)       setSeqLen(s.seqLen);
    if (s.stepsPerBeat) setStepsPerBeat(s.stepsPerBeat);
    if (s.mx)           setMx(s.mx);
    if (s.fx) {
      setFxDist(s.fx.dist  ?? 0);  setFxDlyT(s.fx.dlyT  ?? 30);
      setFxDlyFb(s.fx.dlyFb ?? 25); setFxDlyW(s.fx.dlyW  ?? 0);
      setFxRvW(s.fx.rvW    ?? 0);
    }

    ea(); // ensure audio context is ready for Cloudinary pad fetching

    // Determine devices — handle legacy single-synth format
    let loadDevices = s.devices;
    let loadSeq     = s.seq ? { ...s.seq } : {};

    if (!loadDevices) {
      // Legacy format: rebuild from flat fields
      loadDevices = [];
      if (s.synth) loadDevices.push({ id:'poly-1', type:'poly', ...DEVICE_TYPES.poly.def, ...s.synth });
      if (s.rr)    loadDevices.push({ id:'rr-1',   type:'rr',   ...DEVICE_TYPES.rr.def, ...s.rr });
      if (s.pads)  loadDevices.push({ id:'samp-1', type:'samp', pads:s.pads });
      if (loadSeq.synth) { loadSeq['poly-1'] = loadSeq.synth; delete loadSeq.synth; }
      if (loadSeq.rr)    { loadSeq['rr-1']   = loadSeq.rr;    delete loadSeq.rr; }
      if (loadSeq.samp)  { loadSeq['samp-1'] = loadSeq.samp;  delete loadSeq.samp; }
    }

    // Hydrate sampler pads from Cloudinary
    const hydratedDevices = await Promise.all(
      (loadDevices || []).map(async d => {
        if (d.type !== 'samp') return d;
        const pads = d.pads || Array(8).fill(null).map((_,i) => ({ name:`PAD ${i+1}`, buf:null, vol:100, pitch:0, cloudUrl:null }));
        const newPads = await Promise.all(
          pads.map(async p => {
            if (!p.cloudUrl) return { ...p, buf:null };
            try { return { ...p, buf: await cloudinary.fetchPad(engine.ctx, p.cloudUrl) }; }
            catch { return { ...p, buf:null }; }
          })
        );
        return { ...d, pads:newPads };
      })
    );

    setDevices(hydratedDevices);
    setSeq(loadSeq);
  };

  const saveSong = async () => {
    if (!token || !songName.trim()) return;
    setSongBusy(true); setSongMsg('');
    try {
      // Upload any un-synced pad audio to Cloudinary
      const safeDevices = await Promise.all(devices.map(async d => {
        if (d.type !== 'samp') return d;
        const newPads = await Promise.all(d.pads.map(async (p, i) => {
          if (!p.buf || p.cloudUrl) return p;
          const { url } = await cloudinary.uploadPad(token, p.buf, p.name || `pad-${i}`);
          return { ...p, cloudUrl:url };
        }));
        return { ...d, pads:newPads };
      }));
      setDevices(safeDevices);

      const state  = captureState(safeDevices);
      const result = activeSong
        ? await songsAPI.update(token, activeSong.id, songName, state)
        : await songsAPI.save(token, songName, state);

      const saved = { ...result.song, state: result.song.state || state };
      setActiveSong(saved);
      setSongs(prev => {
        const idx = prev.findIndex(s => s.id === saved.id);
        return idx >= 0 ? prev.map((s,i) => i===idx ? saved : s) : [...prev, saved];
      });
      setSongMsg('✓ Saved');
    } catch(e) { setSongMsg('Save error: ' + e.message); }
    finally { setSongBusy(false); setTimeout(() => setSongMsg(''), 3500); }
  };

  const loadSong = async (song) => {
    setSongBusy(true); setSongMsg('');
    try {
      // The songs list now includes state — but as a fallback, fetch by ID
      let stateToLoad = song.state;
      if (typeof stateToLoad === 'string') {
        try { stateToLoad = JSON.parse(stateToLoad); } catch {}
      }

      // Still no state? Fetch the full song record
      if (!stateToLoad || typeof stateToLoad !== 'object' || Object.keys(stateToLoad).length === 0) {
        setSongMsg('Fetching song…');
        const full = await songsAPI.get(token, song.id);
        stateToLoad = full.song?.state ?? full.state;
        if (typeof stateToLoad === 'string') { try { stateToLoad = JSON.parse(stateToLoad); } catch {} }
      }

      if (!stateToLoad || typeof stateToLoad !== 'object') {
        throw new Error('Song data could not be retrieved — please re-save this song once.');
      }

      await applyState(stateToLoad);
      setActiveSong({ ...song, state: stateToLoad });
      setSongName(song.name || 'Loaded Song');
      setShowSongs(false);
      setSongMsg('✓ Loaded');
    } catch(e) { setSongMsg('Load error: ' + e.message); }
    finally { setSongBusy(false); setTimeout(() => setSongMsg(''), 4000); }
  };

  const deleteSong = async id => {
    try {
      await songsAPI.delete(token, id);
      setSongs(prev => prev.filter(s => s.id !== id));
      if (activeSong?.id === id) setActiveSong(null);
    } catch(e) { setSongMsg('Delete error: ' + e.message); }
  };

  // ── Note preview helper for device panels ─────────────────────────────────
  const previewNote = (d, note, oct) => {
    ea();
    if (d.type === 'poly')  playPoly(engine.ctx.currentTime, noteFreq(note, oct), d, 0.2);
    if (d.type === 'str')   playString(engine.ctx.currentTime, noteFreq(note, oct), d, 0.5);
    if (d.type === 'rr')    engine.playRR(noteFreq(note, oct), engine.ctx.currentTime, 0.5, d);
    if (d.type === 'acid')  playAcid(engine.ctx.currentTime, noteFreq(note, oct), d, 0.2);
  };

  // ────────────────────────────────────────────────────────────────────────────
  // LOGIN
  // ────────────────────────────────────────────────────────────────────────────
  if (!authed) return (
    <div style={{ minHeight:'100vh', background:L.bg, display:'flex', alignItems:'center', justifyContent:'center', fontFamily:mono }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&display=swap');*{box-sizing:border-box;margin:0;padding:0}input{outline:none;font-family:inherit}`}</style>
      <div style={{ width:360, background:L.panel, borderRadius:12, boxShadow:'0 8px 48px rgba(0,0,0,0.12)', overflow:'hidden' }}>
        <div style={{ height:6, background:'linear-gradient(to right,#c4400f,#1566a8,#1a7a3a,#7030a0)' }}/>
        <div style={{ padding:'36px 40px' }}>
          <div style={{ fontSize:10,color:L.muted,letterSpacing:3,marginBottom:8 }}>◆ LIVE RIG</div>
          <div style={{ fontSize:24,fontWeight:700,letterSpacing:1,color:L.text,marginBottom:4 }}>
            {loginMode==='login'?'Sign In':'Create Account'}
          </div>
          <div style={{ fontSize:11,color:L.dim,marginBottom:28 }}>Neon auth · Cloudinary samples</div>
          {[['text',loginU,setLoginU,'Username'],['password',loginP,setLoginP,'Password']].map(([t,v,s,ph]) => (
            <input key={ph} type={t} placeholder={ph} value={v}
              onChange={e=>s(e.target.value)}
              onKeyDown={e=>e.key==='Enter'&&doAuth()}
              style={{ display:'block',width:'100%',padding:'11px 14px',marginBottom:12,
                border:`1.5px solid ${L.border}`,borderRadius:8,fontSize:13,
                color:L.text,background:L.panelB }} />
          ))}
          {loginErr && <div style={{ fontSize:11,color:'#c4400f',marginBottom:12,padding:'8px 12px',background:'#fef2ee',borderRadius:6 }}>{loginErr}</div>}
          <button onClick={doAuth} disabled={authBusy} style={{ width:'100%',padding:'13px',fontSize:13,fontWeight:700,
            letterSpacing:2,background:'#1a1716',color:'#fff',border:'none',borderRadius:8,cursor:'pointer',
            fontFamily:mono,opacity:authBusy?0.6:1 }}>
            {authBusy?'…':loginMode==='login'?'SIGN IN':'CREATE ACCOUNT'}
          </button>
          <div style={{ textAlign:'center',marginTop:20,fontSize:11,color:L.muted }}>
            {loginMode==='login'?'No account? ':'Have an account? '}
            <span onClick={()=>{setLoginMode(m=>m==='login'?'register':'login');setLoginErr('');}}
              style={{ color:'#1566a8',cursor:'pointer',fontWeight:700 }}>
              {loginMode==='login'?'Create one':'Sign in'}
            </span>
          </div>
        </div>
      </div>
    </div>
  );

  // ────────────────────────────────────────────────────────────────────────────
  // MAIN APP
  // ────────────────────────────────────────────────────────────────────────────
  const seqTracks = [
    ...DRUM_IDS.map((id,i) => ({ id, name:DRUM_NAMES[i], col:DRUM_COLS[i], pitched:false, isDrum:true })),
    ...devices.filter(d => d.type !== 'rv').map(d => ({ id:d.id, name:DEVICE_TYPES[d.type].name, col:DEVICE_TYPES[d.type].col, pitched:DEVICE_TYPES[d.type].pitched, isDrum:false })),
  ];

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
      <div style={{ height:52,flexShrink:0,background:L.panel,borderBottom:`1.5px solid ${L.border}`,
        display:'flex',alignItems:'center',gap:12,padding:'0 14px',boxShadow:'0 1px 0 rgba(0,0,0,0.04)' }}>
        <div style={{ fontSize:11,fontWeight:700,letterSpacing:3,color:L.text,paddingRight:12,borderRight:`1.5px solid ${L.border}`,flexShrink:0 }}>◆ LIVE RIG</div>

        <button onClick={()=>{ea();setPlaying(p=>!p);}} style={{ fontFamily:mono,fontSize:11,letterSpacing:2,
          padding:'7px 16px',border:'none',borderRadius:6,cursor:'pointer',fontWeight:700,flexShrink:0,
          background:playing?'#c4400f':'#1a7a3a',color:'#fff' }}>
          {playing?'■ STOP':'▶ PLAY'}
        </button>

        <div style={{ display:'flex',alignItems:'center',gap:7,flexShrink:0 }}>
          <div><div style={{ fontSize:7,color:L.muted,letterSpacing:1.5 }}>BPM</div>
            <div style={{ fontSize:21,fontWeight:700,color:L.accent,letterSpacing:1,lineHeight:1 }}>{bpm}</div></div>
          <div style={{ display:'flex',flexDirection:'column',gap:1 }}>
            {[[1,'▲'],[-1,'▼']].map(([d,l]) => (
              <button key={l} onClick={()=>setBpmS(b=>Math.max(60,Math.min(200,b+d)))}
                style={{ width:14,height:12,background:L.panelB,border:`1px solid ${L.border}`,
                  fontSize:8,cursor:'pointer',borderRadius:2,fontFamily:mono,color:L.muted,padding:0,lineHeight:1 }}>{l}</button>
            ))}
          </div>
          <input type="range" min={60} max={200} value={bpm} onChange={e=>setBpmS(+e.target.value)} style={{ width:88 }}/>
        </div>

        <div style={{ padding:'3px 10px',background:L.panelB,border:`1px solid ${L.border}`,borderRadius:6,
          fontSize:11,fontWeight:700,color:playing?'#1a7a3a':L.dim,letterSpacing:2,minWidth:76,textAlign:'center',flexShrink:0 }}>
          {playing?`${String(step+1).padStart(2,'0')} / ${seqLen}`:`— / ${seqLen}`}
        </div>

        {/* Song name + save/update */}
        <div style={{ display:'flex',alignItems:'center',gap:8,flex:1,maxWidth:380 }}>
          <input value={songName} onChange={e=>setSongName(e.target.value)}
            style={{ flex:1,padding:'6px 10px',border:`1.5px solid ${L.border}`,borderRadius:6,fontSize:12,
              background:L.panelB,color:L.text }}/>
          <button onClick={saveSong} disabled={songBusy} style={{ fontFamily:mono,fontSize:10,letterSpacing:1,
            padding:'7px 14px',border:'none',background:'#1566a8',color:'#fff',borderRadius:6,cursor:'pointer',
            fontWeight:700,flexShrink:0,opacity:songBusy?0.6:1 }}>
            {songBusy?'…':activeSong?'UPDATE':'SAVE'}
          </button>
          {songMsg && <span style={{ fontSize:10,color:songMsg.startsWith('✓')?'#1a7a3a':'#c4400f',flexShrink:0 }}>{songMsg}</span>}
        </div>

        <button onClick={()=>setShowSongs(s=>!s)} style={{ fontFamily:mono,fontSize:10,letterSpacing:1,
          padding:'7px 12px',border:`1.5px solid ${L.border}`,background:showSongs?L.text:L.panel,
          color:showSongs?'#fff':L.muted,borderRadius:6,cursor:'pointer',flexShrink:0 }}>
          SONGS{songs.length>0?` (${songs.length})`:''}
        </button>

        <button onClick={newSong} style={{ fontFamily:mono,fontSize:10,padding:'7px 10px',
          border:`1.5px solid ${L.border}`,background:'transparent',color:L.muted,borderRadius:6,
          cursor:'pointer',flexShrink:0 }}>NEW</button>

        <button onClick={()=>{localStorage.removeItem('lr_token');setAuthed(false);setToken('');}}
          style={{ fontFamily:mono,fontSize:9,padding:'5px 9px',border:`1px solid ${L.border}`,
            background:'transparent',color:L.dim,borderRadius:5,cursor:'pointer',flexShrink:0 }}>LOG OUT</button>
      </div>

      {/* ── SONGS PANEL ── */}
      {showSongs && (
        <div style={{ background:L.panel,borderBottom:`1.5px solid ${L.border}`,padding:'12px 14px',
          boxShadow:'0 4px 16px rgba(0,0,0,0.06)',zIndex:100,flexShrink:0,maxHeight:210,overflowY:'auto' }}>
          {songs.length === 0
            ? <div style={{ fontSize:12,color:L.muted,textAlign:'center',padding:'14px 0' }}>No songs yet — name yours above and hit SAVE.</div>
            : songs.map(s => (
              <div key={s.id} style={{ display:'flex',alignItems:'center',padding:'8px 12px',borderRadius:6,
                marginBottom:4,border:`1px solid ${activeSong?.id===s.id?'#1566a8':L.border}`,
                background:activeSong?.id===s.id?'#edf4ff':L.panelB }}>
                <div>
                  <div style={{ fontSize:12,fontWeight:700,color:L.text }}>{s.name}</div>
                  <div style={{ fontSize:10,color:L.muted }}>{new Date(s.updated_at||s.created_at).toLocaleDateString()}</div>
                </div>
                <div style={{ marginLeft:'auto',display:'flex',gap:6 }}>
                  <button onClick={()=>loadSong(s)} disabled={songBusy} style={{ fontFamily:mono,fontSize:10,
                    padding:'5px 12px',background:'#1566a8',color:'#fff',border:'none',borderRadius:5,cursor:'pointer',fontWeight:700 }}>
                    LOAD
                  </button>
                  <button onClick={()=>deleteSong(s.id)} style={{ fontFamily:mono,fontSize:10,padding:'5px 10px',
                    background:'transparent',color:'#c4400f',border:`1px solid #c4400f`,borderRadius:5,cursor:'pointer' }}>✕</button>
                </div>
              </div>
            ))
          }
        </div>
      )}

      {/* ── ADD DEVICE BAR ── */}
      <div style={{ height:40,flexShrink:0,background:L.panelB,borderBottom:`1px solid ${L.border}`,
        display:'flex',alignItems:'center',justifyContent:'center',gap:8 }}>
        <span style={{ fontSize:9,color:L.muted,letterSpacing:2,fontWeight:700,marginRight:6 }}>+ ADD DEVICE:</span>
        {[['poly','#1566a8','Poly Synth'],['str','#7030a0','String Pad'],['rr','#8a6500','Road Rash FM'],
          ['acid','#5a8800','Acid Bass'],['samp','#1a7a3a','Sampler'],['rv','#1a6080','Reverb Unit']].map(([type,col,label]) => (
          <Pill key={type} label={`+ ${label}`} active={false} col={col} onClick={()=>addDevice(type)}
            style={{ fontSize:8,padding:'3px 8px' }}/>
        ))}
      </div>

      {/* ── RACK ── */}
      <div style={{ flex:1,overflowY:'auto',padding:'6px 8px',display:'flex',flexDirection:'column' }}>

        {/* MIXER */}
        <RackUnit>
          <DevHeader label="14:2 Mixer" subtitle="Channel Routing" col="#5050a0" open={open.mix} onToggle={()=>setOpen(o=>({...o,mix:!o.mix}))}/>
          {open.mix && (
            <div style={{ display:'flex',overflowX:'auto',padding:'8px 12px',gap:0,background:L.panelB,borderLeft:'4px solid #5050a0' }}>
              {MIX_CH.map(({key,name,col}) => {
                const m = key==='master'?mx.master:mx[key];
                return (
                  <div key={key} style={{ display:'flex',flexDirection:'column',alignItems:'center',gap:5,
                    padding:'6px 12px',borderRight:`1px solid ${L.border}`,minWidth:78,
                    ...(key==='master'?{borderLeft:`2px solid ${L.borderHi}`,marginLeft:6}:{}) }}>
                    <div style={{ fontSize:9,fontWeight:700,color:col,letterSpacing:1,whiteSpace:'nowrap' }}>{name}</div>
                    {key!=='master' && (
                      <div style={{ display:'flex',gap:4 }}>
                        <Pill label="S" active={m.solo} col={col} onClick={()=>setMx(p=>({...p,[key]:{...p[key],solo:!m.solo}}))}/>
                        <Pill label="M" active={m.mute} col="#c4400f" onClick={()=>setMx(p=>({...p,[key]:{...p[key],mute:!m.mute}}))}/>
                      </div>
                    )}
                    <div style={{ height:88,width:30,display:'flex',alignItems:'center',justifyContent:'center',overflow:'hidden' }}>
                      <input type="range" min={0} max={100} value={m.vol}
                        onChange={e=>setMx(p=>({...p,[key]:{...p[key],vol:+e.target.value}}))}
                        style={{ width:88,transform:'rotate(-90deg)',transformOrigin:'center',cursor:'pointer',margin:0 }}/>
                    </div>
                    <div style={{ fontSize:10,fontWeight:700,color:col,fontFamily:mono }}>{m.vol}%</div>
                    <div style={{ fontSize:8,color:L.muted }}>PAN</div>
                    <input type="range" min={-100} max={100} value={m.pan}
                      onChange={e=>setMx(p=>({...p,[key]:{...p[key],pan:+e.target.value}}))}
                      style={{ width:62 }}/>
                    <div style={{ fontSize:9,color:L.muted,fontFamily:mono }}>{m.pan===0?'C':m.pan>0?`R${m.pan}`:`L${Math.abs(m.pan)}`}</div>
                  </div>
                );
              })}
            </div>
          )}
        </RackUnit>

        {/* DRUM MACHINE */}
        <RackUnit>
          <DevHeader label="Drum Machine" subtitle={`${seqLen}-step · 4 tracks`} col="#c4400f" open={open.drum} onToggle={()=>setOpen(o=>({...o,drum:!o.drum}))}/>
          {open.drum && (
            <div style={{ display:'flex',alignItems:'flex-start',padding:'10px 12px',gap:12,borderLeft:'4px solid #c4400f',background:L.panelB,overflowX:'auto' }}>
              <div style={{ display:'flex',flexDirection:'column',gap:5 }}>
                {DRUM_IDS.map((id,ti) => (
                  <div key={id} style={{ display:'flex',alignItems:'center',gap:5 }}>
                    <div style={{ width:42,fontSize:8,color:DRUM_COLS[ti],letterSpacing:1,textAlign:'right',flexShrink:0,fontWeight:700 }}>{DRUM_NAMES[ti]}</div>
                    <div style={{ display:'flex',gap:2 }}>
                      {Array(seqLen).fill(0).map((_,si) => (
                        <div key={si} style={{ display:'flex',alignItems:'center',gap:2 }}>
                          {si>0&&si%stepsPerBeat===0 && <div style={{ width:1,height:22,background:L.borderHi }}/>}
                          <div onClick={()=>toggleStep(id,si)} style={{
                            width:22,height:22,borderRadius:4,cursor:'pointer',flexShrink:0,
                            background:seq[id]?.[si]?DRUM_COLS[ti]:'#f0ede8',
                            border:`1.5px solid ${seq[id]?.[si]?DRUM_COLS[ti]:L.border}`,
                            outline:si===step?`2px solid ${DRUM_COLS[ti]}80`:'none',outlineOffset:1,
                            boxShadow:seq[id]?.[si]?`0 1px 4px ${DRUM_COLS[ti]}50`:'none',
                            transition:'all 0.06s',
                          }}/>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </RackUnit>

        {/* DYNAMIC DEVICES */}
        {devices.map(d => {
          const T   = DEVICE_TYPES[d.type];
          const isOpen = open[d.id] ?? true;
          return (
            <RackUnit key={d.id}>
              <DevHeader label={T.name} subtitle={`id: ${d.id}`} col={T.col}
                open={isOpen} onToggle={()=>setOpen(o=>({...o,[d.id]:!isOpen}))}
                onRemove={()=>removeDevice(d.id)}/>
              {isOpen && (
                <div style={{ display:'flex',alignItems:'center',padding:'10px 12px',gap:12,
                  borderLeft:`4px solid ${T.col}`,background:L.panelB,flexWrap:'wrap' }}>

                  {/* ── POLY SYNTH ── */}
                  {d.type==='poly' && <>
                    <div style={{ display:'flex',flexDirection:'column',gap:6 }}>
                      <div style={{ fontSize:8,color:L.muted,letterSpacing:1.5 }}>WAVEFORM</div>
                      <div style={{ display:'flex',gap:4 }}>{['sawtooth','square','sine','triangle'].map(w =>
                        <Pill key={w} label={w.slice(0,3).toUpperCase()} active={d.wave===w} col={T.col} onClick={()=>updDev(d.id,'wave',w)}/>
                      )}</div>
                      <div style={{ fontSize:8,color:L.muted,letterSpacing:1.5,marginTop:4 }}>OCTAVE</div>
                      <div style={{ display:'flex',gap:4 }}>{[2,3,4,5,6].map(o =>
                        <Pill key={o} label={String(o)} active={d.oct===o} col={T.col} onClick={()=>updDev(d.id,'oct',o)}/>
                      )}</div>
                    </div>
                    <Knob val={d.atk} min={1} max={2000} col={T.col} label="ATTACK" fmt={v=>v+'ms'} onVal={v=>updDev(d.id,'atk',v)}/>
                    <Knob val={d.rel} min={50} max={4000} col={T.col} label="RELEASE" fmt={v=>v+'ms'} onVal={v=>updDev(d.id,'rel',v)} size={30}/>
                    <Knob val={d.flt} min={100} max={8000} col={T.col} label="FILTER" fmt={v=>v>999?Math.round(v/100)/10+'k':v+'Hz'} onVal={v=>updDev(d.id,'flt',v)} size={30}/>
                    <div>
                      <div style={{ fontSize:8,color:L.muted,letterSpacing:1.5,marginBottom:6 }}>NOTE — click to preview</div>
                      <div style={{ display:'flex',gap:3,flexWrap:'wrap',maxWidth:210 }}>{NOTES.map(n =>
                        <Pill key={n} label={n} active={d.note===n} col={T.col}
                          onClick={()=>{ updDev(d.id,'note',n); previewNote({...d,note:n},n,d.oct); }}/>
                      )}</div>
                    </div>
                    <NoteDisplay col={T.col} note={d.note} oct={d.oct} freq={noteFreq(d.note,d.oct)}/>
                  </>}

                  {/* ── STRING PAD ── */}
                  {d.type==='str' && <>
                    <div style={{ display:'flex',flexDirection:'column',gap:6 }}>
                      <div style={{ fontSize:8,color:L.muted,letterSpacing:1.5 }}>OCTAVE</div>
                      <div style={{ display:'flex',gap:4 }}>{[1,2,3,4,5].map(o =>
                        <Pill key={o} label={String(o)} active={d.oct===o} col={T.col} onClick={()=>updDev(d.id,'oct',o)}/>
                      )}</div>
                      <div style={{ fontSize:8,color:L.muted,letterSpacing:1.5,marginTop:4 }}>NOTE — click to preview</div>
                      <div style={{ display:'flex',gap:3,flexWrap:'wrap',maxWidth:210 }}>{NOTES.map(n =>
                        <Pill key={n} label={n} active={d.note===n} col={T.col}
                          onClick={()=>{ updDev(d.id,'note',n); previewNote({...d,note:n},n,d.oct); }}/>
                      )}</div>
                    </div>
                    <Knob val={d.detune} min={0} max={24} col={T.col} label="DETUNE" fmt={v=>v+'st'} onVal={v=>updDev(d.id,'detune',v)}/>
                    <Knob val={d.spread} min={0} max={10} step={0.5} col={T.col} label="SPREAD" fmt={v=>v.toFixed(1)} onVal={v=>updDev(d.id,'spread',v)}/>
                    <Knob val={d.atk} min={50} max={3000} col={T.col} label="ATTACK" fmt={v=>v+'ms'} onVal={v=>updDev(d.id,'atk',v)} size={30}/>
                    <Knob val={d.rel} min={100} max={5000} col={T.col} label="RELEASE" fmt={v=>v+'ms'} onVal={v=>updDev(d.id,'rel',v)} size={30}/>
                    <Knob val={d.flt} min={200} max={8000} col={T.col} label="FILTER" fmt={v=>v>999?Math.round(v/100)/10+'k':v+'Hz'} onVal={v=>updDev(d.id,'flt',v)}/>
                    <NoteDisplay col={T.col} note={d.note} oct={d.oct} freq={noteFreq(d.note,d.oct)}/>
                  </>}

                  {/* ── ROAD RASH FM ── */}
                  {d.type==='rr' && <>
                    <Knob val={d.mr} min={0.1} max={4} step={0.1} col={T.col} label="MOD R" fmt={v=>v.toFixed(1)} onVal={v=>updDev(d.id,'mr',v)}/>
                    <Knob val={d.mi} min={0} max={8} step={0.1} col={T.col} label="MOD I" fmt={v=>v.toFixed(1)} onVal={v=>updDev(d.id,'mi',v)}/>
                    <Knob val={d.det} min={0} max={50} col={T.col} label="DETUNE" fmt={v=>v+'ct'} onVal={v=>updDev(d.id,'det',v)}/>
                    <Knob val={d.flt} min={200} max={6000} step={10} col={T.col} label="FILTER" fmt={v=>v+'Hz'} onVal={v=>updDev(d.id,'flt',v)} size={30}/>
                    <Knob val={d.atk} min={1} max={200} col="#c08020" label="ATTACK" fmt={v=>v+'ms'} onVal={v=>updDev(d.id,'atk',v)}/>
                    <Knob val={d.rel} min={20} max={800} col="#c08020" label="RELEASE" fmt={v=>v+'ms'} onVal={v=>updDev(d.id,'rel',v)}/>
                    <Knob val={d.drv} min={0} max={100} col="#c06010" label="DRIVE" fmt={v=>v+'%'} onVal={v=>updDev(d.id,'drv',v)} size={30}/>
                    <div style={{ display:'flex',flexDirection:'column',gap:6,paddingLeft:12,borderLeft:`1px solid ${L.border}` }}>
                      <Pill label={d.arp?'ARP ON':'ARP OFF'} active={d.arp} col={T.col} onClick={()=>updDev(d.id,'arp',!d.arp)}/>
                      <Pill label="▶ TEST" active={false} col={T.col} onClick={()=>{ ea(); engine.playRR(noteFreq('E',2),engine.ctx.currentTime,0.5,d); }}/>
                    </div>
                    <div style={{ fontFamily:mono,fontSize:11,fontWeight:700,color:T.col,background:T.col+'12',
                      border:`1px solid ${T.col}40`,padding:'5px 12px',borderRadius:8 }}>
                      {`FM  R=${d.mr.toFixed(1)}  I=${d.mi.toFixed(1)}  DRV=${d.drv}%`}
                    </div>
                  </>}

                  {/* ── ACID BASS ── */}
                  {d.type==='acid' && <>
                    <div style={{ display:'flex',flexDirection:'column',gap:6 }}>
                      <div style={{ fontSize:8,color:L.muted,letterSpacing:1.5 }}>WAVE</div>
                      <div style={{ display:'flex',gap:4 }}>{['sawtooth','square'].map(w =>
                        <Pill key={w} label={w.slice(0,3).toUpperCase()} active={d.wave===w} col={T.col} onClick={()=>updDev(d.id,'wave',w)}/>
                      )}</div>
                      <div style={{ fontSize:8,color:L.muted,letterSpacing:1.5,marginTop:4 }}>OCT</div>
                      <div style={{ display:'flex',gap:4 }}>{[1,2,3].map(o =>
                        <Pill key={o} label={String(o)} active={d.oct===o} col={T.col} onClick={()=>updDev(d.id,'oct',o)}/>
                      )}</div>
                    </div>
                    <Knob val={d.cut} min={50} max={2000} col={T.col} label="CUTOFF" fmt={v=>v+'Hz'} onVal={v=>updDev(d.id,'cut',v)} size={30}/>
                    <Knob val={d.res} min={0} max={100} col={T.col} label="RESONANCE" fmt={v=>v+'%'} onVal={v=>updDev(d.id,'res',v)} size={30}/>
                    <Knob val={d.env} min={0} max={5000} col={T.col} label="ENV MOD" fmt={v=>v+'Hz'} onVal={v=>updDev(d.id,'env',v)}/>
                    <Knob val={d.dec} min={50} max={1000} col={T.col} label="DECAY" fmt={v=>v+'ms'} onVal={v=>updDev(d.id,'dec',v)}/>
                    <Knob val={d.dist} min={0} max={100} col="#c4400f" label="DISTORT" fmt={v=>v+'%'} onVal={v=>updDev(d.id,'dist',v)}/>
                    <div>
                      <div style={{ fontSize:8,color:L.muted,letterSpacing:1.5,marginBottom:6 }}>NOTE</div>
                      <div style={{ display:'flex',gap:3,flexWrap:'wrap',maxWidth:180 }}>{NOTES.map(n =>
                        <Pill key={n} label={n} active={d.note===n} col={T.col}
                          onClick={()=>{ updDev(d.id,'note',n); ea(); playAcid(engine.ctx.currentTime,noteFreq(n,d.oct),{...d,note:n},0.2); }}/>
                      )}</div>
                    </div>
                    <div style={{ display:'flex',flexDirection:'column',gap:6,paddingLeft:12,borderLeft:`1px solid ${L.border}` }}>
                      <Pill label="▶ TEST" active={false} col={T.col} onClick={()=>{ ea(); playAcid(engine.ctx.currentTime,noteFreq(d.note||'A',d.oct||1),d,0.3); }}/>
                    </div>
                  </>}

                  {/* ── SAMPLER NN-8 ── */}
                  {d.type==='samp' && (
                    <div style={{ display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:6,flex:1,maxWidth:480 }}>
                      {d.pads.map((pad,i) => (
                        <div key={i} style={{ display:'flex',flexDirection:'column',gap:3 }}>
                          <div onClick={()=>{ if(pad.buf){ea();engine.playPad(pad.buf,pad.vol,pad.pitch);}else document.getElementById(`pi-${d.id}-${i}`).click(); }}
                            style={{ border:`1.5px solid ${pad.buf?T.col:L.border}`,borderRadius:6,
                              background:pad.buf?T.col+'10':L.panelB,cursor:'pointer',height:56,
                              display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:3,
                              boxShadow:pad.buf?`0 1px 6px ${T.col}25`:L.shadow,transition:'all 0.1s' }}>
                            <div style={{ fontSize:9,color:pad.buf?T.col:L.dim,letterSpacing:1,fontWeight:700 }}>{PAD_KEYS[i]}</div>
                            {pad.buf
                              ? <div style={{ fontSize:9,color:T.col,fontWeight:700,textAlign:'center',padding:'0 4px',
                                  overflow:'hidden',textOverflow:'ellipsis',maxWidth:82,whiteSpace:'nowrap' }}>{pad.name}</div>
                              : <div style={{ fontSize:9,color:L.dim }}>EMPTY</div>
                            }
                            {pad.cloudUrl && <div style={{ fontSize:7,color:T.col+'80' }}>☁</div>}
                          </div>
                          {pad.buf && (
                            <div style={{ display:'flex',gap:3 }}>
                              <button onClick={()=>document.getElementById(`pi-${d.id}-${i}`).click()}
                                style={{ flex:1,fontSize:8,padding:'3px 0',background:'transparent',
                                  border:`1px solid ${L.border}`,borderRadius:4,cursor:'pointer',color:L.muted,fontFamily:mono }}>LOAD</button>
                              <button onClick={()=>{ const np=[...d.pads]; np[i]={name:`PAD ${i+1}`,buf:null,vol:100,pitch:0,cloudUrl:null}; updDev(d.id,'pads',np); }}
                                style={{ fontSize:8,padding:'3px 7px',background:'transparent',
                                  border:`1px solid #c4400f`,borderRadius:4,cursor:'pointer',color:'#c4400f',fontFamily:mono }}>✕</button>
                            </div>
                          )}
                          <input id={`pi-${d.id}-${i}`} type="file" accept="audio/*" style={{ display:'none' }}
                            onChange={e=>e.target.files[0]&&loadPad(d.id,i,e.target.files[0])}/>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* ── REVERB UNIT ── */}
                  {d.type==='rv' && <>
                    <div style={{ display:'flex',flexDirection:'column',gap:6 }}>
                      <div style={{ fontSize:8,color:L.muted,letterSpacing:1.5 }}>ROOM TYPE</div>
                      <div style={{ display:'flex',gap:4,flexWrap:'wrap' }}>
                        {ROOM_TYPES.map(r => (
                          <Pill key={r} label={r.toUpperCase()} active={d.room===r} col={T.col}
                            onClick={()=>updDev(d.id,'room',r)}/>
                        ))}
                      </div>
                      <div style={{ fontSize:9,color:T.col+'80',marginTop:2 }}>
                        {d.room==='hall'  && 'Concert hall — smooth diffuse tail'}
                        {d.room==='room'  && 'Small room — dense early reflections'}
                        {d.room==='plate' && 'Steel plate — shimmery metallic'}
                        {d.room==='cath'  && 'Cathedral — enormous, airy'}
                        {d.room==='spring'&& 'Spring — boingy retro wobble'}
                      </div>
                    </div>
                    <Knob val={d.preDly} min={0} max={100} col={T.col} label="PRE-DLY" fmt={v=>v+'ms'} onVal={v=>updDev(d.id,'preDly',v)}/>
                    <Knob val={d.decay}  min={0.5} max={8} step={0.1} col={T.col} label="DECAY" fmt={v=>v.toFixed(1)+'s'} onVal={v=>updDev(d.id,'decay',v)} size={30}/>
                    <Knob val={d.damp}   min={0} max={100} col={T.col} label="DAMP" fmt={v=>v+'%'} onVal={v=>updDev(d.id,'damp',v)}/>
                    <Knob val={d.mix}    min={0} max={100} col={T.col} label="MIX" fmt={v=>v+'%'}
                      onVal={v=>{ updDev(d.id,'mix',v); setFxRvW(v); }} size={30}/>
                    <div style={{ fontFamily:mono,fontSize:11,fontWeight:700,color:T.col,
                      background:T.col+'10',border:`1px solid ${T.col}40`,padding:'6px 14px',borderRadius:8 }}>
                      {d.room.toUpperCase()} · {d.decay.toFixed(1)}s · {d.damp}% DAMP
                    </div>
                    <div style={{ fontSize:9,color:L.dim,maxWidth:160,lineHeight:1.4 }}>
                      Uses master convolution reverb. Mix knob also sets FX Rack reverb send.
                    </div>
                  </>}

                </div>
              )}
            </RackUnit>
          );
        })}

        {/* FX RACK */}
        <RackUnit>
          <DevHeader label="FX Rack" subtitle="Post-master · Dist · Delay · Reverb" col="#5a3a9a" open={open.fx} onToggle={()=>setOpen(o=>({...o,fx:!o.fx}))}/>
          {open.fx && (
            <div style={{ display:'flex',alignItems:'center',padding:'10px 12px',gap:16,
              borderLeft:'4px solid #5a3a9a',background:L.panelB,flexWrap:'wrap' }}>
              <Knob val={fxDist}  min={0} max={100} col="#993556" label="DISTORT"  fmt={v=>v+'%'}               onVal={setFxDist}/>
              <Knob val={fxDlyT}  min={5} max={100} col="#1566a8" label="DLY TIME" fmt={v=>(v/100).toFixed(2)+'s'} onVal={setFxDlyT}/>
              <Knob val={fxDlyFb} min={0} max={85}  col="#1566a8" label="DLY FB"   fmt={v=>v+'%'}               onVal={setFxDlyFb}/>
              <Knob val={fxDlyW}  min={0} max={100} col="#1566a8" label="DLY MIX"  fmt={v=>v+'%'}               onVal={setFxDlyW}/>
              <Knob val={fxRvW}   min={0} max={100} col="#5a3a9a" label="REVERB"   fmt={v=>v+'%'}               onVal={setFxRvW} size={30}/>
            </div>
          )}
        </RackUnit>

      </div>{/* /rack */}

      {/* ── MIDI SEQUENCER ── */}
      <div style={{ height:220,flexShrink:0,background:L.panel,borderTop:`2px solid ${L.border}`,display:'flex',flexDirection:'column',userSelect:'none' }}>
        <div style={{ height:32,background:L.panelB,borderBottom:`1px solid ${L.border}`,display:'flex',alignItems:'center',padding:'0 12px',gap:10,flexShrink:0 }}>
          <span style={{ fontSize:9,letterSpacing:2.5,color:L.muted,fontWeight:700 }}>◈ MIDI SEQUENCER</span>
          <span style={{ fontSize:8,color:L.dim }}>Click & drag note blocks to extend length · Click pitched track name to open piano roll</span>
          <div style={{ marginLeft:'auto',display:'flex',gap:10,alignItems:'center' }}>
            <span style={{ fontSize:8,color:L.dim }}>LEN:</span>
            <input type="number" min={1} max={128} value={seqLen} onChange={e=>updateSeqLen(+e.target.value)}
              style={{ width:40,height:22,fontSize:10,background:L.panel,border:`1px solid ${L.border}`,
                borderRadius:3,textAlign:'center',color:L.text }}/>
            <span style={{ fontSize:8,color:L.dim }}>STEPS/BEAT:</span>
            <input type="number" min={1} max={16} value={stepsPerBeat} onChange={e=>setStepsPerBeat(Math.max(1,Math.min(16,+e.target.value)))}
              style={{ width:30,height:22,fontSize:10,background:L.panel,border:`1px solid ${L.border}`,
                borderRadius:3,textAlign:'center',color:L.text }}/>
          </div>
        </div>

        {/* Ruler */}
        <div style={{ height:15,background:'#f8f7f4',borderBottom:`1px solid ${L.border}`,display:'flex',flexShrink:0 }}>
          <div style={{ width:128,flexShrink:0,borderRight:`1px solid ${L.border}` }}/>
          <div className="seq-scroll" style={{ flex:1,display:'flex',alignItems:'center',padding:'0 3px',gap:2,overflowX:'auto' }}>
            {Array(seqLen).fill(0).map((_,i) => (
              <div key={i} style={{ flex:'0 0 28px',display:'flex',alignItems:'center' }}>
                {i>0&&i%stepsPerBeat===0 && <div style={{ width:1,height:9,background:L.borderHi,flexShrink:0 }}/>}
                <div style={{ flex:1,fontSize:7,color:i%stepsPerBeat===0?L.muted:L.dim,
                  fontWeight:i%stepsPerBeat===0?700:400,textAlign:'center' }}>
                  {i%stepsPerBeat===0?Math.floor(i/stepsPerBeat)+1:i+1}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Track rows */}
        <div style={{ flex:1,overflowY:'auto' }}>
          {seqTracks.map(track => {
            let coveredUntil = -1;
            return (
              <div key={track.id} style={{ height:26,display:'flex',borderBottom:`1px solid #f0ede8` }}>
                {/* Track label */}
                <div onClick={()=>track.pitched&&setPianoRoll({trackId:track.id,highlightStep:null})}
                  style={{ width:128,flexShrink:0,display:'flex',alignItems:'center',gap:5,padding:'0 8px',
                    borderRight:`1px solid ${L.border}`,cursor:track.pitched?'pointer':'default',
                    background:'transparent' }}>
                  <div style={{ width:3,height:14,borderRadius:2,background:track.col,flexShrink:0 }}/>
                  <div style={{ fontSize:8,letterSpacing:1,color:L.muted,textTransform:'uppercase',flex:1,
                    whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis' }}>{track.name}</div>
                  {track.pitched && <span style={{ fontSize:8,color:track.col,opacity:0.5 }}>𝄞</span>}
                </div>

                {/* Step cells */}
                <div className="seq-scroll"
                  style={{ flex:1,display:'flex',alignItems:'center',padding:'0 3px',gap:2,overflowX:'auto' }}
                  onScroll={e=>{ document.querySelectorAll('.seq-scroll').forEach(s=>{if(s!==e.target)s.scrollLeft=e.target.scrollLeft;}); }}>
                  {Array(seqLen).fill(0).map((_,si) => {
                    const val     = seq[track.id]?.[si];
                    const on      = val != null && val !== false;
                    const covered = si < coveredUntil;
                    let label = ''; let len = 1;
                    if (on && !covered) {
                      if (track.pitched==='pad')          label = `P${(val||0)+1}`;
                      else if (track.pitched && val?.note){ label = val.note+val.oct; len = Math.min(val.len||1, seqLen-si); }
                      if (len > 1) coveredUntil = si + len;
                    }
                    const isPlaying = step >= si && step < si + len;
                    return (
                      <div key={si}
                        onMouseEnter={()=>{
                          if (!dragState||dragState.trackId!==track.id) return;
                          const newLen = Math.max(1, si - dragState.startSi + 1);
                          setDragState(p=>({...p,hasDragged:true}));
                          setSeq(prev=>{
                            const n={...prev,[track.id]:[...prev[track.id]]};
                            const cur=n[track.id][dragState.startSi];
                            if (!cur) return n;
                            n[track.id][dragState.startSi]={...cur,len:newLen};
                            for(let x=dragState.startSi+1;x<dragState.startSi+newLen;x++) n[track.id][x]=null;
                            return n;
                          });
                        }}
                        style={{ flex:'0 0 28px',display:'flex',alignItems:'center',position:'relative' }}>
                        {si>0&&si%stepsPerBeat===0 && <div style={{ position:'absolute',left:-2,width:1,height:14,background:L.borderHi,zIndex:1 }}/>}
                        {/* Base empty cell */}
                        <div onClick={()=>!covered&&toggleStep(track.id,si)}
                          style={{ width:'100%',height:20,borderRadius:3,cursor:'pointer',
                            border:`1px solid ${L.border}`,
                            background:si===step?'#fffbe6':'transparent',
                            outline:si===step?`2px solid ${track.col}60`:'none',outlineOffset:-2 }}/>
                        {/* Note block */}
                        {on && !covered && (
                          <div
                            onMouseDown={e=>{e.stopPropagation();setDragState({trackId:track.id,startSi:si,hasDragged:false});}}
                            style={{ position:'absolute',left:0,top:'50%',transform:'translateY(-50%)',
                              height:20,width:len*28+(len-1)*2,borderRadius:3,cursor:'ew-resize',zIndex:2,
                              border:`1px solid ${isPlaying?track.col:track.col+'70'}`,
                              background:isPlaying?track.col+'55':track.col+'28',
                              display:'flex',alignItems:'center',justifyContent:'center',
                              fontSize:7,color:track.col,fontWeight:700,letterSpacing:0.5,
                              boxShadow:`0 1px 6px ${track.col}25` }}>
                            {label}
                            {track.pitched && track.pitched!=='pad' && len<=2 && (
                              <div style={{ position:'absolute',right:2,top:3,bottom:3,width:3,
                                background:track.col,opacity:0.4,borderRadius:2 }}/>
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
      {pianoRoll && (() => {
        const dev = devices.find(d => d.id === pianoRoll.trackId);
        if (!dev) return null;
        const T = DEVICE_TYPES[dev.type];
        return (
          <PianoRoll
            trackDef={{ ...T, name:T.name }}
            seqData={seq[pianoRoll.trackId] || Array(seqLen).fill(null)}
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
