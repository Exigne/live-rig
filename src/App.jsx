/**
 * App.jsx — Live Rig Performance Suite
 * Dynamic Rack · Acid Bass · Horizontal Scrolling Sequencer · JSON State
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

const MIX_CH = [
  { key:'drums',  name:'DRUMS',  col:'#c4400f' },
  { key:'synth',  name:'SYNTH',  col:'#1566a8' },
  { key:'rr',     name:'RR FM',  col:'#8a6500' },
  { key:'samp',   name:'SAMP',   col:'#1a7a3a' },
  { key:'master', name:'MASTER', col:'#5050a0' },
];

const L = {
  bg: '#f2efe9', 
  panel: '#ffffff', 
  panelB: '#f8f7f4', 
  border: '#e2dfd8', 
  borderHi: '#ccc9c0',
  text: '#1a1716', 
  muted: '#7a7570', 
  dim: '#b0aba5', 
  accent: '#e8950a', 
  shadow: '0 1px 4px rgba(0,0,0,0.08), 0 4px 16px rgba(0,0,0,0.04)',
};

// ─── DYNAMIC DEVICE DEFINITIONS ───────────────────────────────────────────────
const DEVICE_TYPES = {
  poly: { 
    name: 'POLY SYNTH', col: '#1566a8', pitched: true,  
    def: { wave: 'sawtooth', atk: 20, rel: 600, flt: 2000 } 
  },
  rr:   { 
    name: 'ROAD RASH',  col: '#8a6500', pitched: true,  
    def: { mr: 1.0, mi: 3.5, det: 18, flt: 1800, atk: 5, rel: 180, drv: 70, arp: true } 
  },
  acid: { 
    name: 'ACID BASS',  col: '#8db600', pitched: true,  
    def: { wave: 'sawtooth', cut: 400, res: 80, env: 3000, dec: 250, dist: 60 } 
  },
  samp: { 
    name: 'SAMPLER',    col: '#1a7a3a', pitched: 'pad', 
    def: { pads: Array(8).fill(null).map((_,i) => ({ name:`PAD ${i+1}`, buf:null, vol:100, pitch:0, cloudUrl:null })) } 
  }
};

const mkMix = () => ({
  drums:  { vol:80, pan:0, mute:false, solo:false },
  synth:  { vol:75, pan:0, mute:false, solo:false },
  rr:     { vol:70, pan:0, mute:false, solo:false },
  samp:   { vol:80, pan:0, mute:false, solo:false },
  master: { vol:85, pan:0 },
});

const engine = new AudioEngine();
const mono = "'JetBrains Mono','Fira Code','Courier New',monospace";

// ─── UI COMPONENTS ─────────────────────────────────────────────────────────────
function Screw() { 
  return (
    <div style={{ 
      width:10, height:10, borderRadius:'50%', flexShrink:0, 
      background:'radial-gradient(circle at 35% 30%,#d0cdc8,#a0a09a)', 
      border:'1px solid #c0bdb8', position:'relative' 
    }}>
      <div style={{ position:'absolute', inset:0, display:'flex', alignItems:'center', justifyContent:'center' }}>
        <div style={{ width:'65%', height:1, background:'rgba(0,0,0,0.25)', position:'absolute' }} />
        <div style={{ width:1, height:'65%', background:'rgba(0,0,0,0.15)', position:'absolute' }} />
      </div>
    </div>
  ); 
}

function Ear({ side }) { 
  return (
    <div style={{ 
      width:22, flexShrink:0, 
      background: side==='left' ? 'linear-gradient(to right,#e0ddd8,#eae7e2)' : 'linear-gradient(to left,#e0ddd8,#eae7e2)', 
      borderLeft: side==='left' ? `1px solid ${L.borderHi}` : 'none', 
      borderRight: side==='right' ? `1px solid ${L.borderHi}` : 'none', 
      display:'flex', flexDirection:'column', alignItems:'center', 
      justifyContent:'space-around', padding:'5px 0' 
    }}>
      <Screw /><Screw /><Screw />
    </div>
  ); 
}

function DevHeader({ label, subtitle, col, open, onToggle, onRemove }) {
  return (
    <div style={{ 
      height:26, padding:'0 12px', display:'flex', alignItems:'center', gap:10, 
      borderBottom:`1px solid ${L.border}`, background:L.panel, userSelect:'none', 
      borderLeft:`4px solid ${col}` 
    }}>
      <div onClick={onToggle} style={{ flex:1, display:'flex', alignItems:'center', gap:10, cursor:'pointer' }}>
        <div style={{ width:7, height:7, borderRadius:'50%', background:col, flexShrink:0, boxShadow:`0 0 4px ${col}80` }} />
        <span style={{ fontSize:10, fontWeight:700, letterSpacing:2, color:L.text, textTransform:'uppercase' }}>{label}</span>
        {subtitle && <span style={{ fontSize:9, color:L.muted, letterSpacing:1 }}>{subtitle}</span>}
        <span style={{ marginLeft:'auto', fontSize:9, color:L.dim, marginRight: 10 }}>{open ? '▼' : '►'}</span>
      </div>
      {onRemove && (
        <button onClick={onRemove} style={{ background:'transparent', border:'none', color:'#c4400f', fontSize:14, cursor:'pointer' }}>
          ✕
        </button>
      )}
    </div>
  );
}

function RackUnit({ children, col='#888' }) { 
  return (
    <div style={{ 
      display:'flex', flexShrink:0, border:`1px solid ${L.border}`, 
      borderRadius:4, overflow:'hidden', boxShadow:L.shadow, marginBottom:4 
    }}>
      <Ear side="left" />
      <div style={{ flex:1, background:L.panel, minWidth:0 }}>{children}</div>
      <Ear side="right" />
    </div>
  ); 
}

function Knob({ val, min, max, step=1, col, label, fmt, onVal, size=26 }) {
  const dragging = useRef(false), startY = useRef(0), startV = useRef(val);
  const pct = (val - min) / (max - min); 
  const ang = -145 + pct * 290;
  
  useEffect(() => {
    const mv = e => { 
      if (!dragging.current) return; 
      let nv = startV.current + ((startY.current - e.clientY) / 130) * (max - min); 
      nv = Math.max(min, Math.min(max, Math.round(nv / step) * step)); 
      onVal(nv); 
    };
    const up = () => { dragging.current = false; }; 
    window.addEventListener('mousemove', mv); 
    window.addEventListener('mouseup', up); 
    return () => { window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up); };
  }, [min, max, step, onVal]);
  
  return (
    <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:3, flexShrink:0 }}>
      <div onMouseDown={e => { dragging.current=true; startY.current=e.clientY; startV.current=val; e.preventDefault(); }} 
        style={{ 
          width:size, height:size, borderRadius:'50%', cursor:'ns-resize', 
          background:`radial-gradient(circle at 40% 35%, #fff, ${col}22)`, 
          border:`2px solid ${col}55`, 
          boxShadow:`0 2px 6px rgba(0,0,0,0.12), inset 0 1px 2px rgba(255,255,255,0.8)`, 
          position:'relative' 
        }}>
        <div style={{ 
          position:'absolute', top:'14%', left:'50%', width:2, height:'28%', 
          background:col, borderRadius:2, transformOrigin:'bottom center', 
          transform:`translateX(-50%) rotate(${ang}deg)`, boxShadow:`0 0 3px ${col}80` 
        }} />
      </div>
      <div style={{ fontSize:7, color:L.muted, letterSpacing:0.5, textTransform:'uppercase', whiteSpace:'nowrap' }}>{label}</div>
      <div style={{ fontSize:8, color:col, fontFamily:mono, fontWeight:700 }}>{fmt ? fmt(val) : val}</div>
    </div>
  );
}

function Pill({ label, active, col, onClick }) { 
  return (
    <button onClick={onClick} style={{ 
      fontFamily:mono, fontSize:9, letterSpacing:1, textTransform:'uppercase', 
      padding:'4px 10px', borderRadius:20, cursor:'pointer', 
      border:`1.5px solid ${active ? col : L.border}`, background: active ? col : L.panel, 
      color: active ? '#fff' : L.muted, fontWeight: active ? 700 : 400, transition:'all 0.12s' 
    }}>
      {label}
    </button>
  ); 
}

// ─── APP ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [authed, setAuthed] = useState(false);
  const [token, setToken] = useState(() => localStorage.getItem('lr_token') || '');
  const [loginU, setLoginU] = useState(''); 
  const [loginP, setLoginP] = useState('');
  const [loginErr, setLoginErr] = useState(''); 
  const [loginMode, setLoginMode] = useState('login');
  const [authLoading, setAuthLoading] = useState(false);

  // Timing
  const [playing, setPlaying] = useState(false);
  const [bpm, setBpmS] = useState(120);
  const [step, setStep] = useState(-1);
  const [seqLen, setSeqLen] = useState(16);
  const [stepsPerBeat, setStepsPerBeat] = useState(4);

  // Dynamic Devices & Sequence State
  const [devices, setDevices] = useState([
    { id: 'poly-1', type: 'poly', note: 'A', oct: 4, ...DEVICE_TYPES.poly.def },
    { id: 'rr-1',   type: 'rr',   ...DEVICE_TYPES.rr.def },
    { id: 'samp-1', type: 'samp', ...DEVICE_TYPES.samp.def }
  ]);
  
  const [seq, setSeq] = useState(() => {
    const s = { 
      kick:  Array(16).fill(false).map((_,i) => [1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0][i%16]===1),
      snare: Array(16).fill(false).map((_,i) => [0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0][i%16]===1),
      hh:    Array(16).fill(false).map((_,i) => [1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0][i%16]===1),
      bass:  Array(16).fill(false).map((_,i) => [1,0,0,0,0,0,1,0,0,0,1,0,0,0,0,0][i%16]===1)
    };
    ['poly-1', 'rr-1', 'samp-1'].forEach(id => s[id] = Array(16).fill(null));
    return s;
  });

  const [mx, setMx] = useState(mkMix());
  const [fxDist, setFxDist] = useState(0); 
  const [fxDlyT, setFxDlyT] = useState(30); 
  const [fxDlyFb, setFxDlyFb] = useState(25); 
  const [fxDlyW, setFxDlyW] = useState(0); 
  const [fxRvW, setFxRvW] = useState(0);
  const [open, setOpen] = useState({ mix:true, drum:true, fx:false });
  const [pianoRoll, setPianoRoll] = useState(null); 

  const [songs, setSongs] = useState([]); 
  const [showSongs, setShowSongs] = useState(false); 
  const [songName, setSongName] = useState('New Song'); 
  const [activeSong, setActiveSong] = useState(null); 
  const [songLoading, setSongLoading] = useState(false); 
  const [songMsg, setSongMsg] = useState('');

  // ── Scheduler refs ──
  const schedRef = useRef(null); 
  const stepRef = useRef(0); 
  const nextTRef = useRef(0);
  
  const bpmRef = useRef(bpm); 
  const seqRef = useRef(seq); 
  const seqLenRef = useRef(seqLen); 
  const stepsPerBeatRef = useRef(stepsPerBeat); 
  const devicesRef = useRef(devices);
  
  bpmRef.current = bpm; 
  seqRef.current = seq; 
  seqLenRef.current = seqLen; 
  stepsPerBeatRef.current = stepsPerBeat; 
  devicesRef.current = devices;

  const ea = useCallback(() => { engine.init(); engine.resume(); }, []);

  useEffect(() => { engine.applyMixer(mx); }, [mx]);
  useEffect(() => { engine.applyFX({ dist:fxDist, dlyT:fxDlyT, dlyFb:fxDlyFb, dlyW:fxDlyW, rvW:fxRvW }); }, [fxDist,fxDlyT,fxDlyFb,fxDlyW,fxRvW]);

  // Auth & API
  useEffect(() => { 
    if (!token) return; 
    authAPI.verify(token).then(() => setAuthed(true)).catch(() => { localStorage.removeItem('lr_token'); setToken(''); }); 
  }, []);
  
  useEffect(() => { 
    if (!authed || !token) return; 
    songsAPI.list(token).then(data => setSongs(data.songs || [])).catch(() => {}); 
  }, [authed, token]);
  
  const doAuth = async () => { 
    setAuthLoading(true); setLoginErr(''); 
    try { 
      const fn = loginMode === 'login' ? authAPI.login : authAPI.register; 
      const { token: t } = await fn(loginU, loginP); 
      localStorage.setItem('lr_token', t); setToken(t); setAuthed(true); 
    } catch(e) { 
      setLoginErr(e.message); 
    } finally { 
      setAuthLoading(false); 
    } 
  };

  // ── NEW ACID BASS SYNTH ENGINE (Inline) ──
  const playAcid = useCallback((t, freq, d) => {
    const osc = engine.ctx.createOscillator(); 
    osc.type = d.wave; 
    osc.frequency.setValueAtTime(freq, t);
    
    const flt = engine.ctx.createBiquadFilter(); 
    flt.type = 'lowpass'; 
    flt.Q.value = (d.res / 100) * 25; 
    flt.frequency.setValueAtTime(d.cut + d.env, t); 
    flt.frequency.exponentialRampToValueAtTime(Math.max(40, d.cut), t + (d.dec/1000));
    
    // Internal Distortion curve
    const shaper = engine.ctx.createWaveShaper(); 
    const curve = new Float32Array(400); 
    const k = d.dist; 
    const deg = Math.PI / 180;
    for(let i=0; i<400; i++) { 
      const x = i * 2 / 400 - 1; 
      curve[i] = ( 3 + k ) * x * 20 * deg / ( Math.PI + k * Math.abs(x) ); 
    }
    shaper.curve = curve;
    
    const vca = engine.ctx.createGain(); 
    vca.gain.setValueAtTime(0, t); 
    vca.gain.linearRampToValueAtTime(0.6, t + 0.01); 
    vca.gain.exponentialRampToValueAtTime(0.001, t + (d.dec/1000));
    
    osc.connect(flt); 
    flt.connect(shaper); 
    shaper.connect(vca); 
    vca.connect(engine.ctx.destination);
    
    osc.start(t); 
    osc.stop(t + (d.dec/1000) + 0.1);
  }, []);

  // ── Scheduler ──
  const schedStep = useCallback((s, t) => {
    const q = seqRef.current; 
    const spb = (60 / bpmRef.current) / stepsPerBeatRef.current;
    
    // Fixed Drums
    if (q.kick[s])  engine.playKick(t);
    if (q.snare[s]) engine.playSnare(t);
    if (q.hh[s])    engine.playHH(t);
    if (q.bass[s])  engine.playBass(t, 82 + (s % 8) * 3);
    
    // Dynamic Devices
    devicesRef.current.forEach(d => {
      const noteObj = q[d.id]?.[s];
      if (!noteObj && d.type !== 'samp') return;
      
      if (d.type === 'poly') {
        engine.playSynth({ freq:noteFreq(noteObj.note, noteObj.oct), wave:d.wave, atk:d.atk/1000, rel:d.rel/1000, filter:d.flt });
      } else if (d.type === 'rr' && d.arp) {
        engine.playRR(noteFreq(noteObj.note, noteObj.oct), t, spb * 0.85, d);
      } else if (d.type === 'acid') {
        playAcid(t, noteFreq(noteObj.note, noteObj.oct), d);
      } else if (d.type === 'samp' && noteObj != null) {
        const pad = d.pads[noteObj]; 
        if (pad?.buf) engine.playPad(pad.buf, pad.vol, pad.pitch);
      }
    });
  }, [playAcid]);

  const startSeq = useCallback(() => {
    ea(); 
    stepRef.current=0; 
    nextTRef.current = engine.ctx.currentTime + 0.05;
    
    const tick = () => {
      while (nextTRef.current < engine.ctx.currentTime + 0.12) {
        const s = stepRef.current; 
        schedStep(s, nextTRef.current);
        
        setTimeout(() => setStep(s), Math.max(0, (nextTRef.current - engine.ctx.currentTime) * 1000));
        
        nextTRef.current += (60 / bpmRef.current) / stepsPerBeatRef.current;
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

  // Keyboard Sampler (binds to first sampler found)
  useEffect(() => {
    const onKey = e => {
      if (e.target.tagName === 'INPUT') return;
      if (e.key === ' ') { e.preventDefault(); ea(); setPlaying(p => !p); return; }
      
      const i = PAD_KEYS.indexOf(e.key.toUpperCase());
      if (i >= 0) {
        const samp = devices.find(d => d.type === 'samp');
        if (samp && samp.pads[i].buf) { 
          ea(); 
          engine.playPad(samp.pads[i].buf, samp.pads[i].vol, samp.pads[i].pitch); 
        }
      }
    };
    window.addEventListener('keydown', onKey); 
    return () => window.removeEventListener('keydown', onKey);
  }, [devices, ea]);

  // ── Device & Seq Management ──
  const updDev = (id, field, val) => {
    setDevices(prev => prev.map(d => d.id === id ? { ...d, [field]: val } : d));
  };
  
  const addDevice = (type) => {
    const id = `${type}-${Date.now()}`;
    setDevices(prev => [...prev, { id, type, note: 'A', oct: 4, ...DEVICE_TYPES[type].def }]);
    setSeq(prev => ({ ...prev, [id]: Array(seqLen).fill(null) }));
    setOpen(prev => ({ ...prev, [id]: true }));
  };

  const removeDevice = (id) => {
    setDevices(prev => prev.filter(d => d.id !== id));
    setSeq(prev => { 
      const n = {...prev}; 
      delete n[id]; 
      return n; 
    });
  };

  const handleUpdateSeqLen = (newLen) => {
    const len = Math.max(1, Math.min(128, newLen)); 
    setSeqLen(len);
    setSeq(prev => {
      const next = {};
      for (let k in prev) {
        if (prev[k].length >= len) {
          next[k] = prev[k].slice(0, len);
        } else {
          next[k] = [...prev[k], ...Array(len - prev[k].length).fill(DRUM_IDS.includes(k) ? false : null)];
        }
      } 
      return next;
    });
  };

  const toggleStep = useCallback((trackId, si) => {
    const isDrum = DRUM_IDS.includes(trackId);
    const track = isDrum ? { pitched: false } : DEVICE_TYPES[devices.find(d => d.id === trackId).type];
    
    if (track.pitched && track.pitched !== 'pad') {
      setPianoRoll({ trackId, highlightStep: si }); 
      return;
    }
    
    ea();
    setSeq(prev => {
      const next = { ...prev, [trackId]: [...prev[trackId]] };
      if (track.pitched === 'pad') {
        next[trackId][si] = prev[trackId][si] == null ? 0 : prev[trackId][si] < 7 ? prev[trackId][si] + 1 : null;
      } else {
        next[trackId][si] = !prev[trackId][si];
        if (next[trackId][si]) {
          if (trackId==='kick') engine.playKick(engine.ctx.currentTime); 
          if (trackId==='snare') engine.playSnare(engine.ctx.currentTime);
          if (trackId==='hh') engine.playHH(engine.ctx.currentTime);     
          if (trackId==='bass') engine.playBass(engine.ctx.currentTime);
        }
      } 
      return next;
    });
  }, [ea, devices]);

  const loadPad = async (deviceId, padIdx, file) => {
    ea(); 
    const buf = await engine.ctx.decodeAudioData(await file.arrayBuffer());
    setDevices(prev => prev.map(d => {
      if (d.id !== deviceId) return d;
      const newPads = [...d.pads];
      newPads[padIdx] = { ...newPads[padIdx], buf, name: file.name.replace(/\.[^.]+$/,'').slice(0,14) };
      return { ...d, pads: newPads };
    }));
  };

  // ── Saving & Loading ──
  const captureState = () => ({
    bpm, seqLen, stepsPerBeat, seq, mx, 
    fx: { dist:fxDist, dlyT:fxDlyT, dlyFb:fxDlyFb, dlyW:fxDlyW, rvW:fxRvW },
    devices: devices.map(d => {
      if (d.type !== 'samp') return d;
      return { ...d, pads: d.pads.map(p => ({ name:p.name, vol:p.vol, pitch:p.pitch, cloudUrl:p.cloudUrl })) };
    })
  });

  const applyState = async (s) => {
    setBpmS(s.bpm); 
    setSeqLen(s.seqLen || 16); 
    setStepsPerBeat(s.stepsPerBeat || 4);
    setMx(s.mx); 
    setFxDist(s.fx.dist); 
    setFxDlyT(s.fx.dlyT); 
    setFxDlyFb(s.fx.dlyFb); 
    setFxDlyW(s.fx.dlyW); 
    setFxRvW(s.fx.rvW);
    ea();
    
    // Handle Legacy Saves seamlessly
    let loadedDevices = s.devices;
    if (!loadedDevices) {
      loadedDevices = [
        { id: 'poly-1', type: 'poly', note: 'A', oct: 4, wave: s.synth.wave, atk: s.synth.atk, rel: s.synth.rel, flt: s.synth.flt },
        { id: 'rr-1',   type: 'rr',   ...s.rr },
        { id: 'samp-1', type: 'samp', pads: s.pads }
      ];
      s.seq = { kick: s.seq.kick, snare: s.seq.snare, hh: s.seq.hh, bass: s.seq.bass, 'poly-1': s.seq.synth, 'rr-1': s.seq.rr, 'samp-1': s.seq.samp };
    }

    // Fetch Audio Buffers for all samplers
    const hydratedDevices = await Promise.all(loadedDevices.map(async (d) => {
      if (d.type !== 'samp') return d;
      const newPads = await Promise.all(d.pads.map(async (p) => {
        if (!p.cloudUrl) return { ...p, buf: null };
        try { 
          const buf = await cloudinary.fetchPad(engine.ctx, p.cloudUrl); 
          return { ...p, buf }; 
        } catch { 
          return { ...p, buf: null }; 
        }
      }));
      return { ...d, pads: newPads };
    }));
    
    setDevices(hydratedDevices);
    setSeq(s.seq);
  };

  const saveSong = async () => {
    if (!token || !songName.trim()) return; 
    setSongLoading(true); setSongMsg('');
    try {
      // Upload pads for all samplers
      const safeDevices = await Promise.all(devices.map(async (d) => {
        if (d.type !== 'samp') return d;
        const newPads = await Promise.all(d.pads.map(async (p, i) => {
          if (!p.buf || p.cloudUrl) return p;
          const { url } = await cloudinary.uploadPad(token, p.buf, p.name || `pad-${i}`);
          return { ...p, cloudUrl: url };
        }));
        return { ...d, pads: newPads };
      }));
      setDevices(safeDevices);
      
      const state = { 
        ...captureState(), 
        devices: safeDevices.map(d => d.type === 'samp' 
          ? { ...d, pads: d.pads.map(p => ({ name:p.name, vol:p.vol, pitch:p.pitch, cloudUrl:p.cloudUrl })) } 
          : d) 
      };
      
      const result = activeSong 
        ? await songsAPI.update(token, activeSong.id, songName, state) 
        : await songsAPI.save(token, songName, state);
        
      setActiveSong(result.song); 
      setSongs(prev => { 
        const idx = prev.findIndex(s => s.id === result.song.id); 
        return idx >= 0 ? prev.map((s,i) => i===idx ? result.song : s) : [...prev, result.song]; 
      }); 
      setSongMsg('✓ Saved');
    } catch(e) { 
      setSongMsg('Error: ' + e.message); 
    } finally { 
      setSongLoading(false); 
      setTimeout(() => setSongMsg(''), 3000); 
    }
  };

  const loadSong = async (song) => { 
    setSongLoading(true); 
    try { 
      await applyState(song.state); 
      setActiveSong(song); 
      setSongName(song.name); 
      setShowSongs(false); 
    } catch(e) { 
      setSongMsg('Load error: ' + e.message); 
    } finally { 
      setSongLoading(false); 
    } 
  };
  
  const deleteSong = async (id) => { 
    try { 
      await songsAPI.delete(token, id); 
      setSongs(prev => prev.filter(s => s.id !== id)); 
      if (activeSong?.id === id) setActiveSong(null); 
    } catch(e) { 
      setSongMsg('Delete error: ' + e.message); 
    } 
  };

  if (!authed) return (
    <div style={{ minHeight:'100vh', background:L.bg, display:'flex', alignItems:'center', justifyContent:'center', fontFamily:mono }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&display=swap');*{box-sizing:border-box;margin:0;padding:0}input{outline:none;font-family:inherit}`}</style>
      <div style={{ width:360, background:L.panel, borderRadius:12, boxShadow:'0 8px 48px rgba(0,0,0,0.12)', overflow:'hidden' }}>
        <div style={{ height:6, background:'linear-gradient(to right,#c4400f,#1566a8,#1a7a3a)' }} />
        <div style={{ padding:'36px 40px' }}>
          <div style={{ fontSize:10, color:L.muted, letterSpacing:3, marginBottom:8 }}>◆ LIVE RIG</div>
          <div style={{ fontSize:24, fontWeight:700, letterSpacing:1, color:L.text, marginBottom:6 }}>{loginMode === 'login' ? 'Sign In' : 'Create Account'}</div>
          
          {['Username','Password'].map((ph,i) => (
            <input 
              key={ph} type={i===1?'password':'text'} placeholder={ph} 
              value={i===0?loginU:loginP} 
              onChange={e => i===0?setLoginU(e.target.value):setLoginP(e.target.value)} 
              onKeyDown={e => e.key==='Enter' && doAuth()} 
              style={{ display:'block', width:'100%', padding:'11px 14px', marginBottom:12, border:`1.5px solid ${L.border}`, borderRadius:8, fontSize:13, color:L.text, background:L.panelB }} 
            />
          ))}
          
          {loginErr && <div style={{ fontSize:11, color:'#c4400f', marginBottom:12, padding:'8px 12px', background:'#fef2ee', borderRadius:6 }}>{loginErr}</div>}
          
          <button onClick={doAuth} disabled={authLoading} style={{ width:'100%', padding:'13px', fontSize:13, fontWeight:700, letterSpacing:2, background:'#1a1716', color:'#fff', border:'none', borderRadius:8, cursor:'pointer', fontFamily:mono, opacity:authLoading?0.6:1 }}>
            {authLoading ? '…' : loginMode==='login' ? 'SIGN IN' : 'CREATE ACCOUNT'}
          </button>
          
          <div style={{ textAlign:'center', marginTop:20, fontSize:11, color:L.muted }}>
            <span onClick={() => { setLoginMode(m => m==='login'?'register':'login'); setLoginErr(''); }} style={{ color:'#1566a8', cursor:'pointer', fontWeight:700 }}>
              {loginMode==='login' ? 'Create one' : 'Sign in'}
            </span>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div style={{ height:'100vh', display:'flex', flexDirection:'column', background:L.bg, fontFamily:mono, color:L.text, overflow:'hidden' }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&display=swap');
        *{box-sizing:border-box;margin:0;padding:0}
        input[type=range]{-webkit-appearance:none;height:3px;border-radius:2px;outline:none}
        input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:14px;height:14px;border-radius:50%;cursor:pointer;background:#1a1716;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,0.2)}
        ::-webkit-scrollbar{width:5px;height:5px}
        ::-webkit-scrollbar-track{background:#f0ede8}
        ::-webkit-scrollbar-thumb{background:#d0cdc8;border-radius:4px}
        button:hover{filter:brightness(0.92)}
        button{transition:filter 0.1s}
        input{outline:none;font-family:inherit}
      `}</style>

      {/* ── TRANSPORT ── */}
      <div style={{ height:52, flexShrink:0, background:L.panel, borderBottom:`1.5px solid ${L.border}`, display:'flex', alignItems:'center', gap:14, padding:'0 16px', boxShadow:'0 1px 0 rgba(0,0,0,0.04)' }}>
        <div style={{ fontSize:11, fontWeight:700, letterSpacing:3, color:L.text, paddingRight:14, borderRight:`1.5px solid ${L.border}`, flexShrink:0 }}>
          ◆ LIVE RIG
        </div>
        
        <button onClick={() => { ea(); setPlaying(p => !p); }} style={{ fontFamily:mono, fontSize:11, letterSpacing:2, padding:'7px 18px', border:'none', borderRadius:6, cursor:'pointer', fontWeight:700, flexShrink:0, background: playing ? '#c4400f' : '#1a7a3a', color:'#fff' }}>
          {playing ? '■ STOP' : '▶ PLAY'}
        </button>
        
        <div style={{ display:'flex', alignItems:'center', gap:8, flexShrink:0 }}>
          <div>
            <div style={{ fontSize:7, color:L.muted, letterSpacing:1.5 }}>BPM</div>
            <div style={{ fontSize:22, fontWeight:700, color:L.accent, letterSpacing:1, lineHeight:1 }}>{bpm}</div>
          </div>
          <div style={{ display:'flex', flexDirection:'column', gap:1 }}>
            {[[1,'▲'],[-1,'▼']].map(([d,l]) => (
              <button key={l} onClick={() => setBpmS(b => Math.max(60,Math.min(200,b+d)))} style={{ width:15, height:13, background:L.panelB, border:`1px solid ${L.border}`, fontSize:8, cursor:'pointer', borderRadius:2, fontFamily:mono, color:L.muted, padding:0, lineHeight:1 }}>
                {l}
              </button>
            ))}
          </div>
          <input type="range" min={60} max={200} value={bpm} onChange={e=>setBpmS(+e.target.value)} style={{ width:90 }} />
        </div>
        
        <div style={{ padding:'4px 12px', background:L.panelB, border:`1px solid ${L.border}`, borderRadius:6, fontSize:11, fontWeight:700, color:playing?'#1a7a3a':L.dim, letterSpacing:2, minWidth:80, textAlign:'center', flexShrink:0 }}>
          {playing ? `${String(step+1).padStart(2,'0')} / ${seqLen}` : `— / ${seqLen}`}
        </div>
        
        <div style={{ display:'flex', alignItems:'center', gap:8, flex:1, maxWidth:340 }}>
          <input value={songName} onChange={e=>setSongName(e.target.value)} style={{ flex:1, padding:'6px 10px', border:`1.5px solid ${L.border}`, borderRadius:6, fontSize:12, background:L.panelB, color:L.text }} />
          <button onClick={saveSong} disabled={songLoading} style={{ fontFamily:mono, fontSize:10, letterSpacing:1, padding:'7px 14px', border:`1.5px solid #1566a8`, background:'#1566a8', color:'#fff', borderRadius:6, cursor:'pointer', fontWeight:700, flexShrink:0 }}>
            {songLoading ? '…' : activeSong ? 'UPDATE' : 'SAVE'}
          </button>
          {songMsg && <span style={{ fontSize:10, color:'#1a7a3a', flexShrink:0 }}>{songMsg}</span>}
        </div>
        
        <button onClick={() => setShowSongs(s=>!s)} style={{ fontFamily:mono, fontSize:10, letterSpacing:1, padding:'7px 14px', border:`1.5px solid ${L.border}`, background:showSongs?L.text:L.panel, color:showSongs?'#fff':L.muted, borderRadius:6, cursor:'pointer', flexShrink:0 }}>
          MY SONGS {songs.length > 0 && `(${songs.length})`}
        </button>
      </div>

      {/* ── SONGS PANEL ── */}
      {showSongs && (
        <div style={{ background:L.panel, borderBottom:`1.5px solid ${L.border}`, padding:'14px 16px', boxShadow:'0 4px 16px rgba(0,0,0,0.06)', zIndex:100, flexShrink:0, maxHeight:220, overflowY:'auto' }}>
          {songs.length === 0 ? (
            <div style={{ fontSize:12, color:L.muted, textAlign:'center', padding:'16px 0' }}>No saved songs yet. Name your song above and hit SAVE.</div> 
          ) : (
            songs.map(s => (
              <div key={s.id} style={{ display:'flex', alignItems:'center', padding:'8px 12px', borderRadius:6, marginBottom:4, border:`1px solid ${activeSong?.id===s.id?'#1566a8':L.border}`, background:activeSong?.id===s.id?'#edf4ff':L.panelB }}>
                <div>
                  <div style={{ fontSize:12, fontWeight:700, color:L.text }}>{s.name}</div>
                  <div style={{ fontSize:10, color:L.muted }}>{new Date(s.updated_at||s.created_at).toLocaleDateString()}</div>
                </div>
                <div style={{ marginLeft:'auto', display:'flex', gap:6 }}>
                  <button onClick={() => loadSong(s)} style={{ fontFamily:mono, fontSize:10, padding:'5px 12px', background:'#1566a8', color:'#fff', border:'none', borderRadius:5, cursor:'pointer', fontWeight:700 }}>LOAD</button>
                  <button onClick={() => deleteSong(s.id)} style={{ fontFamily:mono, fontSize:10, padding:'5px 10px', background:'transparent', color:'#c4400f', border:`1px solid #c4400f`, borderRadius:5, cursor:'pointer' }}>✕</button>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* ── ADD DEVICE BAR ── */}
      <div style={{ height: 40, flexShrink:0, background: L.panelB, borderBottom: `1px solid ${L.border}`, display:'flex', alignItems:'center', justifyContent:'center', gap:10 }}>
        <span style={{ fontSize:9, color:L.muted, letterSpacing:2, fontWeight:700, marginRight:10 }}>+ ADD RACK DEVICE:</span>
        <Pill label="+ Poly Synth"   active={false} col="#1566a8" onClick={() => addDevice('poly')} />
        <Pill label="+ Road Rash FM" active={false} col="#8a6500" onClick={() => addDevice('rr')} />
        <Pill label="+ Acid Bass"    active={false} col="#8db600" onClick={() => addDevice('acid')} />
        <Pill label="+ Sampler"      active={false} col="#1a7a3a" onClick={() => addDevice('samp')} />
      </div>

      {/* ── RACK ── */}
      <div style={{ flex:1, overflowY:'auto', padding:'8px 10px', display:'flex', flexDirection:'column', gap:0 }}>
        
        {/* MIXER */}
        <RackUnit col="#5050a0">
          <DevHeader label="14:2 Mixer" subtitle="Channel Routing" col="#5050a0" open={open.mix} onToggle={() => setOpen(o=>({...o,mix:!o.mix}))} />
          {open.mix && (
            <div style={{ display:'flex', overflowX:'auto', padding:'10px 14px', gap:0, background:L.panelB, borderLeft:`4px solid #5050a0` }}>
              {MIX_CH.map(({ key, name, col }) => {
                const m = key==='master' ? mx.master : mx[key];
                return (
                  <div key={key} style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:5, padding:'6px 14px', borderRight:`1px solid ${L.border}`, minWidth:82, ...(key==='master'?{borderLeft:`2px solid ${L.borderHi}`,marginLeft:6}:{}) }}>
                    <div style={{ fontSize:9, fontWeight:700, color:col, letterSpacing:1, whiteSpace:'nowrap' }}>{name}</div>
                    
                    {key!=='master' && (
                      <div style={{ display:'flex', gap:4 }}>
                        <Pill label="S" active={m.solo} col={col} onClick={() => setMx(prev=>({...prev,[key]:{...prev[key],solo:!m.solo}}))} />
                        <Pill label="M" active={m.mute} col="#c4400f" onClick={() => setMx(prev=>({...prev,[key]:{...prev[key],mute:!m.mute}}))} />
                      </div>
                    )}
                    
                    <div style={{ height:90, width:30, display:'flex', alignItems:'center', justifyContent:'center', overflow:'hidden' }}>
                      <input type="range" min={0} max={100} value={m.vol} onChange={e=>setMx(prev=>({...prev,[key]:{...prev[key],vol:+e.target.value}}))} style={{ width:90, transform:'rotate(-90deg)', transformOrigin:'center', cursor:'pointer', margin:0 }} />
                    </div>
                    <div style={{ fontSize:10, fontWeight:700, color:col, fontFamily:mono }}>{m.vol}%</div>
                    <div style={{ fontSize:8, color:L.muted }}>PAN</div>
                    <input type="range" min={-100} max={100} value={m.pan} onChange={e=>setMx(prev=>({...prev,[key]:{...prev[key],pan:+e.target.value}}))} style={{ width:64 }} />
                    <div style={{ fontSize:9, color:L.muted, fontFamily:mono }}>{m.pan===0?'C':m.pan>0?`R${m.pan}`:`L${Math.abs(m.pan)}`}</div>
                  </div>
                );
              })}
            </div>
          )}
        </RackUnit>

        {/* DRUM MACHINE */}
        <RackUnit col="#c4400f">
          <DevHeader label="Drum Machine" subtitle={`${seqLen}-step · 4 tracks`} col="#c4400f" open={open.drum} onToggle={() => setOpen(o=>({...o,drum:!o.drum}))} />
          {open.drum && (
            <div style={{ display:'flex', alignItems:'flex-start', padding:'10px 14px', gap:12, borderLeft:`4px solid #c4400f`, background:L.panelB, overflowX:'auto' }}>
              <div style={{ display:'flex', flexDirection:'column', gap:5 }}>
                {DRUM_IDS.map((id,ti) => (
                  <div key={id} style={{ display:'flex', alignItems:'center', gap:5 }}>
                    <div style={{ width:44, fontSize:8, color:DRUM_COLS[ti], letterSpacing:1, textAlign:'right', flexShrink:0, fontWeight:700 }}>{DRUM_NAMES[ti]}</div>
                    <div style={{ display:'flex', gap:2 }}>
                      {Array(seqLen).fill(0).map((_,si) => (
                        <div key={si} style={{ display:'flex', alignItems:'center', gap:2 }}>
                          {si>0&&si%stepsPerBeat===0 && <div style={{ width:1, height:22, background:L.borderHi }} />}
                          <div onClick={()=>toggleStep(id,si)} style={{ width:22, height:22, borderRadius:4, cursor:'pointer', flexShrink:0, background:seq[id][si]?DRUM_COLS[ti]:'#f0ede8', border:`1.5px solid ${seq[id][si]?DRUM_COLS[ti]:L.border}`, outline:si===step?`2px solid ${DRUM_COLS[ti]}80`:'none', outlineOffset:1, boxShadow:seq[id][si]?`0 1px 4px ${DRUM_COLS[ti]}60`:'none' }} />
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </RackUnit>

        {/* ── DYNAMIC DEVICES MAPPING ── */}
        {devices.map(d => {
          const T = DEVICE_TYPES[d.type];
          return (
            <RackUnit key={d.id} col={T.col}>
              <DevHeader 
                label={T.name} subtitle={`ID: ${d.id}`} col={T.col} 
                open={open[d.id] ?? true} 
                onToggle={() => setOpen(o=>({...o,[d.id]:!(o[d.id] ?? true)}))} 
                onRemove={() => removeDevice(d.id)} 
              />
              
              {(open[d.id] ?? true) && (
                <div style={{ display:'flex', alignItems:'center', padding:'10px 14px', gap:14, borderLeft:`4px solid ${T.col}`, background:L.panelB, flexWrap:'wrap' }}>
                  
                  {d.type === 'poly' && (
                    <>
                      <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
                        <div style={{ fontSize:8, color:L.muted, letterSpacing:1.5 }}>WAVEFORM</div>
                        <div style={{ display:'flex', gap:4 }}>
                          {['sawtooth','square','sine','triangle'].map(w => <Pill key={w} label={w.slice(0,3).toUpperCase()} active={d.wave===w} col={T.col} onClick={()=>updDev(d.id,'wave',w)} />)}
                        </div>
                        <div style={{ fontSize:8, color:L.muted, letterSpacing:1.5, marginTop:4 }}>OCTAVE</div>
                        <div style={{ display:'flex', gap:4 }}>
                          {[2,3,4,5,6].map(o => <Pill key={o} label={String(o)} active={d.oct===o} col={T.col} onClick={()=>updDev(d.id,'oct',o)} />)}
                        </div>
                      </div>
                      <Knob val={d.atk} min={1} max={2000} col={T.col} label="ATTACK"  fmt={v=>v+'ms'} onVal={v=>updDev(d.id,'atk',v)} />
                      <Knob val={d.rel} min={50} max={4000} col={T.col} label="RELEASE" fmt={v=>v+'ms'} onVal={v=>updDev(d.id,'rel',v)} size={30} />
                      <Knob val={d.flt} min={100} max={8000} col={T.col} label="FILTER" fmt={v=>v>999?Math.round(v/100)/10+'k':v+'Hz'} onVal={v=>updDev(d.id,'flt',v)} size={30} />
                      <div>
                        <div style={{ fontSize:8, color:L.muted, letterSpacing:1.5, marginBottom:6 }}>NOTE — click to play</div>
                        <div style={{ display:'flex', gap:3, flexWrap:'wrap', maxWidth:200 }}>
                          {NOTES.map(n => (<Pill key={n} label={n} active={d.note===n} col={T.col} onClick={() => { updDev(d.id,'note',n); ea(); engine.playSynth({ freq:noteFreq(n,d.oct), wave:d.wave, atk:d.atk/1000, rel:d.rel/1000, filter:d.flt }); }} />))}
                        </div>
                      </div>
                      <div style={{ fontFamily:mono, fontSize:14, fontWeight:700, color:T.col, background:'#edf4ff', border:`1px solid #b0cce8`, padding:'6px 14px', borderRadius:8 }}>
                        {d.note}{d.oct}
                      </div>
                    </>
                  )}

                  {d.type === 'rr' && (
                    <>
                      <Knob val={d.mr} min={0.1} max={4} step={0.1} col={T.col} label="MOD R" fmt={v=>v.toFixed(1)} onVal={v=>updDev(d.id,'mr',v)} />
                      <Knob val={d.mi} min={0} max={8} step={0.1} col={T.col} label="MOD I" fmt={v=>v.toFixed(1)} onVal={v=>updDev(d.id,'mi',v)} />
                      <Knob val={d.det} min={0} max={50} col={T.col} label="DETUNE" fmt={v=>v+'ct'} onVal={v=>updDev(d.id,'det',v)} />
                      <Knob val={d.flt} min={200} max={6000} step={10} col={T.col} label="FILTER" fmt={v=>v+'Hz'} onVal={v=>updDev(d.id,'flt',v)} size={30} />
                      <Knob val={d.atk} min={1} max={200} col="#c08020" label="ATTACK" fmt={v=>v+'ms'} onVal={v=>updDev(d.id,'atk',v)} />
                      <Knob val={d.rel} min={20} max={800} col="#c08020" label="RELEASE" fmt={v=>v+'ms'} onVal={v=>updDev(d.id,'rel',v)} />
                      <Knob val={d.drv} min={0} max={100} col="#c06010" label="DRIVE" fmt={v=>v+'%'} onVal={v=>updDev(d.id,'drv',v)} size={30} />
                      <div style={{ display:'flex', flexDirection:'column', gap:6, paddingLeft:12, borderLeft:`1px solid ${L.border}` }}>
                        <Pill label={d.arp?'ARP ON':'ARP OFF'} active={d.arp} col={T.col} onClick={()=>updDev(d.id,'arp',!d.arp)} />
                        <Pill label="▶ TEST" active={false} col={T.col} onClick={() => { ea(); engine.playRR(noteFreq('E',2), engine.ctx.currentTime, 0.5, d); }} />
                      </div>
                    </>
                  )}

                  {d.type === 'acid' && (
                    <>
                      <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
                        <div style={{ fontSize:8, color:L.muted, letterSpacing:1.5 }}>WAVE</div>
                        <div style={{ display:'flex', gap:4 }}>
                          {['sawtooth','square'].map(w => <Pill key={w} label={w.slice(0,3).toUpperCase()} active={d.wave===w} col={T.col} onClick={()=>updDev(d.id,'wave',w)} />)}
                        </div>
                      </div>
                      <Knob val={d.cut} min={50} max={2000} col={T.col} label="CUTOFF" fmt={v=>v+'Hz'} onVal={v=>updDev(d.id,'cut',v)} size={30} />
                      <Knob val={d.res} min={0} max={100} col={T.col} label="RESONANCE" fmt={v=>v+'%'} onVal={v=>updDev(d.id,'res',v)} size={30} />
                      <Knob val={d.env} min={0} max={5000} col={T.col} label="ENV MOD" fmt={v=>v+'Hz'} onVal={v=>updDev(d.id,'env',v)} />
                      <Knob val={d.dec} min={50} max={1000} col={T.col} label="DECAY" fmt={v=>v+'ms'} onVal={v=>updDev(d.id,'dec',v)} />
                      <Knob val={d.dist} min={0} max={100} col="#c4400f" label="DISTORT" fmt={v=>v+'%'} onVal={v=>updDev(d.id,'dist',v)} />
                      <div style={{ display:'flex', flexDirection:'column', gap:6, paddingLeft:12, borderLeft:`1px solid ${L.border}` }}>
                        <Pill label="▶ TEST" active={false} col={T.col} onClick={() => { ea(); playAcid(engine.ctx.currentTime, noteFreq('A',1), d); }} />
                      </div>
                    </>
                  )}

                  {d.type === 'samp' && (
                    <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:6, flex:1, maxWidth:480 }}>
                      {d.pads.map((pad, i) => (
                        <div key={i} style={{ display:'flex', flexDirection:'column', gap:3 }}>
                          <div onClick={() => { if(pad.buf){ea();engine.playPad(pad.buf,pad.vol,pad.pitch);}else document.getElementById(`pi-${d.id}-${i}`).click(); }} 
                            style={{ 
                              border:`1.5px solid ${pad.buf?T.col:L.border}`, borderRadius:6, 
                              background:pad.buf?'#edf7f0':L.panelB, cursor:'pointer', height:58, 
                              display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', 
                              gap:3, boxShadow:pad.buf?`0 1px 6px ${T.col}30`:L.shadow 
                            }}>
                            <div style={{ fontSize:9, color:pad.buf?T.col:L.dim, letterSpacing:1, fontWeight:700 }}>{PAD_KEYS[i]}</div>
                            {pad.buf ? (
                              <div style={{ fontSize:9, color:T.col, fontWeight:700, textAlign:'center', padding:'0 4px', overflow:'hidden', textOverflow:'ellipsis', maxWidth:80, whiteSpace:'nowrap' }}>
                                {pad.name}
                              </div>
                            ) : (
                              <div style={{ fontSize:9, color:L.dim }}>EMPTY</div>
                            )}
                          </div>
                          
                          {pad.buf && (
                            <div style={{ display:'flex', gap:3 }}>
                              <button onClick={()=>document.getElementById(`pi-${d.id}-${i}`).click()} style={{ flex:1, fontSize:8, padding:'3px 0', background:'transparent', border:`1px solid ${L.border}`, borderRadius:4, cursor:'pointer', color:L.muted }}>LOAD</button>
                              <button onClick={()=>{ const np=[...d.pads]; np[i]={name:`PAD ${i+1}`,buf:null,vol:100,pitch:0,cloudUrl:null}; updDev(d.id,'pads',np); }} style={{ fontSize:8, padding:'3px 7px', background:'transparent', border:`1px solid #c4400f`, borderRadius:4, cursor:'pointer', color:'#c4400f' }}>✕</button>
                            </div>
                          )}
                          <input id={`pi-${d.id}-${i}`} type="file" accept="audio/*" style={{ display:'none' }} onChange={e=>e.target.files[0]&&loadPad(d.id,i,e.target.files[0])} />
                        </div>
                      ))}
                    </div>
                  )}
                  
                </div>
              )}
            </RackUnit>
          );
        })}

        {/* FX RACK */}
        <RackUnit col="#5a3a9a">
          <DevHeader label="FX Rack" subtitle="Post-master · Dist · Delay · Reverb" col="#5a3a9a" open={open.fx} onToggle={() => setOpen(o=>({...o,fx:!o.fx}))} />
          {open.fx && (
            <div style={{ display:'flex', alignItems:'center', padding:'10px 14px', gap:18, borderLeft:`4px solid #5a3a9a`, background:L.panelB, flexWrap:'wrap' }}>
              <Knob val={fxDist} min={0} max={100} col="#993556" label="DISTORT" fmt={v=>v+'%'} onVal={setFxDist} />
              <Knob val={fxDlyT} min={5} max={100} col="#1566a8" label="DLY TIME" fmt={v=>(v/100).toFixed(2)+'s'} onVal={setFxDlyT} />
              <Knob val={fxDlyFb} min={0} max={85} col="#1566a8" label="DLY FB"  fmt={v=>v+'%'} onVal={setFxDlyFb} />
              <Knob val={fxDlyW} min={0} max={100} col="#1566a8" label="DLY MIX" fmt={v=>v+'%'} onVal={setFxDlyW} />
              <Knob val={fxRvW}  min={0} max={100} col="#5a3a9a" label="REVERB"  fmt={v=>v+'%'} onVal={setFxRvW} size={30} />
            </div>
          )}
        </RackUnit>

      </div>{/* /rack */}

      {/* ── MIDI SEQUENCER ── */}
      <div style={{ height:215, flexShrink:0, background:L.panel, borderTop:`2px solid ${L.border}`, display:'flex', flexDirection:'column' }}>
        <div style={{ height:32, background:L.panelB, borderBottom:`1px solid ${L.border}`, display:'flex', alignItems:'center', padding:'0 12px', gap:10, flexShrink:0 }}>
          <span style={{ fontSize:9, letterSpacing:2.5, color:L.muted, fontWeight:700 }}>◈ MIDI SEQUENCER</span>
          
          <div style={{ marginLeft:'auto', display:'flex', gap:10, alignItems:'center' }}>
            <div style={{fontSize:8, color:L.dim, letterSpacing:1}}>LENGTH:</div>
            <input type="number" min={1} max={128} value={seqLen} onChange={e=>handleUpdateSeqLen(+e.target.value)} 
              style={{width:40, height:20, fontSize:10, background:L.panel, border:`1px solid ${L.border}`, borderRadius:3, textAlign:'center', color:L.text, fontFamily:mono}} 
            />
            <div style={{fontSize:8, color:L.dim, letterSpacing:1, marginLeft:6}}>STEPS/BEAT:</div>
            <input type="number" min={1} max={16} value={stepsPerBeat} onChange={e=>setStepsPerBeat(+e.target.value)} 
              style={{width:32, height:20, fontSize:10, background:L.panel, border:`1px solid ${L.border}`, borderRadius:3, textAlign:'center', color:L.text, fontFamily:mono}} 
            />
          </div>
        </div>

        {/* Ruler - Fixed width cells wrapped in overflow-x */}
        <div style={{ height:16, background:'#f8f7f4', borderBottom:`1px solid ${L.border}`, display:'flex', flexShrink:0 }}>
          <div style={{ width:126, flexShrink:0, borderRight:`1px solid ${L.border}` }} />
          <div style={{ flex:1, display:'flex', alignItems:'center', padding:'0 4px', gap:2, overflowX:'auto' }} className="seq-scroll">
            <style>{`.seq-scroll::-webkit-scrollbar { display: none; }`}</style>
            {Array(seqLen).fill(0).map((_,i) => (
              <div key={i} style={{ flex: '0 0 28px', display:'flex', alignItems:'center', gap:2 }}>
                {i>0&&i%stepsPerBeat===0 && <div style={{ width:1, height:10, background:L.borderHi, flexShrink:0 }} />}
                <div style={{ flex:1, fontSize:7, color:i%stepsPerBeat===0?L.muted:L.dim, fontWeight:i%stepsPerBeat===0?700:400, letterSpacing:0.5, textAlign:'center' }}>
                  {i%stepsPerBeat===0?Math.floor(i/stepsPerBeat)+1:i+1}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Tracks - Uses dynamic devices array */}
        <div style={{ flex:1, overflowY:'auto' }}>
          {[
            ...DRUM_IDS.map(id => ({ id, isDrum: true, col: DRUM_COLS[DRUM_IDS.indexOf(id)], name: DRUM_NAMES[DRUM_IDS.indexOf(id)] })), 
            ...devices.map(d => ({ id: d.id, isDrum: false, col: DEVICE_TYPES[d.type].col, name: DEVICE_TYPES[d.type].name, pitched: DEVICE_TYPES[d.type].pitched }))
          ].map((track) => (
            <div key={track.id} style={{ height:26, display:'flex', borderBottom:`1px solid #f0ede8` }}>
              <div onClick={() => track.pitched && setPianoRoll({ trackId:track.id, highlightStep:null })} 
                style={{ width:126, flexShrink:0, display:'flex', alignItems:'center', gap:6, padding:'0 8px', borderRight:`1px solid ${L.border}`, cursor: track.pitched ? 'pointer' : 'default' }}>
                <div style={{ width:3, height:14, borderRadius:2, background:track.col, flexShrink:0 }} />
                <div style={{ fontSize:8, letterSpacing:1, color:L.muted, textTransform:'uppercase', flex:1, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
                  {track.name}
                </div>
                {track.pitched && <span style={{ fontSize:8, color:track.col, opacity:0.6 }}>𝄞</span>}
              </div>
              <div style={{ flex:1, display:'flex', alignItems:'center', padding:'0 4px', gap:2, overflowX:'auto' }} className="seq-scroll" onScroll={e => { const scrolls = document.querySelectorAll('.seq-scroll'); scrolls.forEach(s => { if(s!==e.target) s.scrollLeft = e.target.scrollLeft; }) }}>
                {Array(seqLen).fill(0).map((_,si) => {
                  const val = seq[track.id]?.[si];
                  const on = val != null && val !== false;
                  let label = '';
                  if (on) {
                    if (track.pitched === 'pad') label = `P${(val||0)+1}`;
                    else if (track.pitched && val?.note) label = val.note+val.oct;
                  }
                  return (
                    <div key={si} style={{ flex: '0 0 28px', display:'flex', alignItems:'center', gap:2 }}>
                      {si>0&&si%stepsPerBeat===0 && <div style={{ width:1, height:14, background:L.borderHi, flexShrink:0 }} />}
                      <div onClick={() => toggleStep(track.id,si)} 
                        style={{ 
                          flex:1, height:20, borderRadius:3, cursor:'pointer', 
                          border:`1px solid ${on ? track.col+'55' : L.border}`, 
                          background: on ? track.col+'22' : si===step ? '#fffbe6' : 'transparent', 
                          outline: si===step ? `2px solid ${track.col}80` : 'none', outlineOffset:-2, 
                          display:'flex', alignItems:'center', justifyContent:'center', 
                          fontSize:7, color:track.col, fontWeight:700, letterSpacing:0.5 
                        }}>
                        {on ? label : ''}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {pianoRoll && (
        <PianoRoll
          trackDef={{ ...DEVICE_TYPES[devices.find(d => d.id === pianoRoll.trackId).type], name: devices.find(d => d.id === pianoRoll.trackId).type.toUpperCase() }}
          seqData={seq[pianoRoll.trackId]} 
          currentStep={step} 
          highlightStep={pianoRoll.highlightStep} 
          seqLen={seqLen} 
          stepsPerBeat={stepsPerBeat}
          onUpdate={(si, noteObj) => {
            if (si === 'clear') { 
              setSeq(prev => ({ ...prev, [pianoRoll.trackId]: Array(seqLen).fill(null) })); return; 
            }
            setSeq(prev => { 
              const next = { ...prev, [pianoRoll.trackId]: [...prev[pianoRoll.trackId]] }; 
              next[pianoRoll.trackId][si] = noteObj; return next; 
            });
            if (noteObj) {
              ea(); 
              const d = devices.find(x => x.id === pianoRoll.trackId);
              if (d.type === 'poly') engine.playSynth({ freq: noteFreq(noteObj.note, noteObj.oct), wave: d.wave, atk: d.atk/1000, rel: d.rel/1000, filter: d.flt });
              else if (d.type === 'rr') engine.playRR(noteFreq(noteObj.note, noteObj.oct), engine.ctx.currentTime, 0.5, d);
              else if (d.type === 'acid') playAcid(engine.ctx.currentTime, noteFreq(noteObj.note, noteObj.oct), d);
            }
          }}
          onClose={() => setPianoRoll(null)}
          onPlayNote={(note, oct) => {
            ea(); 
            const d = devices.find(x => x.id === pianoRoll.trackId);
            if (d.type === 'poly') engine.playSynth({ freq: noteFreq(note, oct), wave: d.wave, atk: d.atk/1000, rel: d.rel/1000, filter: d.flt });
            else if (d.type === 'rr') engine.playRR(noteFreq(note, oct), engine.ctx.currentTime, 0.5, d);
            else if (d.type === 'acid') playAcid(engine.ctx.currentTime, noteFreq(note, oct), d);
          }}
        />
      )}
    </div>
  );
}
