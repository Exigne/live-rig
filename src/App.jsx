/**
 * LIVE RIG — Rack Performance Suite
 * ─────────────────────────────────
 * Stack: Vite + React (no other deps needed)
 * Audio: Web Audio API only
 *
 * Devices (rack order):
 *   1. 14:2 Mixer        — per-channel volume, pan, solo, mute
 *   2. Drum Machine      — 16-step grid, 4 tracks (Kick/Snare/HH/Bass)
 *   3. Poly Synth        — oscillator + envelope + filter
 *   4. Road Rash FM      — YM2612-style FM, 3-osc unison, arp grid
 *   5. Sampler NN-8      — 8 pads, load any audio file, keyboard triggers
 *
 * Sequencer (bottom):
 *   MIDI rows for every device — on/off for drums, pitched steps for synths,
 *   pad-select steps for the sampler.
 *
 * Deploy: push to GitHub → connect Netlify (build: npm run build, dist: dist)
 */

import { useState, useEffect, useRef, useCallback } from "react";

// ─── CONSTANTS ────────────────────────────────────────────────────────────────
const NOTES      = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const PAD_KEYS   = ['Q','W','E','R','A','S','D','F'];
const DRUM_IDS   = ['kick','snare','hh','bass'];
const DRUM_NAMES = ['KICK','SNARE','HIHAT','BASS'];
const DRUM_COLS  = ['#C04020','#A03018','#903010','#D05030'];
const RR_NOTES   = ['E','G','A','B','D','C','F#','A#'];
const RR_OCTS    = [ 2,  2,  2,  2,  2,  3,  2,   2];
const WAVEFORMS  = ['sawtooth','square','sine','triangle'];

const SEQ_TRACKS = [
  { id:'kick',  name:'KICK',       col:'#C04020', pitched:false  },
  { id:'snare', name:'SNARE',      col:'#A03018', pitched:false  },
  { id:'hh',    name:'HIHAT',      col:'#903010', pitched:false  },
  { id:'bass',  name:'BASS DRV',   col:'#D05030', pitched:false  },
  { id:'synth', name:'POLY SYNTH', col:'#2090C0', pitched:true   },
  { id:'rr',    name:'ROAD RASH',  col:'#C09020', pitched:'rr'   },
  { id:'samp',  name:'SAMPLER',    col:'#30A040', pitched:'pad'  },
];

const MIX_CHANNELS = [
  { key:'drums',  name:'DRUMS',  col:'#C04020' },
  { key:'synth',  name:'SYNTH',  col:'#2090C0' },
  { key:'rr',     name:'RR FM',  col:'#C09020' },
  { key:'samp',   name:'SAMP',   col:'#30A040' },
  { key:'master', name:'MASTER', col:'#6060B0' },
];

// ─── AUDIO UTILS ──────────────────────────────────────────────────────────────
function noteFreq(n, o) {
  return 440 * Math.pow(2, ((o - 4) * 12 + NOTES.indexOf(n) - 9) / 12);
}

function distCurve(a) {
  const n = 256, c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / n - 1;
    c[i] = a > 0 ? ((Math.PI + a) * x) / (Math.PI + a * Math.abs(x)) : x;
  }
  return c;
}

function makeRevBuf(ctx) {
  const len = ctx.sampleRate * 2.5, buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2);
  }
  return buf;
}

// ─── AUDIO ENGINE ─────────────────────────────────────────────────────────────
class Engine {
  constructor() { this.ctx = null; this.ready = false; }

  init() {
    if (this.ready) return;
    const ctx = this.ctx = new (window.AudioContext || window.webkitAudioContext)();

    const makeCh = (vol, pan) => {
      const g = ctx.createGain(), p = ctx.createStereoPanner();
      g.gain.value = vol / 100; p.pan.value = pan;
      g.connect(p); return { gain: g, panner: p };
    };

    this.chD = makeCh(80, 0); // drums
    this.chS = makeCh(75, 0); // synth
    this.chR = makeCh(70, 0); // road rash
    this.chP = makeCh(80, 0); // sampler

    // Road Rash insert distortion (gives FM its retro grit)
    this.rrIns = ctx.createWaveShaper();
    this.rrIns.curve = distCurve(280); this.rrIns.oversample = '4x';
    this.rrIns.connect(this.chR.gain);

    this.master = ctx.createGain(); this.master.gain.value = 0.85;
    [this.chD, this.chS, this.chR, this.chP].forEach(ch => ch.panner.connect(this.master));

    // Shared post-master FX chain: Dist → Delay → Reverb
    this.dist = ctx.createWaveShaper(); this.dist.curve = distCurve(0); this.dist.oversample = '4x';
    this.dly  = ctx.createDelay(2.0);  this.dly.delayTime.value = 0.3;
    this.dlyFb = ctx.createGain();     this.dlyFb.gain.value = 0.25;
    this.dlyW  = ctx.createGain();     this.dlyW.gain.value = 0;
    this.dly.connect(this.dlyFb); this.dlyFb.connect(this.dly); this.dly.connect(this.dlyW);
    this.rev  = ctx.createConvolver(); this.rev.buffer = makeRevBuf(ctx);
    this.revW = ctx.createGain();      this.revW.gain.value = 0; this.rev.connect(this.revW);

    this.master.connect(this.dist);
    this.dist.connect(this.dly); this.dist.connect(this.rev); this.dist.connect(ctx.destination);
    this.dlyW.connect(ctx.destination); this.revW.connect(ctx.destination);

    this.ready = true;
  }

  resume() { if (this.ctx?.state === 'suspended') this.ctx.resume(); }

  applyMixer(mx) {
    if (!this.ready) return;
    const hasSolo = ['drums','synth','rr','samp'].some(k => mx[k].solo);
    [['drums',this.chD],['synth',this.chS],['rr',this.chR],['samp',this.chP]].forEach(([k,ch]) => {
      const m = mx[k], eff = hasSolo ? (m.solo ? 1 : 0) : (m.mute ? 0 : 1);
      ch.gain.gain.value   = (m.vol / 100) * eff;
      ch.panner.pan.value  = m.pan / 100;
    });
    this.master.gain.value = mx.master.vol / 100;
  }

