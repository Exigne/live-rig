/**
 * App.jsx — Live Rig Performance Suite
 * Light theme · Rack UI · Piano Roll · Song Save/Load · Neon Auth · Cloudinary
 *
 * Place in src/App.jsx alongside:
 * src/PianoRoll.jsx   — piano roll modal
 * src/AudioEngine.js  — Web Audio engine
 * src/api.js          — Neon + Cloudinary API helpers
 * netlify/functions/  — serverless backend
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
const WAVEFORMS  = ['sawtooth','square','sine','triangle'];

const SEQ_TRACKS = [
  { id:'kick',  name:'KICK',       col:'#c4400f', pitched:false  },
  { id:'snare', name:'SNARE',      col:'#a03018', pitched:false  },
  { id:'hh',    name:'HIHAT',      col:'#7a5010', pitched:false  },
  { id:'bass',  name:'BASS DRV',   col:'#d05030', pitched:false  },
  { id:'synth', name:'POLY SYNTH', col:'#1566a8', pitched:true   },
  { id:'rr',    name:'ROAD RASH',  col:'#8a6500', pitched:'rr'   },
  { id:'samp',  name:'SAMPLER',    col:'#1a7a3a', pitched:'pad'  },
];

const MIX_CH = [
  { key:'drums',  name:'DRUMS',  col:'#c4400f' },
  { key:'synth',  name:'SYNTH',  col:'#1566a8' },
  { key:'rr',     name:'RR FM',  col:'#8a6500' },
  { key:'samp',   name:'SAMP',   col:'#1a7a3a' },
  { key:'master', name:'MASTER', col:'#5050a0' },
];

// ─── LIGHT THEME PALETTE ─────────────────────────────────────────────────────
const L = {
  bg:     '#f2efe9',
  panel:  '#ffffff',
  panelB: '#f8f7f4',
  border: '#e2dfd8',
  borderHi: '#ccc9c0',
  text:   '#1a1716',
  muted:  '#7a7570',
  dim:    '#b0aba5',
  accent: '#e8950a',
  shadow: '0 1px 4px rgba(0,0,0,0.08), 0 4px 16px rgba(0,0,0,0.04)',
};

// ─── DEFAULT STATE ─────────────────────────────────────────────────────────────
const mkSeq = () => ({
  kick:  [1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0].map(Boolean),
  snare: [0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0].map(Boolean),
  hh:    [1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0].map(Boolean),
  bass:  [1,0,0,0,0,0,1,0,0,0,1,0,0,0,0,0].map(Boolean),
  synth: Array(16).fill(null),
  rr:    ['E','E',null,'E','G',null,'A','G','E',null,'D',null,'E','B',null,'E']
           .map(n => n ? { note: n, oct: 2 } : null),
  samp:  Array(16).fill(null),
});

const mkMix = () => ({
  drums:  { vol:80, pan:0, mute:false, solo:false },
  synth:  { vol:75, pan:0, mute:false, solo:false },
  rr:     { vol:70, pan:0, mute:false, solo:false },
  samp:   { vol:80, pan:0, mute:false, solo:false },
  master: { vol:85, pan:0 },
});

// ─── SINGLETON ENGINE ─────────────────────────────────────────────────────────
const engine = new AudioEngine();

// ─── SMALL COMPONENTS ─────────────────────────────────────────────────────────
const mono = "'JetBrains Mono','Fira Code','Courier New',monospace";

function Screw() {
  return (
    <div style={{ width:10, height:10, borderRadius:'50%', flexShrink:0,
      background:'radial-gradient(circle at 35% 30%,#d0cdc8,#a0a09a)',
      border:'1px solid #c0bdb8', position:'relative' }}>
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
      background: side==='left'
        ? 'linear-gradient(to right,#e0ddd8,#eae7e2)'
        : 'linear-gradient(to left,#e0ddd8,#eae7e2)',
      borderLeft:  side==='left'  ? `1px solid ${L.borderHi}` : 'none',
      borderRight: side==='right' ? `1px solid ${L.borderHi}` : 'none',
      display:'flex', flexDirection:'column', alignItems:'center',
      justifyContent:'space-around', padding:'5px 0',
    }}>
      <Screw /><Screw /><Screw />
    </div>
  );
}

function DevHeader({ label, subtitle, col, open, onToggle }) {
  return (
    <div onClick={onToggle} style={{
      height:26, padding:'0 12px', display:'flex', alignItems:'center', gap:10,
      cursor:'pointer', borderBottom:`1px solid ${L.border}`,
      background:L.panel, userSelect:'none',
      borderLeft:`4px solid ${col}`,
    }}>
      <div style={{ width:7, height:7, borderRadius:'50%', background:col, flexShrink:0,
        boxShadow:`0 0 4px ${col}80` }} />
      <span style={{ fontSize:10, fontWeight:700, letterSpacing:2, color:L.text, textTransform:'uppercase' }}>{label}</span>
      {subtitle && <span style={{ fontSize:9, color:L.muted, letterSpacing:1 }}>{subtitle}</span>}
      <span style={{ marginLeft:'auto', fontSize:9, color:L.dim }}>{open ? '▼' : '►'}</span>
    </div>
  );
}

function RackUnit({ children, col='#888' }) {
  return (
    <div style={{
      display:'flex', flexShrink:0,
      border:`1px solid ${L.border}`,
      borderRadius:4, overflow:'hidden',
      boxShadow:L.shadow, marginBottom:4,
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
  const display = fmt ? fmt(val) : val;

  useEffect(() => {
    const mv = e => {
      if (!dragging.current) return;
      const dy = startY.current - e.clientY;
      let nv = startV.current + (dy / 130) * (max - min);
      nv = Math.round(nv / step) * step;
      nv = Math.max(min, Math.min(max, nv));
      onVal(nv);
    };
    const up = () => { dragging.current = false; };
    window.addEventListener('mousemove', mv);
    window.addEventListener('mouseup', up);
    return () => { window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up); };
  }, [min, max, step, onVal]);

  return (
    <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:3, flexShrink:0 }}>
      <div
        onMouseDown={e => { dragging.current=true; startY.current=e.clientY; startV.current=val; e.preventDefault(); }}
        style={{
          width:size, height:size, borderRadius:'50%', cursor:'ns-resize',
          background:`radial-gradient(circle at 40% 35%, #fff, ${col}22)`,
          border:`2px solid ${col}55`,
          boxShadow:`0 2px 6px rgba(0,0,0,0.12), inset 0 1px 2px rgba(255,255,255,0.8)`,
          position:'relative',
        }}>
        <div style={{
          position:'absolute', top:'14%', left:'50%', width:2, height:'28%',
          background:col, borderRadius:2,
          transformOrigin:'bottom center',
          transform:`translateX(-50%) rotate(${ang}deg)`,
          boxShadow:`0 0 3px ${col}80`,
        }} />
      </div>
      <div style={{ fontSize:7, color:L.muted, letterSpacing:0.5, textTransform:'uppercase', whiteSpace:'nowrap' }}>{label}</div>
      <div style={{ fontSize:8, color:col, fontFamily:mono, fontWeight:700 }}>{display}</div>
    </div>
  );
}

function Pill({ label, active, col, onClick }) {
  return (
    <button onClick={onClick} style={{
      fontFamily:mono, fontSize:9, letterSpacing:1, textTransform:'uppercase',
      padding:'4px 10px', borderRadius:20, cursor:'pointer',
      border:`1.5px solid ${active ? col : L.border}`,
      background: active ? col : L.panel,
      color: active ? (col==='#1566a8'||col==='#1a7a3a'||col==='#c4400f'||col==='#8a6500' ? '#fff' : '#fff') : L.muted,
      fontWeight: active ? 700 : 400,
      transition:'all 0.12s',
    }}>{label}</button>
  );
}

function SeqCell({ on, cur, col, label, onClick }) {
  return (
    <div onClick={onClick} style={{
      flex:1, height:20, borderRadius:3, cursor:'pointer', minWidth:0,
      border:`1px solid ${on ? col+'55' : L.border}`,
      background: on ? col+'22' : cur ? '#fffbe6' : 'transparent',
      outline: cur ? `2px solid ${col}80` : 'none', outlineOffset:-2,
      display:'flex', alignItems:'center', justifyContent:'center',
      fontSize:7, color:col, fontWeight:700, letterSpacing:0.5,
      transition:'background 0.05s', overflow:'hidden',
    }}>
      {on && label ? label : ''}
    </div>
  );
}

// ─── APP ──────────────────────────────────────────────────────────────────────
export default function App() {
  // Auth
  const [authed,   setAuthed]   = useState(false);
  const [token,    setToken]    = useState(() => localStorage.getItem('lr_token') || '');
  const [userId,   setUserId]   = useState(() => localStorage.getItem('lr_uid')   || '');
  const [loginU,   setLoginU]   = useState('');
  const [loginP,   setLoginP]   = useState('');
  const [loginErr, setLoginErr] = useState('');
  const [loginMode,setLoginMode]= useState('login'); // 'login' | 'register'
  const [authLoading, setAuthLoading] = useState(false);

  // Transport
  const [playing, setPlaying] = useState(false);
  const [bpm,     setBpmS]    = useState(120);
  const [step,    setStep]    = useState(-1);

  // Sequencer
  const [seq, setSeq] = useState(mkSeq());

  // Synth
  const [sWave, setSWave] = useState('sawtooth');
  const [sNote, setSNote] = useState('A');
  const [sOct,  setSoct]  = useState(4);
  const [sAtk,  setSatk]  = useState(20);
  const [sRel,  setSrel]  = useState(600);
  const [sFlt,  setSflt]  = useState(2000);

  // Road Rash FM
  const [rrMR,  setRrMR]  = useState(1.0);
  const [rrMI,  setRrMI]  = useState(3.5);
  const [rrDet, setRrDet] = useState(18);
  const [rrFlt, setRrFlt] = useState(1800);
  const [rrAtk, setRrAtk] = useState(5);
  const [rrRel, setRrRel] = useState(180);
  const [rrDrv, setRrDrv] = useState(70);
  const [rrArp, setRrArp] = useState(true);

  // Sampler
  const [pads, setPads] = useState(
    Array(8).fill(null).map((_,i) => ({ name:`PAD ${i+1}`, buf:null, vol:100, pitch:0, cloudUrl:null }))
  );

  // Mixer
  const [mx, setMx] = useState(mkMix());

  // FX
  const [fxDist, setFxDist] = useState(0);
  const [fxDlyT, setFxDlyT] = useState(30);
  const [fxDlyFb,setFxDlyFb]= useState(25);
  const [fxDlyW, setFxDlyW] = useState(0);
  const [fxRvW,  setFxRvW]  = useState(0);

  // Device collapse
  const [open, setOpen] = useState({ mix:true, drum:true, syn:true, rr:true, samp:true, fx:false });

  // Piano roll
  const [pianoRoll, setPianoRoll] = useState(null); // { trackId, highlightStep }

  // Songs
  const [songs,        setSongs]       = useState([]);
  const [showSongs,    setShowSongs]   = useState(false);
  const [songName,     setSongName]    = useState('New Song');
  const [activeSong,   setActiveSong]  = useState(null);
  const [songLoading, setSongLoading]= useState(false);
  const [songMsg,      setSongMsg]     = useState('');

  // ── Scheduler refs ──────────────────────────────────────────────────────────
  const schedRef  = useRef(null);
  const stepRef   = useRef(0);
  const nextTRef  = useRef(0);
  const bpmRef    = useRef(bpm);
  const seqRef    = useRef(seq);
  const synthRef  = useRef({ wave:sWave, note:sNote, oct:sOct, atk:sAtk, rel:sRel, flt:sFlt });
  const rrRef     = useRef({ mr:rrMR, mi:rrMI, det:rrDet, flt:rrFlt, atk:rrAtk, rel:rrRel });
  const rrArpRef  = useRef(rrArp);
  const padsRef   = useRef(pads);

  bpmRef.current   = bpm;
  seqRef.current   = seq;
  synthRef.current = { wave:sWave, note:sNote, oct:sOct, atk:sAtk, rel:sRel, flt:sFlt };
  rrRef.current    = { mr:rrMR, mi:rrMI, det:rrDet, flt:rrFlt, atk:rrAtk, rel:rrRel };
  rrArpRef.current = rrArp;
  padsRef.current  = pads;

  const ea = useCallback(() => { engine.init(); engine.resume(); }, []);

  // ── Side-effects ────────────────────────────────────────────────────────────
  useEffect(() => { engine.applyMixer(mx); }, [mx]);
  useEffect(() => { engine.applyFX({ dist:fxDist, dlyT:fxDlyT, dlyFb:fxDlyFb, dlyW:fxDlyW, rvW:fxRvW }); }, [fxDist,fxDlyT,fxDlyFb,fxDlyW,fxRvW]);
  useEffect(() => { engine.setRRDrive(rrDrv); }, [rrDrv]);

  // Auto-verify token on load
  useEffect(() => {
    if (!token) return;
    authAPI.verify(token)
      .then(() => setAuthed(true))
      .catch(() => { localStorage.removeItem('lr_token'); setToken(''); });
  }, []);

  // Load songs after auth
  useEffect(() => {
    if (!authed || !token) return;
    songsAPI.list(token).then(data => setSongs(data.songs || [])).catch(() => {});
  }, [authed, token]);

  // ── Auth ─────────────────────────────────────────────────────────────────────
  const doAuth = async () => {
    setAuthLoading(true); setLoginErr('');
    try {
      const fn = loginMode === 'login' ? authAPI.login : authAPI.register;
      const { token: t, userId: uid } = await fn(loginU, loginP);
      localStorage.setItem('lr_token', t);
      localStorage.setItem('lr_uid', uid);
      setToken(t); setUserId(uid); setAuthed(true);
    } catch(e) {
      setLoginErr(e.message);
    } finally { setAuthLoading(false); }
  };

  // ── Scheduler ────────────────────────────────────────────────────────────────
  const schedStep = useCallback((s, t) => {
    const q   = seqRef.current;
    const syn = synthRef.current;
    const rr  = rrRef.current;
    const spb = (60 / bpmRef.current) / 4;
    if (q.kick[s])  engine.playKick(t);
    if (q.snare[s]) engine.playSnare(t);
    if (q.hh[s])    engine.playHH(t);
    if (q.bass[s])  engine.playBass(t, 82 + (s % 8) * 3);
    if (q.synth[s]) engine.playSynth({ freq:noteFreq(q.synth[s].note,q.synth[s].oct), wave:syn.wave, atk:syn.atk/1000, rel:syn.rel/1000, filter:syn.flt });
    if (rrArpRef.current && q.rr[s]?.note) engine.playRR(noteFreq(q.rr[s].note, q.rr[s].oct), t, spb * 0.85, rr);
    if (q.samp[s] != null) { const pad = padsRef.current[q.samp[s]]; if (pad?.buf) engine.playPad(pad.buf, pad.vol, pad.pitch); }
  }, []);

  const startSeq = useCallback(() => {
    ea(); stepRef.current=0; nextTRef.current = engine.ctx.currentTime + 0.05;
    const tick = () => {
      while (nextTRef.current < engine.ctx.currentTime + 0.12) {
        const s = stepRef.current;
        schedStep(s, nextTRef.current);
        const delay = Math.max(0, (nextTRef.current - engine.ctx.currentTime) * 1000);
        setTimeout(() => setStep(s), delay);
        nextTRef.current += (60 / bpmRef.current) / 4;
        stepRef.current = (stepRef.current + 1) % 16;
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

  // ── Keyboard shortcuts ───────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = e => {
      if (e.target.tagName === 'INPUT') return;
      if (e.key === ' ') { e.preventDefault(); ea(); setPlaying(p => !p); return; }
      const i = PAD_KEYS.indexOf(e.key.toUpperCase());
      if (i >= 0) { ea(); engine.playPad(pads[i].buf, pads[i].vol, pads[i].pitch); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pads, ea]);

  // ── Sequencer toggle ─────────────────────────────────────────────────────────
  const toggleStep = useCallback((trackId, si) => {
    const track = SEQ_TRACKS.find(t => t.id === trackId);
    if (track.pitched) {
      // Open piano roll instead of cycling
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
          if (trackId==='kick')  engine.playKick(engine.ctx.currentTime);
          if (trackId==='snare') engine.playSnare(engine.ctx.currentTime);
          if (trackId==='hh')    engine.playHH(engine.ctx.currentTime);
          if (trackId==='bass')  engine.playBass(engine.ctx.currentTime);
        }
      }
      return next;
    });
  }, [ea]);

  // Piano roll update callback
  const pianoRollUpdate = useCallback((si, noteObj) => {
    if (!pianoRoll) return;
    const { trackId } = pianoRoll;
    if (si === 'clear') {
      setSeq(prev => ({ ...prev, [trackId]: Array(16).fill(null) }));
      return;
    }
    setSeq(prev => {
      const next = { ...prev, [trackId]: [...prev[trackId]] };
      next[trackId][si] = noteObj;
      if (noteObj) {
        ea();
        engine.playSynth({ freq:noteFreq(noteObj.note, noteObj.oct), wave:sWave, atk:0.01, rel:0.15, filter:sFlt });
      }
      return next;
    });
  }, [pianoRoll, ea, sWave, sFlt]);

  // ── Mixer ────────────────────────────────────────────────────────────────────
  const updMx = (key, field, val) => setMx(m => ({ ...m, [key]: { ...m[key], [field]: val } }));

  // ── Pad loader ────────────────────────────────────────────────────────────────
  const loadPad = async (i, file) => {
    ea();
    const buf = await engine.ctx.decodeAudioData(await file.arrayBuffer());
    setPads(p => p.map((pd,pi) => pi===i
      ? { ...pd, buf, name:file.name.replace(/\.[^.]+$/,'').slice(0,14) }
      : pd));
  };

  // ── Song state serialiser (no AudioBuffers — those go to Cloudinary) ─────────
  const captureState = () => ({
    bpm, seq,
    synth: { wave:sWave, note:sNote, oct:sOct, atk:sAtk, rel:sRel, flt:sFlt },
    rr:    { mr:rrMR, mi:rrMI, det:rrDet, flt:rrFlt, atk:rrAtk, rel:rrRel, drv:rrDrv, arp:rrArp },
    pads:  pads.map(p => ({ name:p.name, vol:p.vol, pitch:p.pitch, cloudUrl:p.cloudUrl })),
    mx, fx: { dist:fxDist, dlyT:fxDlyT, dlyFb:fxDlyFb, dlyW:fxDlyW, rvW:fxRvW },
  });

  const applyState = async (s) => {
    setBpmS(s.bpm);
    setSeq(s.seq);
    setSWave(s.synth.wave); setSNote(s.synth.note); setSoct(s.synth.oct);
    setSatk(s.synth.atk); setSrel(s.synth.rel); setSflt(s.synth.flt);
    setRrMR(s.rr.mr); setRrMI(s.rr.mi); setRrDet(s.rr.det);
    setRrFlt(s.rr.flt); setRrAtk(s.rr.atk); setRrRel(s.rr.rel);
    setRrDrv(s.rr.drv); setRrArp(s.rr.arp);
    setMx(s.mx);
    setFxDist(s.fx.dist); setFxDlyT(s.fx.dlyT); setFxDlyFb(s.fx.dlyFb);
    setFxDlyW(s.fx.dlyW); setFxRvW(s.fx.rvW);
    // Restore pads — fetch audio from Cloudinary
    ea();
    const newPads = await Promise.all(s.pads.map(async (p, i) => {
      if (!p.cloudUrl) return { name:p.name, buf:null, vol:p.vol, pitch:p.pitch, cloudUrl:null };
      try {
        const buf = await cloudinary.fetchPad(engine.ctx, p.cloudUrl);
        return { name:p.name, buf, vol:p.vol, pitch:p.pitch, cloudUrl:p.cloudUrl };
      } catch { return { name:p.name, buf:null, vol:p.vol, pitch:p.pitch, cloudUrl:p.cloudUrl }; }
    }));
    setPads(newPads);
  };

  // ── Save song ─────────────────────────────────────────────────────────────────
  const saveSong = async () => {
    if (!token || !songName.trim()) return;
    setSongLoading(true); setSongMsg('');
    try {
      // 1. Upload any pads that have audio but no Cloudinary URL
      const updatedPads = await Promise.all(pads.map(async (pad, i) => {
        if (!pad.buf || pad.cloudUrl) return pad;
        const { url } = await cloudinary.uploadPad(token, pad.buf, pad.name || `pad-${i}`);
        return { ...pad, cloudUrl: url };
      }));
      setPads(updatedPads);

      // 2. Capture state (with cloudUrls) and save to Neon
      const state = { ...captureState(), pads: updatedPads.map(p => ({ name:p.name, vol:p.vol, pitch:p.pitch, cloudUrl:p.cloudUrl })) };
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
    } finally { setSongLoading(false); setTimeout(() => setSongMsg(''), 3000); }
  };

  const loadSong = async (song) => {
    setSongLoading(true);
    try {
      await applyState(song.state);
      setActiveSong(song);
      setSongName(song.name);
      setShowSongs(false);
    } catch(e) { setSongMsg('Load error: ' + e.message); }
    finally { setSongLoading(false); }
  };

  const deleteSong = async (id) => {
    try {
      await songsAPI.delete(token, id);
      setSongs(prev => prev.filter(s => s.id !== id));
      if (activeSong?.id === id) setActiveSong(null);
    } catch(e) { setSongMsg('Delete error: ' + e.message); }
  };

  // ── INPUT RANGE THUMB COLOUR ──────────────────────────────────────────────
  const rangeStyle = (col) => ({
    WebkitAppearance:'none', height:3, background:`linear-gradient(to right,${col} 0%,${col} var(--v,50%),#e2dfd8 var(--v,50%))`,
    borderRadius:2, outline:'none', cursor:'pointer',
  });

  // ────────────────────────────────────────────────────────────────────────────
  // LOGIN SCREEN
  // ────────────────────────────────────────────────────────────────────────────
  if (!authed) return (
    <div style={{ minHeight:'100vh', background:L.bg, display:'flex', alignItems:'center', justifyContent:'center', fontFamily:mono }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&display=swap');*{box-sizing:border-box;margin:0;padding:0}input{outline:none;font-family:inherit}`}</style>
      <div style={{ width:360, background:L.panel, borderRadius:12, boxShadow:'0 8px 48px rgba(0,0,0,0.12)', overflow:'hidden' }}>
        <div style={{ height:6, background:'linear-gradient(to right,#c4400f,#1566a8,#1a7a3a)' }} />
        <div style={{ padding:'36px 40px' }}>
          <div style={{ fontSize:10, color:L.muted, letterSpacing:3, marginBottom:8 }}>◆ LIVE RIG</div>
          <div style={{ fontSize:24, fontWeight:700, letterSpacing:1, color:L.text, marginBottom:6 }}>
            {loginMode === 'login' ? 'Sign In' : 'Create Account'}
          </div>
          <div style={{ fontSize:11, color:L.muted, marginBottom:28 }}>Synced to Neon · Cloudinary storage</div>

          {['Username','Password'].map((ph,i) => (
            <input key={ph} type={i===1?'password':'text'}
              placeholder={ph}
              value={i===0?loginU:loginP}
              onChange={e => i===0?setLoginU(e.target.value):setLoginP(e.target.value)}
              onKeyDown={e => e.key==='Enter' && doAuth()}
              style={{
                display:'block', width:'100%', padding:'11px 14px', marginBottom:12,
                border:`1.5px solid ${L.border}`, borderRadius:8, fontSize:13,
                color:L.text, background:L.panelB,
              }} />
          ))}

          {loginErr && <div style={{ fontSize:11, color:'#c4400f', marginBottom:12, padding:'8px 12px', background:'#fef2ee', borderRadius:6 }}>{loginErr}</div>}

          <button onClick={doAuth} disabled={authLoading} style={{
            width:'100%', padding:'13px', fontSize:13, fontWeight:700, letterSpacing:2,
            background:'#1a1716', color:'#fff', border:'none', borderRadius:8, cursor:'pointer',
            fontFamily:mono, opacity:authLoading?0.6:1,
          }}>{authLoading ? '…' : loginMode==='login' ? 'SIGN IN' : 'CREATE ACCOUNT'}</button>

          <div style={{ textAlign:'center', marginTop:20, fontSize:11, color:L.muted }}>
            {loginMode==='login' ? "No account? " : "Have an account? "}
            <span onClick={() => { setLoginMode(m => m==='login'?'register':'login'); setLoginErr(''); }}
              style={{ color:'#1566a8', cursor:'pointer', fontWeight:700 }}>
              {loginMode==='login' ? 'Create one' : 'Sign in'}
            </span>
          </div>
        </div>
      </div>
    </div>
  );

  // ────────────────────────────────────────────────────────────────────────────
  // MAIN APP
  // ────────────────────────────────────────────────────────────────────────────
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
        {/* Logo */}
        <div style={{ fontSize:11, fontWeight:700, letterSpacing:3, color:L.text, paddingRight:14, borderRight:`1.5px solid ${L.border}`, flexShrink:0 }}>◆ LIVE RIG</div>

        {/* Play/Stop */}
        <button onClick={() => { ea(); setPlaying(p => !p); }} style={{
          fontFamily:mono, fontSize:11, letterSpacing:2, padding:'7px 18px', border:'none', borderRadius:6,
          cursor:'pointer', fontWeight:700, flexShrink:0,
          background: playing ? '#c4400f' : '#1a7a3a',
          color:'#fff',
        }}>{playing ? '■ STOP' : '▶ PLAY'}</button>

        {/* BPM */}
        <div style={{ display:'flex', alignItems:'center', gap:8, flexShrink:0 }}>
          <div>
            <div style={{ fontSize:7, color:L.muted, letterSpacing:1.5 }}>BPM</div>
            <div style={{ fontSize:22, fontWeight:700, color:L.accent, letterSpacing:1, lineHeight:1 }}>{bpm}</div>
          </div>
          <div style={{ display:'flex', flexDirection:'column', gap:1 }}>
            {[[1,'▲'],[-1,'▼']].map(([d,l]) => (
              <button key={l} onClick={() => setBpmS(b => Math.max(60,Math.min(200,b+d)))} style={{
                width:15, height:13, background:L.panelB, border:`1px solid ${L.border}`,
                fontSize:8, cursor:'pointer', borderRadius:2, fontFamily:mono, color:L.muted, padding:0, lineHeight:1,
              }}>{l}</button>
            ))}
          </div>
          <input type="range" min={60} max={200} value={bpm} onChange={e=>setBpmS(+e.target.value)} style={{ width:90 }} />
        </div>

        {/* Step */}
        <div style={{ padding:'4px 12px', background:L.panelB, border:`1px solid ${L.border}`, borderRadius:6, fontSize:11, fontWeight:700, color:playing?'#1a7a3a':L.dim, letterSpacing:2, minWidth:80, textAlign:'center', flexShrink:0 }}>
          {playing ? `${String(step+1).padStart(2,'0')} / 16` : '— / 16'}
        </div>

        {/* Song name + save */}
        <div style={{ display:'flex', alignItems:'center', gap:8, flex:1, maxWidth:340 }}>
          <input value={songName} onChange={e=>setSongName(e.target.value)}
            style={{ flex:1, padding:'6px 10px', border:`1.5px solid ${L.border}`, borderRadius:6, fontSize:12, background:L.panelB, color:L.text }} />
          <button onClick={saveSong} disabled={songLoading} style={{
            fontFamily:mono, fontSize:10, letterSpacing:1, padding:'7px 14px', border:`1.5px solid #1566a8`,
            background:'#1566a8', color:'#fff', borderRadius:6, cursor:'pointer', fontWeight:700, flexShrink:0,
          }}>{songLoading ? '…' : activeSong ? 'UPDATE' : 'SAVE'}</button>
          {songMsg && <span style={{ fontSize:10, color:'#1a7a3a', flexShrink:0 }}>{songMsg}</span>}
        </div>

        {/* Songs list button */}
        <button onClick={() => setShowSongs(s=>!s)} style={{
          fontFamily:mono, fontSize:10, letterSpacing:1, padding:'7px 14px',
          border:`1.5px solid ${L.border}`, background:showSongs?L.text:L.panel,
          color:showSongs?'#fff':L.muted, borderRadius:6, cursor:'pointer', flexShrink:0,
        }}>MY SONGS {songs.length > 0 && `(${songs.length})`}</button>

        {/* Logout */}
        <button onClick={() => { localStorage.removeItem('lr_token'); setAuthed(false); setToken(''); }} style={{
          fontFamily:mono, fontSize:9, padding:'5px 10px', border:`1px solid ${L.border}`,
          background:'transparent', color:L.muted, borderRadius:5, cursor:'pointer', flexShrink:0,
        }}>LOG OUT</button>
      </div>

      {/* ── SONGS PANEL (dropdown) ── */}
      {showSongs && (
        <div style={{ background:L.panel, borderBottom:`1.5px solid ${L.border}`, padding:'14px 16px', boxShadow:'0 4px 16px rgba(0,0,0,0.06)', zIndex:100, flexShrink:0, maxHeight:220, overflowY:'auto' }}>
          {songs.length === 0
            ? <div style={{ fontSize:12, color:L.muted, textAlign:'center', padding:'16px 0' }}>No saved songs yet. Name your song above and hit SAVE.</div>
            : songs.map(s => (
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
            ))}
        </div>
      )}

      {/* ── RACK ── */}
      <div style={{ flex:1, overflowY:'auto', padding:'8px 10px', display:'flex', flexDirection:'column', gap:0 }}>

        {/* 1 — MIXER */}
        <RackUnit col="#5050a0">
          <DevHeader label="14:2 Mixer" subtitle="Channel Routing" col="#5050a0" open={open.mix} onToggle={() => setOpen(o=>({...o,mix:!o.mix}))} />
          {open.mix && (
            <div style={{ display:'flex', overflowX:'auto', padding:'10px 14px', gap:0, background:L.panelB, borderLeft:`4px solid #5050a0` }}>
              {MIX_CH.map(({ key, name, col }) => {
                const m = key==='master' ? mx.master : mx[key];
                const isMaster = key === 'master';
                return (
                  <div key={key} style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:5, padding:'6px 14px', borderRight:`1px solid ${L.border}`, minWidth:82, ...(isMaster?{borderLeft:`2px solid ${L.borderHi}`,marginLeft:6}:{}) }}>
                    <div style={{ fontSize:9, fontWeight:700, color:col, letterSpacing:1, whiteSpace:'nowrap' }}>{name}</div>
                    {!isMaster && (
                      <div style={{ display:'flex', gap:4 }}>
                        <Pill label="S" active={m.solo} col={col} onClick={() => updMx(key,'solo',!m.solo)} />
                        <Pill label="M" active={m.mute} col="#c4400f" onClick={() => updMx(key,'mute',!m.mute)} />
                      </div>
                    )}
                    <div style={{ height:90, width:30, display:'flex', alignItems:'center', justifyContent:'center', overflow:'hidden' }}>
                      <input type="range" min={0} max={100} value={m.vol} onChange={e=>updMx(key,'vol',+e.target.value)} style={{ width:90, transform:'rotate(-90deg)', transformOrigin:'center', cursor:'pointer', margin:0 }} />
                    </div>
                    <div style={{ fontSize:10, fontWeight:700, color:col, fontFamily:mono }}>{m.vol}%</div>
                    <div style={{ fontSize:8, color:L.muted }}>PAN</div>
                    <input type="range" min={-100} max={100} value={m.pan} onChange={e=>updMx(key,'pan',+e.target.value)} style={{ width:64 }} />
                    <div style={{ fontSize:9, color:L.muted, fontFamily:mono }}>{m.pan===0?'C':m.pan>0?`R${m.pan}`:`L${Math.abs(m.pan)}`}</div>
                  </div>
                );
              })}
            </div>
          )}
        </RackUnit>

        {/* 2 — DRUM MACHINE */}
        <RackUnit col="#c4400f">
          <DevHeader label="Drum Machine" subtitle="16-step · 4 tracks" col="#c4400f" open={open.drum} onToggle={() => setOpen(o=>({...o,drum:!o.drum}))} />
          {open.drum && (
            <div style={{ display:'flex', alignItems:'flex-start', padding:'10px 14px', gap:12, borderLeft:`4px solid #c4400f`, background:L.panelB }}>
              <div style={{ display:'flex', flexDirection:'column', gap:5 }}>
                {DRUM_IDS.map((id,ti) => (
                  <div key={id} style={{ display:'flex', alignItems:'center', gap:5 }}>
                    <div style={{ width:44, fontSize:8, color:DRUM_COLS[ti], letterSpacing:1, textAlign:'right', flexShrink:0, fontWeight:700 }}>{DRUM_NAMES[ti]}</div>
                    <div style={{ display:'flex', gap:2 }}>
                      {Array(16).fill(0).map((_,si) => (
                        <div key={si} style={{ display:'flex', alignItems:'center', gap:2 }}>
                          {si>0&&si%4===0 && <div style={{ width:1, height:22, background:L.borderHi }} />}
                          <div onClick={()=>toggleStep(id,si)} style={{
                            width:22, height:22, borderRadius:4, cursor:'pointer', flexShrink:0,
                            background:seq[id][si]?DRUM_COLS[ti]:'#f0ede8',
                            border:`1.5px solid ${seq[id][si]?DRUM_COLS[ti]:L.border}`,
                            outline:si===step?`2px solid ${DRUM_COLS[ti]}80`:'none', outlineOffset:1,
                            boxShadow:seq[id][si]?`0 1px 4px ${DRUM_COLS[ti]}60`:'none',
                            transition:'all 0.06s',
                          }} />
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              <div style={{ display:'flex', gap:12, paddingLeft:12, borderLeft:`1px solid ${L.border}` }}>
                <Knob val={80} min={0} max={100} col="#c4400f" label="TONE"  fmt={v=>v+'%'}  onVal={()=>{}} />
                <Knob val={60} min={0} max={100} col="#c4400f" label="DECAY" fmt={v=>v+'%'} onVal={()=>{}} />
              </div>
            </div>
          )}
        </RackUnit>

        {/* 3 — POLY SYNTH */}
        <RackUnit col="#1566a8">
          <DevHeader label="Poly Synth" subtitle="Oscillator · Envelope · Filter" col="#1566a8" open={open.syn} onToggle={() => setOpen(o=>({...o,syn:!o.syn}))} />
          {open.syn && (
            <div style={{ display:'flex', alignItems:'center', padding:'10px 14px', gap:14, borderLeft:`4px solid #1566a8`, background:L.panelB, flexWrap:'wrap' }}>
              <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
                <div style={{ fontSize:8, color:L.muted, letterSpacing:1.5 }}>WAVEFORM</div>
                <div style={{ display:'flex', gap:4 }}>
                  {['sawtooth','square','sine','triangle'].map(w => <Pill key={w} label={w.slice(0,3).toUpperCase()} active={sWave===w} col="#1566a8" onClick={()=>setSWave(w)} />)}
                </div>
                <div style={{ fontSize:8, color:L.muted, letterSpacing:1.5, marginTop:4 }}>OCTAVE</div>
                <div style={{ display:'flex', gap:4 }}>
                  {[2,3,4,5,6].map(o => <Pill key={o} label={String(o)} active={sOct===o} col="#1566a8" onClick={()=>setSoct(o)} />)}
                </div>
              </div>
              <Knob val={sAtk} min={1}  max={2000} col="#1566a8" label="ATTACK"  fmt={v=>v+'ms'}  onVal={setSatk} />
              <Knob val={sRel} min={50} max={4000} col="#1566a8" label="RELEASE" fmt={v=>v+'ms'}  onVal={setSrel} size={30} />
              <Knob val={sFlt} min={100} max={8000} col="#1566a8" label="FILTER" fmt={v=>v>999?Math.round(v/100)/10+'k':v+'Hz'} onVal={setSflt} size={30} />
              <div>
                <div style={{ fontSize:8, color:L.muted, letterSpacing:1.5, marginBottom:6 }}>NOTE — click to play</div>
                <div style={{ display:'flex', gap:3, flexWrap:'wrap', maxWidth:200 }}>
                  {NOTES.map(n => (
                    <Pill key={n} label={n} active={sNote===n} col="#1566a8"
                      onClick={() => { setSNote(n); ea(); engine.playSynth({ freq:noteFreq(n,sOct), wave:sWave, atk:sAtk/1000, rel:sRel/1000, filter:sFlt }); }} />
                  ))}
                </div>
              </div>
              <div style={{ fontFamily:mono, fontSize:14, fontWeight:700, color:'#1566a8', background:'#edf4ff', border:`1px solid #b0cce8`, padding:'6px 14px', borderRadius:8, letterSpacing:1, alignSelf:'flex-start' }}>
                {sNote}{sOct} · {noteFreq(sNote,sOct).toFixed(0)} Hz
              </div>
            </div>
          )}
        </RackUnit>

        {/* 4 — ROAD RASH FM SYNTH */}
        <RackUnit col="#8a6500">
          <DevHeader label="Road Rash FM Synth" subtitle="YM2612 · 3-osc Unison · Insert Drive" col="#8a6500" open={open.rr} onToggle={() => setOpen(o=>({...o,rr:!o.rr}))} />
          {open.rr && (
            <div style={{ display:'flex', alignItems:'center', padding:'10px 14px', gap:14, borderLeft:`4px solid #8a6500`, background:L.panelB, flexWrap:'wrap' }}>
              <Knob val={rrMR}  min={0.1} max={4}    step={0.1} col="#8a6500" label="MOD R"   fmt={v=>v.toFixed(1)} onVal={setRrMR}  />
              <Knob val={rrMI}  min={0}   max={8}    step={0.1} col="#8a6500" label="MOD I"   fmt={v=>v.toFixed(1)} onVal={setRrMI}  />
              <Knob val={rrDet} min={0}   max={50}              col="#8a6500" label="DETUNE"  fmt={v=>v+'ct'}       onVal={setRrDet} />
              <Knob val={rrFlt} min={200} max={6000} step={10}  col="#8a6500" label="FILTER"  fmt={v=>v+'Hz'}       onVal={setRrFlt} size={30} />
              <Knob val={rrAtk} min={1}   max={200}             col="#c08020" label="ATTACK"  fmt={v=>v+'ms'}       onVal={setRrAtk} />
              <Knob val={rrRel} min={20}  max={800}             col="#c08020" label="RELEASE" fmt={v=>v+'ms'}       onVal={setRrRel} />
              <Knob val={rrDrv} min={0}   max={100}             col="#c06010" label="DRIVE"   fmt={v=>v+'%'}        onVal={setRrDrv} size={30} />
              <div style={{ display:'flex', flexDirection:'column', gap:6, paddingLeft:12, borderLeft:`1px solid ${L.border}` }}>
                <Pill label={rrArp?'ARP ON':'ARP OFF'} active={rrArp} col="#8a6500" onClick={()=>setRrArp(v=>!v)} />
                <Pill label="▶ TEST" active={false} col="#8a6500"
                  onClick={() => { ea(); engine.playRR(noteFreq('E',2), engine.ctx.currentTime, 0.5, {mr:rrMR,mi:rrMI,det:rrDet,flt:rrFlt,atk:rrAtk,rel:rrRel}); }} />
              </div>
              <div style={{ fontFamily:mono, fontSize:12, fontWeight:700, color:'#8a6500', background:'#faf6e8', border:`1px solid #d4b860`, padding:'6px 14px', borderRadius:8 }}>
                {`FM  R=${rrMR.toFixed(1)}  I=${rrMI.toFixed(1)}  DRV=${rrDrv}%`}
              </div>
            </div>
          )}
        </RackUnit>

        {/* 5 — SAMPLER */}
        <RackUnit col="#1a7a3a">
          <DevHeader label="Sampler NN-8" subtitle="8 Pads · Q–F keys · Cloudinary sync" col="#1a7a3a" open={open.samp} onToggle={() => setOpen(o=>({...o,samp:!o.samp}))} />
          {open.samp && (
            <div style={{ display:'flex', padding:'10px 14px', gap:0, borderLeft:`4px solid #1a7a3a`, background:L.panelB }}>
              <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:6, flex:1, maxWidth:480 }}>
                {pads.map((pad, i) => (
                  <div key={i} style={{ display:'flex', flexDirection:'column', gap:3 }}>
                    <div onClick={() => { if(pad.buf){ea();engine.playPad(pad.buf,pad.vol,pad.pitch);}else document.getElementById(`pi-${i}`).click(); }}
                      style={{
                        border:`1.5px solid ${pad.buf?'#1a7a3a':L.border}`, borderRadius:6,
                        background:pad.buf?'#edf7f0':L.panelB, cursor:'pointer', height:58,
                        display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:3,
                        boxShadow:pad.buf?'0 1px 6px rgba(26,122,58,0.15)':L.shadow,
                        transition:'all 0.1s',
                      }}>
                      <div style={{ fontSize:9, color:pad.buf?'#1a7a3a80':L.dim, letterSpacing:1, fontWeight:700 }}>{PAD_KEYS[i]}</div>
                      {pad.buf
                        ? <div style={{ fontSize:9, color:'#1a7a3a', fontWeight:700, textAlign:'center', padding:'0 4px', wordBreak:'break-word', maxWidth:'100%' }}>{pad.name}</div>
                        : <div style={{ fontSize:9, color:L.dim }}>EMPTY</div>
                      }
                      {pad.cloudUrl && <div style={{ fontSize:7, color:'#1a7a3a80' }}>☁ synced</div>}
                    </div>
                    {pad.buf && (
                      <div style={{ display:'flex', gap:3 }}>
                        <button onClick={()=>document.getElementById(`pi-${i}`).click()} style={{ flex:1, fontFamily:mono, fontSize:8, padding:'3px 0', background:'transparent', border:`1px solid ${L.border}`, borderRadius:4, cursor:'pointer', color:L.muted }}>LOAD</button>
                        <button onClick={()=>setPads(p=>p.map((pd,pi)=>pi===i?{...pd,buf:null,cloudUrl:null,name:`PAD ${i+1}`}:pd))} style={{ fontFamily:mono, fontSize:8, padding:'3px 7px', background:'transparent', border:`1px solid #c4400f`, borderRadius:4, cursor:'pointer', color:'#c4400f' }}>✕</button>
                      </div>
                    )}
                    <input id={`pi-${i}`} type="file" accept="audio/*" style={{ display:'none' }} onChange={e=>e.target.files[0]&&loadPad(i,e.target.files[0])} />
                  </div>
                ))}
              </div>
            </div>
          )}
        </RackUnit>

        {/* 6 — FX */}
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

        <div style={{ height:26, background:L.panelB, borderBottom:`1px solid ${L.border}`, display:'flex', alignItems:'center', padding:'0 12px', gap:10, flexShrink:0 }}>
          <span style={{ fontSize:9, letterSpacing:2.5, color:L.muted, fontWeight:700 }}>◈ MIDI SEQUENCER</span>
          <span style={{ fontSize:8, color:L.dim, marginLeft:4 }}>All devices · Click pitched step to open piano roll</span>
          <span style={{ marginLeft:'auto', fontSize:8, color:L.dim }}>SPACE = play/stop</span>
        </div>

        {/* Ruler */}
        <div style={{ height:16, background:'#f8f7f4', borderBottom:`1px solid ${L.border}`, display:'flex', flexShrink:0 }}>
          <div style={{ width:126, flexShrink:0, borderRight:`1px solid ${L.border}` }} />
          <div style={{ flex:1, display:'flex', alignItems:'center', padding:'0 4px', gap:2 }}>
            {Array(16).fill(0).map((_,i) => (
              <div key={i} style={{ display:'flex', alignItems:'center', flex:1, gap:2, minWidth:0 }}>
                {i>0&&i%4===0 && <div style={{ width:1, height:10, background:L.borderHi, flexShrink:0 }} />}
                <div style={{ flex:1, fontSize:7, color:i%4===0?L.muted:L.dim, fontWeight:i%4===0?700:400, letterSpacing:0.5 }}>
                  {i%4===0?Math.floor(i/4)+1:i+1}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Track rows */}
        <div style={{ flex:1, overflowY:'auto' }}>
          {SEQ_TRACKS.map(({ id, name, col, pitched }) => (
            <div key={id} style={{ height:26, display:'flex', borderBottom:`1px solid #f0ede8` }}>
              <div
                style={{ width:126, flexShrink:0, display:'flex', alignItems:'center', gap:6, padding:'0 8px', borderRight:`1px solid ${L.border}`, cursor: pitched ? 'pointer' : 'default' }}
                onClick={() => pitched && setPianoRoll({ trackId:id, highlightStep:null })}
                title={pitched ? `Open piano roll for ${name}` : ''}
              >
                <div style={{ width:3, height:14, borderRadius:2, background:col, flexShrink:0 }} />
                <div style={{ fontSize:8, letterSpacing:1, color:L.muted, textTransform:'uppercase', flex:1 }}>{name}</div>
                {pitched && <span style={{ fontSize:8, color:col, opacity:0.6 }}>𝄞</span>}
              </div>
              <div style={{ flex:1, display:'flex', alignItems:'center', padding:'0 4px', gap:2 }}>
                {Array(16).fill(0).map((_,si) => {
                  const val = seq[id][si];
                  const on = val != null && val !== false;
                  let label = '';
                  if (on) {
                    if (pitched === 'pad') label = `P${(val||0)+1}`;
                    else if (pitched && val?.note) label = val.note+val.oct;
                  }
                  return (
                    <div key={si} style={{ display:'flex', alignItems:'center', flex:1, gap:2, minWidth:0 }}>
                      {si>0&&si%4===0 && <div style={{ width:1, height:14, background:L.borderHi, flexShrink:0 }} />}
                      <SeqCell on={on} cur={si===step} col={col} label={label} onClick={() => toggleStep(id,si)} />
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── PIANO ROLL MODAL ── */}
      {pianoRoll && (
        <PianoRoll
          trackDef={SEQ_TRACKS.find(t => t.id === pianoRoll.trackId)}
          seqData={seq[pianoRoll.trackId]}
          currentStep={step}
          highlightStep={pianoRoll.highlightStep}
          onUpdate={pianoRollUpdate}
          onClose={() => setPianoRoll(null)}
          onPlayNote={(note, oct) => {
            ea(); // Ensure audio context is awake
            if (pianoRoll.trackId === 'synth') {
              engine.playSynth({ 
                freq: noteFreq(note, oct), 
                wave: sWave, 
                atk: sAtk / 1000, 
                rel: sRel / 1000, 
                filter: sFlt 
              });
            } else if (pianoRoll.trackId === 'rr') {
              engine.playRR(noteFreq(note, oct), engine.ctx.currentTime, 0.5, {
                mr: rrMR, mi: rrMI, det: rrDet, flt: rrFlt, atk: rrAtk, rel: rrRel
              });
            }
          }}
        />
      )}

    </div>
  );
}