  applyFX({ dist, dlyT, dlyFb, dlyW, rvW }) {
    if (!this.ready) return;
    this.dist.curve         = distCurve(dist / 100 * 400);
    this.dly.delayTime.value = dlyT / 100;
    this.dlyFb.gain.value   = dlyFb / 100;
    this.dlyW.gain.value    = dlyW / 100;
    this.revW.gain.value    = rvW / 50;
  }

  setRRDrive(v) { if (this.ready) this.rrIns.curve = distCurve(v * 4); }

  // ── Drum sounds ──────────────────────────────────────────────────────────
  playKick(t) {
    const { ctx, chD } = this;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(160, t); o.frequency.exponentialRampToValueAtTime(0.01, t + 0.5);
    g.gain.setValueAtTime(1.2, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
    o.connect(g); g.connect(chD.gain); o.start(t); o.stop(t + 0.5);
  }

  playSnare(t) {
    const { ctx, chD } = this;
    const len = ctx.sampleRate * 0.22, buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0); for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const ns = ctx.createBufferSource(); ns.buffer = buf;
    const f  = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 900;
    const g  = ctx.createGain(); g.gain.setValueAtTime(1, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
    ns.connect(f); f.connect(g); g.connect(chD.gain); ns.start(t); ns.stop(t + 0.22);
    const o = ctx.createOscillator(), og = ctx.createGain();
    o.frequency.value = 200;
    og.gain.setValueAtTime(0.8, t); og.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
    o.connect(og); og.connect(chD.gain); o.start(t); o.stop(t + 0.08);
  }

  playHH(t) {
    const { ctx, chD } = this;
    const len = ctx.sampleRate * 0.07, buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0); for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const ns = ctx.createBufferSource(); ns.buffer = buf;
    const f  = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 9000; f.Q.value = 0.5;
    const g  = ctx.createGain(); g.gain.setValueAtTime(0.5, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
    ns.connect(f); f.connect(g); g.connect(chD.gain); ns.start(t); ns.stop(t + 0.07);
  }

  playBass(t, freq = 82) {
    const { ctx, chD } = this;
    const o = ctx.createOscillator(), lp = ctx.createBiquadFilter(), g = ctx.createGain();
    o.type = 'sawtooth'; o.frequency.value = freq;
    lp.type = 'lowpass'; lp.frequency.value = 450; lp.Q.value = 2;
    g.gain.setValueAtTime(0.9, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
    o.connect(lp); lp.connect(g); g.connect(chD.gain); o.start(t); o.stop(t + 0.28);
  }

  // ── Poly Synth ───────────────────────────────────────────────────────────
  playSynth({ freq, wave, atk, rel, filter }) {
    if (!this.ready) return;
    const { ctx, chS } = this, now = ctx.currentTime;
    const o = ctx.createOscillator(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    o.type = wave; o.frequency.value = freq;
    f.type = 'lowpass'; f.frequency.value = filter; f.Q.value = 2;
    g.gain.setValueAtTime(0, now); g.gain.linearRampToValueAtTime(0.8, now + atk);
    g.gain.exponentialRampToValueAtTime(0.001, now + atk + rel);
    o.connect(f); f.connect(g); g.connect(chS.gain); o.start(now); o.stop(now + atk + rel + 0.05);
  }

  // ── Road Rash FM — 3-osc unison + FM modulation ──────────────────────────
  playRR(freq, t, dur, { mr, mi, det, flt, atk, rel }) {
    if (!this.ready) return;
    const { ctx, rrIns } = this;
    const atkS = atk / 1000, relS = rel / 1000;

    const mod = ctx.createOscillator(); mod.type = 'sine'; mod.frequency.value = freq * mr;
    const mg  = ctx.createGain(); mg.gain.value = freq * mi;
    mod.connect(mg);

    const lpf = ctx.createBiquadFilter(); lpf.type = 'lowpass'; lpf.frequency.value = flt; lpf.Q.value = 3;
    const eg  = ctx.createGain();
    eg.gain.setValueAtTime(0, t);
    eg.gain.linearRampToValueAtTime(0.55, t + atkS);
    eg.gain.setValueAtTime(0.55, t + Math.max(atkS, dur - relS));
    eg.gain.exponentialRampToValueAtTime(0.001, t + dur + relS);
    lpf.connect(eg); eg.connect(rrIns);

    [0, det, -det].forEach(d => {
      const osc = ctx.createOscillator(); osc.type = 'sawtooth';
      osc.frequency.value = freq; osc.detune.value = d;
      mg.connect(osc.frequency);
      osc.connect(lpf); osc.start(t); osc.stop(t + dur + relS + 0.05);
    });
    mod.start(t); mod.stop(t + dur + relS + 0.05);
  }

  // ── Sampler ──────────────────────────────────────────────────────────────
  playPad(buf, vol, pitch) {
    if (!this.ready || !buf) return;
    const { ctx, chP } = this;
    const src = ctx.createBufferSource(); src.buffer = buf;
    src.playbackRate.value = Math.pow(2, pitch / 12);
    const g = ctx.createGain(); g.gain.value = vol / 100;
    src.connect(g); g.connect(chP.gain); src.start();
  }
}

const engine = new Engine();

// ─── DEFAULT STATE FACTORIES ──────────────────────────────────────────────────
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
  drums:  { vol: 80, pan: 0, mute: false, solo: false },
  synth:  { vol: 75, pan: 0, mute: false, solo: false },
  rr:     { vol: 70, pan: 0, mute: false, solo: false },
  samp:   { vol: 80, pan: 0, mute: false, solo: false },
  master: { vol: 85, pan: 0 },
});

// ─── HELPERS ─────────────────────────────────────────────────────────────────
const mono = "'JetBrains Mono','Fira Code','Courier New',monospace";

const C = {
  bg:     '#090909', rack:  '#0d0d0d', surf:  '#111',
  border: '#1c1c1c', hi:    '#222',    dim:   '#2a2a2a',
  text:   '#888',    muted: '#444',
};

// Rack unit ear (left/right metal side-panel with screws)
function Ear({ side = 'left' }) {
  const style = {
    width: 20, flexShrink: 0,
    background: side === 'left'
      ? 'linear-gradient(to right,#181818,#202020)'
      : 'linear-gradient(to left,#181818,#202020)',
    borderLeft:  side === 'left'  ? `1px solid ${C.dim}` : 'none',
    borderRight: side === 'right' ? `1px solid ${C.dim}` : 'none',
    display: 'flex', flexDirection: 'column', alignItems: 'center',
    justifyContent: 'space-around', padding: '4px 0',
  };
  return (
    <div style={style}>
      {[0,1,2].map(i => (
        <div key={i} style={{
          width: 9, height: 9, borderRadius: '50%',
          background: 'radial-gradient(circle at 35% 30%,#3a3a3a,#181818)',
          border: '1px solid #2a2a2a', position: 'relative',
        }}>
          <div style={{ position:'absolute', inset:0, display:'flex', alignItems:'center', justifyContent:'center' }}>
            <div style={{ width: '60%', height: 1, background: '#333', position:'absolute' }} />
            <div style={{ width: 1, height: '60%', background: '#333', position:'absolute' }} />
          </div>
        </div>
      ))}
    </div>
  );
}

// Device header bar — click to collapse
function DevHeader({ label, subtitle, col, open, onToggle, ledOn = true }) {
  return (
    <div onClick={onToggle} style={{
      height: 22, padding: '0 10px', display: 'flex', alignItems: 'center', gap: 7,
      cursor: 'pointer', fontSize: 9, letterSpacing: 2, fontWeight: 700,
      textTransform: 'uppercase', borderBottom: `1px solid rgba(0,0,0,0.5)`,
      background: `linear-gradient(to right, ${col}18, ${col}10)`,
      userSelect: 'none',
    }}>
      <div style={{
        width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
        background: ledOn ? col : C.muted,
        boxShadow: ledOn ? `0 0 5px ${col}` : 'none',
      }} />
      <span style={{ color: col }}>{label}</span>
      {subtitle && <span style={{ fontSize: 8, color: `${col}60`, marginLeft: 4 }}>{subtitle}</span>}
      <span style={{ marginLeft: 'auto', fontSize: 8, color: C.muted }}>{open ? '▼' : '►'}</span>
    </div>
  );
}

// Rack unit wrapper
function RackUnit({ children, bgColor = '#0f0f0f' }) {
  return (
    <div style={{
      display: 'flex', flexShrink: 0,
      boxShadow: '0 1px 4px #000',
      borderTop: `1px solid ${C.dim}`,
      borderBottom: `1px solid #000`,
    }}>
      <Ear side="left" />
      <div style={{ flex: 1, background: bgColor, overflow: 'hidden' }}>
        {children}
      </div>
      <Ear side="right" />
    </div>
  );
}

// Small knob (drag up/down to change value)
function Knob({ val, min, max, step = 1, col, label, dispVal, onVal, size = 24 }) {
  const dragging = useRef(false), startY = useRef(0), startV = useRef(val);
  const pct = (val - min) / (max - min);
  const ang = -145 + pct * 290;

  useEffect(() => {
    const onMove = e => {
      if (!dragging.current) return;
      const dy = startY.current - e.clientY;
      let nv = startV.current + (dy / 120) * (max - min);
      nv = Math.round(nv / step) * step;
      nv = Math.max(min, Math.min(max, nv));
      onVal(nv);
    };
    const onUp = () => { dragging.current = false; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, [min, max, step, onVal]);

  return (
    <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:2, flexShrink:0 }}>
      <div
        onMouseDown={e => { dragging.current=true; startY.current=e.clientY; startV.current=val; e.preventDefault(); }}
        style={{
          width: size, height: size, borderRadius: '50%', cursor: 'ns-resize',
          background: 'radial-gradient(circle at 38% 32%,#444,#1a1a1a)',
          border: `2px solid #0e0e0e`, boxShadow: `0 2px 4px #000`,
          position: 'relative',
        }}
      >
        <div style={{
          position:'absolute', top: '12%', left: '50%',
          width: 2, height: '30%', borderRadius: 1,
          background: col, boxShadow: `0 0 4px ${col}`,
          transformOrigin: 'bottom center',
          transform: `translateX(-50%) rotate(${ang}deg)`,
        }} />
      </div>
      <div style={{ fontSize: 7, color: C.muted, letterSpacing: 0.5, textTransform:'uppercase' }}>{label}</div>
      {dispVal != null && <div style={{ fontSize: 7, color: col, fontFamily: mono }}>{dispVal}</div>}
    </div>
  );
}

// Small utility button
function SBtn({ label, active, col, onClick, style: extra }) {
  return (
    <button onClick={onClick} style={{
      fontFamily: mono, fontSize: 8, letterSpacing: 1, textTransform: 'uppercase',
      padding: '3px 7px', borderRadius: 2, cursor: 'pointer',
      border: `1px solid ${active ? col : C.dim}`,
      background: active ? col : 'transparent',
      color: active ? '#000' : C.text,
      fontWeight: active ? 700 : 400,
      ...extra,
    }}>{label}</button>
  );
}

// Sequencer step LED
function SeqStep({ on, cur, col, label, onClick }) {
  return (
    <div onClick={onClick} style={{
      flex: 1, height: 18, borderRadius: 2, cursor: 'pointer',
      border: `1px solid ${on ? col+'55' : C.border}`,
      background: on ? col+'55' : '#0c0c0c',
      outline: cur ? `1px solid rgba(255,255,255,0.3)` : 'none',
      outlineOffset: -1,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: 6, color: col, fontWeight: 700,
      transition: 'background 0.04s',
      minWidth: 0, overflow: 'hidden',
    }}>{on && label ? label : ''}</div>
  );
}

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────
export default function App() {
  // Auth
  const [authed, setAuthed]     = useState(false);
  const [loginU, setLoginU]     = useState('');
  const [loginP, setLoginP]     = useState('');
  const [loginErr, setLoginErr] = useState('');

  // Transport
  const [playing, setPlaying] = useState(false);
  const [bpm, setBpmState]    = useState(120);
  const [step, setStep]       = useState(-1);

  // Sequencer
  const [seq, setSeq] = useState(mkSeq());

  // Synth
  const [sWave, setSWave] = useState('sawtooth');
  const [sNote, setSNote] = useState('A');
  const [sOct,  setSoct]  = useState(4);
  const [sAtk,  setSatk]  = useState(20);
  const [sRel,  setSrel]  = useState(600);
  const [sFlt,  setSflt]  = useState(2000);

  // Road Rash
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
    Array(8).fill(null).map((_,i) => ({ name:`PAD ${i+1}`, buf:null, vol:100, pitch:0 }))
  );

  // Mixer
  const [mx, setMx] = useState(mkMix());

  // FX
  const [fxDist, setFxDist] = useState(0);
  const [fxDlyT, setFxDlyT] = useState(30);
  const [fxDlyFb, setFxDlyFb] = useState(25);
  const [fxDlyW, setFxDlyW]   = useState(0);
  const [fxRvW,  setFxRvW]    = useState(0);

  // Device collapse state
  const [open, setOpen] = useState({ mix:true, drum:true, syn:true, rr:true, samp:true, fx:false });

  // ── Scheduler refs ─────────────────────────────────────────────────────────
  const schedRef = useRef(null);
  const stepRef  = useRef(0);
  const nextTRef = useRef(0);
  const bpmRef   = useRef(bpm);
  const seqRef   = useRef(seq);
  const rrRef    = useRef({ mr:rrMR, mi:rrMI, det:rrDet, flt:rrFlt, atk:rrAtk, rel:rrRel });
  const synthRef = useRef({ wave:sWave, note:sNote, oct:sOct, atk:sAtk, rel:sRel, flt:sFlt });
  const rrArpRef = useRef(rrArp);
  const padsRef  = useRef(pads);

  bpmRef.current   = bpm;
  seqRef.current   = seq;
  rrRef.current    = { mr:rrMR, mi:rrMI, det:rrDet, flt:rrFlt, atk:rrAtk, rel:rrRel };
  synthRef.current = { wave:sWave, note:sNote, oct:sOct, atk:sAtk, rel:sRel, flt:sFlt };
  rrArpRef.current = rrArp;
  padsRef.current  = pads;

  const ea = useCallback(() => { engine.init(); engine.resume(); }, []);

  // ── Apply side-effects ────────────────────────────────────────────────────
  useEffect(() => { engine.applyMixer(mx); }, [mx]);
  useEffect(() => { engine.applyFX({ dist:fxDist, dlyT:fxDlyT, dlyFb:fxDlyFb, dlyW:fxDlyW, rvW:fxRvW }); }, [fxDist,fxDlyT,fxDlyFb,fxDlyW,fxRvW]);
  useEffect(() => { engine.setRRDrive(rrDrv); }, [rrDrv]);

  // ── Sequencer scheduler ───────────────────────────────────────────────────
  const schedStep = useCallback((s, t) => {
    const q = seqRef.current;
    const syn = synthRef.current;
    const rr  = rrRef.current;
    const spb = (60 / bpmRef.current) / 4;

    if (q.kick[s])  engine.playKick(t);
    if (q.snare[s]) engine.playSnare(t);
    if (q.hh[s])    engine.playHH(t);
    if (q.bass[s])  engine.playBass(t, 82 + (s % 8) * 3);

    if (q.synth[s]) {
      const n = q.synth[s];
      engine.playSynth({ freq:noteFreq(n.note,n.oct), wave:syn.wave, atk:syn.atk/1000, rel:syn.rel/1000, filter:syn.flt });
    }

    if (rrArpRef.current && q.rr[s]) {
      const r = q.rr[s];
      if (r?.note) engine.playRR(noteFreq(r.note, r.oct), t, spb * 0.85, rr);
    }

    if (q.samp[s] != null) {
      const pad = padsRef.current[q.samp[s]];
      if (pad?.buf) engine.playPad(pad.buf, pad.vol, pad.pitch);
    }
  }, []);

  const startSeq = useCallback(() => {
    ea();
    stepRef.current = 0;
    nextTRef.current = engine.ctx.currentTime + 0.05;
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

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = e => {
      if (e.target.tagName === 'INPUT') return;
      if (e.key === ' ') { e.preventDefault(); setPlaying(p => !p); return; }
      const i = PAD_KEYS.indexOf(e.key.toUpperCase());
      if (i >= 0) { ea(); engine.playPad(pads[i].buf, pads[i].vol, pads[i].pitch); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pads, ea]);

  // ── Sequencer toggle ──────────────────────────────────────────────────────
  const toggleStep = useCallback((trackId, si) => {
    ea();
    setSeq(prev => {
      const next = { ...prev, [trackId]: [...prev[trackId]] };
      const track = SEQ_TRACKS.find(t => t.id === trackId);
      const cur = next[trackId][si];

      if (!track.pitched) {
        next[trackId][si] = !cur;
        if (next[trackId][si]) {
          if (trackId==='kick')  engine.playKick(engine.ctx.currentTime);
          if (trackId==='snare') engine.playSnare(engine.ctx.currentTime);
          if (trackId==='hh')    engine.playHH(engine.ctx.currentTime);
          if (trackId==='bass')  engine.playBass(engine.ctx.currentTime);
        }
      } else if (track.pitched === 'pad') {
        next[trackId][si] = cur == null ? 0 : cur < 7 ? cur + 1 : null;
      } else {
        // pitched — cycle through notes
        if (!cur) {
          const sn = synthRef.current;
          const n = track.id === 'rr' ? { note:'E', oct:2 } : { note:sn.note, oct:sn.oct };
          next[trackId][si] = n;
          engine.playSynth({ freq:noteFreq(n.note,n.oct), wave:synthRef.current.wave, atk:0.01, rel:0.2, filter:synthRef.current.flt });
        } else if (cur.note) {
          const ni = NOTES.indexOf(cur.note);
          if (ni < NOTES.length - 1) next[trackId][si] = { note:NOTES[ni+1], oct:cur.oct };
          else if (cur.oct < 5) next[trackId][si] = { note:'C', oct:cur.oct+1 };
          else next[trackId][si] = null;
        }
      }
      return next;
    });
  }, [ea]);

  // ── Mixer helpers ─────────────────────────────────────────────────────────
  const updMx = (key, field, val) =>
    setMx(m => ({ ...m, [key]: { ...m[key], [field]: val } }));

  // ── Pad loader ────────────────────────────────────────────────────────────
  const loadPad = async (i, file) => {
    ea();
    const buf = await engine.ctx.decodeAudioData(await file.arrayBuffer());
    setPads(p => p.map((pd, pi) => pi === i
      ? { ...pd, buf, name: file.name.replace(/\.[^.]+$/, '').slice(0, 12) }
      : pd));
  };

  // ── Styles ────────────────────────────────────────────────────────────────
  const devBody = { display:'flex', alignItems:'center', padding:'7px 10px', gap:10, flexWrap:'wrap' };

  const inputStyle = {
    fontFamily: mono, background: C.bg, border: `1px solid ${C.dim}`,
    color: '#ccc', padding: '9px 13px', fontSize: 12, outline: 'none',
  };

  // ── LOGIN ─────────────────────────────────────────────────────────────────
  if (!authed) return (
    <div style={{ minHeight:'100vh', background:C.bg, display:'flex', alignItems:'center', justifyContent:'center', fontFamily:mono }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&display=swap');*{box-sizing:border-box;margin:0;padding:0}`}</style>
      <div style={{ width:320, background:C.surf, border:`1px solid #C04020`, padding:'36px 40px' }}>
        <div style={{ fontSize:9, color:'#C04020', letterSpacing:3, marginBottom:6 }}>◆ LIVE RIG SYSTEM</div>
        <div style={{ fontSize:22, fontWeight:700, letterSpacing:2, marginBottom:24, color:'#aaa' }}>ACCESS</div>
        {[['text',loginU,setLoginU,'USERNAME'],['password',loginP,setLoginP,'PASSWORD']].map(([t,v,s,ph]) => (
          <input key={ph} type={t} placeholder={ph} value={v} onChange={e => s(e.target.value)}
            onKeyDown={e => e.key==='Enter' && (loginU&&loginP ? setAuthed(true) : setLoginErr('ENTER CREDENTIALS'))}
            style={{ ...inputStyle, display:'block', width:'100%', marginBottom:10 }} />
        ))}
        {loginErr && <div style={{ fontSize:10, color:'#C04020', marginBottom:10 }}>{loginErr}</div>}
        <button
          onClick={() => loginU&&loginP ? setAuthed(true) : setLoginErr('ENTER CREDENTIALS')}
          style={{ fontFamily:mono, width:'100%', padding:12, fontSize:12, letterSpacing:2, background:'#C04020', color:'#fff', border:'none', cursor:'pointer', fontWeight:700 }}>
          ENTER →
        </button>
        <div style={{ fontSize:9, color:C.muted, textAlign:'center', marginTop:14 }}>DEMO: ANY CREDENTIALS</div>
      </div>
    </div>
  );

  // ── MAIN APP ──────────────────────────────────────────────────────────────
  return (
    <div style={{ height:'100vh', display:'flex', flexDirection:'column', background:C.bg, fontFamily:mono, color:C.text, overflow:'hidden' }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&display=swap');
        *{box-sizing:border-box;margin:0;padding:0}
        input[type=range]{-webkit-appearance:none;height:3px;background:#1e1e1e;border-radius:2px;outline:none}
        input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:12px;height:12px;border-radius:50%;cursor:pointer;background:#888}
        ::-webkit-scrollbar{width:4px;height:4px}
        ::-webkit-scrollbar-track{background:#0a0a0a}
        ::-webkit-scrollbar-thumb{background:#2a2a2a}
        button:hover{filter:brightness(1.25)}
        input:focus{outline:none}
      `}</style>

      {/* ── TRANSPORT BAR ── */}
      <div style={{ height:44, flexShrink:0, background:'#111', borderBottom:`2px solid #000`, display:'flex', alignItems:'center', gap:12, padding:'0 14px' }}>
        <div style={{ fontSize:10, fontWeight:700, letterSpacing:3, color:'#333', paddingRight:14, borderRight:`1px solid ${C.dim}`, flexShrink:0 }}>◆ LIVE RIG</div>

        <button
          onClick={() => { ea(); setPlaying(p => !p); }}
          style={{ fontFamily:mono, fontSize:10, letterSpacing:2, padding:'5px 14px', border:'none', borderRadius:2, cursor:'pointer', fontWeight:700, background:playing?'#C04020':'#1a3a20', color:playing?'#fff':'#4ade80', flexShrink:0 }}>
          {playing ? '■ STOP' : '▶ PLAY'}
        </button>

        <div style={{ background:'#000', border:`1px solid ${C.dim}`, padding:'3px 10px', borderRadius:2, display:'flex', alignItems:'center', gap:6, flexShrink:0 }}>
          <div>
            <div style={{ fontSize:7, color:C.muted, letterSpacing:1 }}>BPM</div>
            <div style={{ fontSize:20, fontWeight:700, color:'#E8950A', letterSpacing:1 }}>{bpm}</div>
          </div>
          <div style={{ display:'flex', flexDirection:'column', gap:1 }}>
            {[['▲',1],['▼',-1]].map(([l,d]) => (
              <button key={l} onClick={() => setBpmState(b => Math.max(60,Math.min(200,b+d)))}
                style={{ width:14, height:12, background:'#1e1e1e', border:`1px solid ${C.dim}`, color:C.muted, fontSize:8, cursor:'pointer', fontFamily:mono, padding:0, lineHeight:1 }}>{l}</button>
            ))}
          </div>
        </div>

        <input type="range" min={60} max={200} value={bpm}
          onChange={e => setBpmState(+e.target.value)}
          style={{ width:100, '--thumb-color':'#E8950A' }} />

        <div style={{ background:'#000', border:`1px solid ${C.dim}`, padding:'3px 10px', borderRadius:2, fontSize:11, fontWeight:700, color:playing?'#4ade80':C.muted, letterSpacing:2, minWidth:80, flexShrink:0 }}>
          {playing ? `STEP ${String(step+1).padStart(2,'0')}/16` : 'STOPPED'}
        </div>

        <div style={{ marginLeft:'auto', fontSize:8, color:C.muted, letterSpacing:2 }}>
          RR ARP: <span style={{ color:rrArp?'#C09020':C.muted }}>{rrArp?'ON':'OFF'}</span>
        </div>
      </div>

      {/* ── RACK ── */}
      <div style={{ flex:1, overflowY:'auto', background:'#0d0d0d', display:'flex', flexDirection:'column', gap:2, padding:'4px 6px' }}>

        {/* 1 ── MIXER */}
        <RackUnit bgColor="#0a1020">
          <DevHeader label="14:2 Mixer" subtitle="CHANNEL ROUTING" col="#4080D0" open={open.mix} onToggle={() => setOpen(o => ({...o, mix:!o.mix}))} />
          {open.mix && (
            <div style={{ display:'flex', overflowX:'auto', background:'#080e1c', padding:'8px 12px', gap:0 }}>
              {MIX_CHANNELS.map(({ key, name, col }) => {
                const m = key==='master' ? mx.master : mx[key];
                const isMaster = key === 'master';
                return (
                  <div key={key} style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:4, padding:'6px 14px', borderRight:`1px solid ${C.border}`, minWidth:80, ...(isMaster?{borderLeft:`2px solid ${C.dim}`,marginLeft:6}:{}) }}>
                    <div style={{ fontSize:8, fontWeight:700, color:col, letterSpacing:1, whiteSpace:'nowrap' }}>{name}</div>
                    {!isMaster && (
                      <div style={{ display:'flex', gap:3 }}>
                        <SBtn label="S" active={m.solo} col={col} onClick={() => updMx(key,'solo',!m.solo)} />
                        <SBtn label="M" active={m.mute} col="#C04020" onClick={() => updMx(key,'mute',!m.mute)} />
                      </div>
                    )}
                    {/* Vertical fader */}
                    <div style={{ height:90, display:'flex', alignItems:'center', justifyContent:'center', overflow:'hidden', width:28 }}>
                      <input type="range" min={0} max={100} value={m.vol}
                        onChange={e => updMx(key,'vol',+e.target.value)}
                        style={{ width:90, transform:'rotate(-90deg)', transformOrigin:'center', cursor:'pointer', margin:0 }} />
                    </div>
                    <div style={{ fontSize:9, fontWeight:700, color:col, fontFamily:mono }}>{m.vol}%</div>
                    <div style={{ fontSize:7, color:C.muted, letterSpacing:1 }}>PAN</div>
                    <input type="range" min={-100} max={100} value={m.pan}
                      onChange={e => updMx(key,'pan',+e.target.value)}
                      style={{ width:60 }} />
                    <div style={{ fontSize:9, color:C.muted, fontFamily:mono }}>
                      {m.pan === 0 ? 'C' : m.pan > 0 ? `R${m.pan}` : `L${Math.abs(m.pan)}`}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </RackUnit>

        {/* 2 ── DRUM MACHINE */}
        <RackUnit bgColor="#110906">
          <DevHeader label="Drum Machine" subtitle="PATTERN → SEQ MIDI" col="#C04020" open={open.drum} onToggle={() => setOpen(o => ({...o, drum:!o.drum}))} />
          {open.drum && (
            <div style={{ ...devBody, alignItems:'flex-start' }}>
              <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
                {DRUM_IDS.map((id, ti) => (
                  <div key={id} style={{ display:'flex', alignItems:'center', gap:4 }}>
                    <div style={{ width:40, fontSize:8, color:DRUM_COLS[ti]+'88', letterSpacing:1, textAlign:'right', flexShrink:0 }}>{DRUM_NAMES[ti]}</div>
                    <div style={{ display:'flex', gap:2 }}>
                      {Array(16).fill(0).map((_,si) => (
                        <div key={si} style={{ display:'flex', alignItems:'center', gap:2 }}>
                          {si > 0 && si % 4 === 0 && <div style={{ width:1, height:18, background:C.dim }} />}
                          <div onClick={() => toggleStep(id, si)} style={{
                            width:18, height:18, borderRadius:2, cursor:'pointer', flexShrink:0,
                            background: seq[id][si] ? DRUM_COLS[ti]+'88' : '#141414',
                            border: `1px solid ${seq[id][si] ? DRUM_COLS[ti]+'44' : C.border}`,
                            outline: si === step ? `1px solid rgba(255,255,255,0.4)` : 'none',
                            outlineOffset: -1, transition:'background 0.04s',
                          }} />
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              <div style={{ display:'flex', gap:10, paddingLeft:10, borderLeft:`1px solid ${C.dim}` }}>
                <Knob val={80} min={0} max={100} col="#C04020" label="TONE"  dispVal="80%" onVal={() => {}} />
                <Knob val={60} min={0} max={100} col="#C04020" label="DECAY" dispVal="60%" onVal={() => {}} />
              </div>
            </div>
          )}
        </RackUnit>

        {/* 3 ── POLY SYNTH */}
        <RackUnit bgColor="#060f1a">
          <DevHeader label="Poly Synth" subtitle="WEB AUDIO · POLYPHONIC" col="#2090C0" open={open.syn} onToggle={() => setOpen(o => ({...o, syn:!o.syn}))} />
          {open.syn && (
            <div style={{ ...devBody }}>
              {/* Waveform */}
              <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
                <div style={{ fontSize:7, color:'#305070', letterSpacing:1 }}>WAVEFORM</div>
                <div style={{ display:'flex', gap:3 }}>
                  {WAVEFORMS.map(w => <SBtn key={w} label={w.slice(0,3).toUpperCase()} active={sWave===w} col="#2090C0" onClick={() => setSWave(w)} />)}
                </div>
                <div style={{ fontSize:7, color:'#305070', letterSpacing:1, marginTop:4 }}>OCTAVE</div>
                <div style={{ display:'flex', gap:3 }}>
                  {[2,3,4,5,6].map(o => <SBtn key={o} label={String(o)} active={sOct===o} col="#2090C0" onClick={() => setSoct(o)} />)}
                </div>
              </div>
              {/* Knobs */}
              <Knob val={sAtk} min={1} max={2000} col="#2090C0" label="ATK" dispVal={sAtk+'ms'} onVal={setSatk} />
              <Knob val={sRel} min={50} max={4000} col="#2090C0" label="REL" dispVal={sRel+'ms'} onVal={setSrel} />
              <Knob val={sFlt} min={100} max={8000} col="#2090C0" label="FILT" dispVal={sFlt>999?Math.round(sFlt/100)/10+'k':sFlt} onVal={setSflt} size={28} />
              {/* Notes */}
              <div>
                <div style={{ fontSize:7, color:'#305070', letterSpacing:1, marginBottom:4 }}>NOTE — click to play</div>
                <div style={{ display:'flex', gap:2, flexWrap:'wrap', maxWidth:190 }}>
                  {NOTES.map(n => (
                    <SBtn key={n} label={n} active={sNote===n} col="#2090C0"
                      onClick={() => { setSNote(n); ea(); engine.playSynth({ freq:noteFreq(n,sOct), wave:sWave, atk:sAtk/1000, rel:sRel/1000, filter:sFlt }); }} />
                  ))}
                </div>
              </div>
              {/* Display */}
              <div style={{ fontFamily:mono, fontSize:13, fontWeight:700, color:'#2090C0', background:'#020810', border:`1px solid #0a2030`, padding:'4px 10px', borderRadius:2, letterSpacing:2, alignSelf:'flex-start' }}>
                {sNote}{sOct} · {noteFreq(sNote,sOct).toFixed(0)}Hz
              </div>
            </div>
          )}
        </RackUnit>

        {/* 4 ── ROAD RASH FM SYNTH */}
        <RackUnit bgColor="#100d06">
          <DevHeader label="Road Rash FM Synth" subtitle="YM2612 STYLE · 3-OSC UNISON" col="#C09020" open={open.rr} onToggle={() => setOpen(o => ({...o, rr:!o.rr}))} />
          {open.rr && (
            <div style={{ ...devBody }}>
              <Knob val={rrMR}  min={0.1} max={4}    step={0.1} col="#D0A030" label="MOD R" dispVal={rrMR.toFixed(1)}  onVal={setRrMR}  />
              <Knob val={rrMI}  min={0}   max={8}    step={0.1} col="#D0A030" label="MOD I" dispVal={rrMI.toFixed(1)}  onVal={setRrMI}  />
              <Knob val={rrDet} min={0}   max={50}              col="#D0A030" label="DET"   dispVal={rrDet+'ct'}       onVal={setRrDet} />
              <Knob val={rrFlt} min={200} max={6000} step={10}  col="#C09020" label="FILT"  dispVal={rrFlt}            onVal={setRrFlt} size={28} />
              <Knob val={rrAtk} min={1}   max={200}             col="#C08020" label="ATK"   dispVal={rrAtk+'ms'}       onVal={setRrAtk} />
              <Knob val={rrRel} min={20}  max={800}             col="#C08020" label="REL"   dispVal={rrRel+'ms'}       onVal={setRrRel} />
              <Knob val={rrDrv} min={0}   max={100}             col="#E08010" label="DRIVE" dispVal={rrDrv+'%'}        onVal={setRrDrv} />
              <div style={{ display:'flex', flexDirection:'column', gap:4, paddingLeft:10, borderLeft:`1px solid ${C.dim}` }}>
                <SBtn label={rrArp?'ARP ON':'ARP OFF'} active={rrArp} col="#C09020" onClick={() => setRrArp(v=>!v)} />
                <SBtn label="▶ TEST" active={false} col="#C09020"
                  onClick={() => { ea(); engine.playRR(noteFreq('E',2), engine.ctx.currentTime, 0.5, {mr:rrMR,mi:rrMI,det:rrDet,flt:rrFlt,atk:rrAtk,rel:rrRel}); }} />
              </div>
              <div style={{ fontFamily:mono, fontSize:11, fontWeight:700, color:'#C09020', background:'#080600', border:`1px solid #2a1e00`, padding:'4px 10px', borderRadius:2, letterSpacing:1, alignSelf:'flex-start' }}>
                {`FM  R=${rrMR.toFixed(1)}  I=${rrMI.toFixed(1)}  DRV=${rrDrv}%`}
              </div>
            </div>
          )}
        </RackUnit>

        {/* 5 ── SAMPLER */}
        <RackUnit bgColor="#060e08">
          <DevHeader label="Sampler NN-8" subtitle="8 PADS · Q–F KEYS" col="#30A040" open={open.samp} onToggle={() => setOpen(o => ({...o, samp:!o.samp}))} />
          {open.samp && (
            <div style={{ ...devBody }}>
              <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:5, width:'100%', maxWidth:380 }}>
                {pads.map((pad, i) => (
                  <div key={i} style={{ display:'flex', flexDirection:'column', gap:3 }}>
                    <div
                      onClick={() => {
                        if (pad.buf) { ea(); engine.playPad(pad.buf, pad.vol, pad.pitch); }
                        else document.getElementById(`fi-${i}`).click();
                      }}
                      style={{
                        border: `1px solid ${pad.buf?'#30A04050':C.border}`, borderRadius:3,
                        background: pad.buf ? '#081408' : '#080808',
                        cursor:'pointer', height:52,
                        display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:3,
                      }}
                    >
                      <div style={{ fontSize:8, color:'#1a3a20', letterSpacing:1 }}>{PAD_KEYS[i]}</div>
                      {pad.buf
                        ? <div style={{ fontSize:8, color:'#30A040', fontWeight:700, textAlign:'center', wordBreak:'break-all', padding:'0 4px' }}>{pad.name}</div>
                        : <div style={{ fontSize:8, color:C.muted }}>EMPTY</div>
                      }
                    </div>
                    {pad.buf && (
                      <div style={{ display:'flex', gap:3 }}>
                        <SBtn label="LOAD" active={false} col="#30A040" onClick={() => document.getElementById(`fi-${i}`).click()} style={{ flex:1, padding:'2px 0' }} />
                        <SBtn label="✕"   active={false} col="#C04020" onClick={() => setPads(p => p.map((pd,pi) => pi===i ? {...pd,buf:null,name:`PAD ${i+1}`} : pd))} />
                      </div>
                    )}
                    <input id={`fi-${i}`} type="file" accept="audio/*" style={{ display:'none' }}
                      onChange={e => e.target.files[0] && loadPad(i, e.target.files[0])} />
                  </div>
                ))}
              </div>
            </div>
          )}
        </RackUnit>

        {/* 6 ── FX UNIT (collapsed by default) */}
        <RackUnit bgColor="#0a0a0a">
          <DevHeader label="FX Rack" subtitle="POST-MASTER · DIST · DELAY · REVERB" col="#6060B0" open={open.fx} onToggle={() => setOpen(o => ({...o, fx:!o.fx}))} />
          {open.fx && (
            <div style={{ ...devBody }}>
              {[
                ['DIST',fxDist,setFxDist,0,100,'#993556'],
                ['DLY T',fxDlyT,setFxDlyT,5,100,'#185FA5'],
                ['DLY FB',fxDlyFb,setFxDlyFb,0,85,'#185FA5'],
                ['DLY W',fxDlyW,setFxDlyW,0,100,'#185FA5'],
                ['REVERB',fxRvW,setFxRvW,0,100,'#534AB7'],
              ].map(([lbl,v,set,mn,mx,col]) => (
                <Knob key={lbl} val={v} min={mn} max={mx} col={col} label={lbl} dispVal={v+'%'} onVal={set} />
              ))}
            </div>
          )}
        </RackUnit>

      </div>{/* /rack */}

      {/* ── MIDI SEQUENCER ── */}
      <div style={{ height:210, flexShrink:0, background:'#080808', borderTop:`2px solid #000`, display:'flex', flexDirection:'column' }}>

        {/* Seq header */}
        <div style={{ height:24, background:'#0e0e0e', borderBottom:`1px solid ${C.dim}`, display:'flex', alignItems:'center', padding:'0 10px', gap:10, flexShrink:0 }}>
          <span style={{ fontSize:8, letterSpacing:3, color:C.muted }}>◈ MIDI SEQUENCER — ALL DEVICES</span>
          <span style={{ fontSize:8, color:C.border, marginLeft:'auto' }}>CLICK STEP TO PROGRAM · PITCHED = CYCLE NOTES</span>
        </div>

        {/* Ruler */}
        <div style={{ height:14, background:'#0b0b0b', borderBottom:`1px solid ${C.dim}`, display:'flex', flexShrink:0 }}>
          <div style={{ width:120, flexShrink:0, borderRight:`1px solid ${C.dim}` }} />
          <div style={{ flex:1, display:'flex', alignItems:'center', padding:'0 3px', gap:2 }}>
            {Array(16).fill(0).map((_,i) => (
              <div key={i} style={{ display:'flex', alignItems:'center', flex:1, gap:2, minWidth:0 }}>
                {i > 0 && i % 4 === 0 && <div style={{ width:1, height:10, background:C.dim, flexShrink:0 }} />}
                <div style={{ flex:1, fontSize:7, color: i%4===0?'#333':C.border, fontWeight:i%4===0?700:400 }}>
                  {i%4===0 ? Math.floor(i/4)+1 : '·'}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Track rows */}
        <div style={{ flex:1, overflowY:'auto' }}>
          {SEQ_TRACKS.map(({ id, name, col, pitched }) => (
            <div key={id} style={{ height:24, display:'flex', borderBottom:`1px solid #111` }}>
              {/* Label */}
              <div style={{ width:120, flexShrink:0, display:'flex', alignItems:'center', gap:5, padding:'0 7px', borderRight:`1px solid ${C.dim}`, background:'#0a0a0a' }}>
                <div style={{ width:2, height:14, borderRadius:1, background:col, flexShrink:0 }} />
                <div style={{ fontSize:8, letterSpacing:1, color:'#555', textTransform:'uppercase' }}>{name}</div>
              </div>
              {/* Steps */}
              <div style={{ flex:1, display:'flex', alignItems:'center', padding:'0 3px', gap:2 }}>
                {Array(16).fill(0).map((_,si) => {
                  const val = seq[id][si];
                  const on = val != null && val !== false;
                  let label = '';
                  if (on) {
                    if (!pitched) label = '';
                    else if (pitched === 'pad') label = `P${(val||0)+1}`;
                    else if (val?.note) label = val.note + val.oct;
                  }
                  return (
                    <div key={si} style={{ display:'flex', alignItems:'center', flex:1, gap:2, minWidth:0 }}>
                      {si > 0 && si % 4 === 0 && <div style={{ width:1, height:14, background:C.dim, flexShrink:0 }} />}
                      <SeqStep on={on} cur={si===step} col={col} label={label} onClick={() => toggleStep(id, si)} />
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

    </div>
  );
}
