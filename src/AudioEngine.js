/**
 * AudioEngine.js — Live Rig Web Audio Engine
 *
 * What's in this version:
 *   • Per-channel 3-band EQ (low shelf / mid peak / high shelf)
 *   • Drum sounds accept { vel, tune, decay } params
 *   • playChord() — plays all notes in a chord simultaneously on one device
 *   • playString, playRR, playAcid, playPad — unchanged routing
 *   • _genIR / setMasterReverb — algorithmic impulse responses
 */

const NOTES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];

export function noteFreq(n, o) {
  return 440 * Math.pow(2, ((o - 4) * 12 + NOTES.indexOf(n) - 9) / 12);
}

/** Backward-compat helper: normalise a seq step into { notes:[{note,oct},...], len } */
export function stepToChord(step) {
  if (!step) return null;
  if (step.notes) return step;                                        // new format
  if (step.note)  return { notes:[{ note:step.note, oct:step.oct }], len:step.len||1 }; // legacy
  return null;
}

function distCurve(a) {
  const n = 256, c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / n - 1;
    c[i] = a > 0 ? ((Math.PI + a) * x) / (Math.PI + a * Math.abs(x)) : x;
  }
  return c;
}

function makeSimpleRevBuf(ctx) {
  const len = ctx.sampleRate * 2.5, buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random()*2-1) * Math.pow(1-i/len, 2);
  }
  return buf;
}

export class AudioEngine {
  constructor() { this.ctx = null; this.ready = false; }

  init() {
    if (this.ready) return;
    const ctx = this.ctx = new (window.AudioContext || window.webkitAudioContext)();

    // Per-channel: gain → lowShelf → midPeak → highShelf → panner
    const makeCh = (vol, pan) => {
      const gain   = ctx.createGain();           gain.gain.value   = vol / 100;
      const panner = ctx.createStereoPanner();   panner.pan.value  = pan;

      const eqLo  = ctx.createBiquadFilter();
      eqLo.type   = 'lowshelf'; eqLo.frequency.value  = 200;  eqLo.gain.value  = 0;

      const eqMid = ctx.createBiquadFilter();
      eqMid.type  = 'peaking';  eqMid.frequency.value = 1000; eqMid.Q.value = 1.2; eqMid.gain.value = 0;

      const eqHi  = ctx.createBiquadFilter();
      eqHi.type   = 'highshelf'; eqHi.frequency.value = 8000; eqHi.gain.value  = 0;

      gain.connect(eqLo); eqLo.connect(eqMid); eqMid.connect(eqHi); eqHi.connect(panner);
      return { gain, panner, eqLo, eqMid, eqHi };
    };

    this.chD = makeCh(80, 0);   // drums
    this.chS = makeCh(75, 0);   // synth / strings
    this.chR = makeCh(70, 0);   // road rash
    this.chP = makeCh(80, 0);   // sampler

    // Road Rash insert distortion (pre-channel)
    this.rrIns = ctx.createWaveShaper();
    this.rrIns.curve = distCurve(280); this.rrIns.oversample = '4x';
    this.rrIns.connect(this.chR.gain);

    this.master = ctx.createGain(); this.master.gain.value = 0.85;
    [this.chD, this.chS, this.chR, this.chP].forEach(ch => ch.panner.connect(this.master));

    // Post-master FX
    this.dist  = ctx.createWaveShaper(); this.dist.curve = distCurve(0); this.dist.oversample = '4x';
    this.dly   = ctx.createDelay(2.0);  this.dly.delayTime.value = 0.3;
    this.dlyFb = ctx.createGain();      this.dlyFb.gain.value = 0.25;
    this.dlyW  = ctx.createGain();      this.dlyW.gain.value = 0;
    this.dly.connect(this.dlyFb); this.dlyFb.connect(this.dly); this.dly.connect(this.dlyW);
    this.rev  = ctx.createConvolver(); this.rev.buffer = makeSimpleRevBuf(ctx);
    this.revW = ctx.createGain();      this.revW.gain.value = 0; this.rev.connect(this.revW);

    this.master.connect(this.dist);
    this.dist.connect(this.dly); this.dist.connect(this.rev); this.dist.connect(ctx.destination);
    this.dlyW.connect(ctx.destination); this.revW.connect(ctx.destination);
    this.ready = true;
  }

  resume() { if (this.ctx?.state === 'suspended') this.ctx.resume(); }

  // ── Mixer ─────────────────────────────────────────────────────────────────
  applyMixer(mx) {
    if (!this.ready) return;
    const hasSolo = ['drums','synth','rr','samp'].some(k => mx[k]?.solo);
    [['drums',this.chD],['synth',this.chS],['rr',this.chR],['samp',this.chP]].forEach(([k,ch]) => {
      const m = mx[k]; if (!m) return;
      const eff = hasSolo ? (m.solo ? 1 : 0) : (m.mute ? 0 : 1);
      ch.gain.gain.value  = (m.vol / 100) * eff;
      ch.panner.pan.value = (m.pan || 0) / 100;
    });
    if (mx.master) this.master.gain.value = mx.master.vol / 100;
  }

  // Apply 3-band EQ for a named channel ('drums','synth','rr','samp','master')
  applyEQ(chKey, { lo = 0, mid = 0, hi = 0, midFreq = 1000 } = {}) {
    if (!this.ready) return;
    const map = { drums:this.chD, synth:this.chS, rr:this.chR, samp:this.chP };
    const ch  = map[chKey]; if (!ch) return;
    ch.eqLo.gain.value        = Math.max(-24, Math.min(24, lo));
    ch.eqMid.gain.value       = Math.max(-24, Math.min(24, mid));
    ch.eqHi.gain.value        = Math.max(-24, Math.min(24, hi));
    ch.eqMid.frequency.value  = Math.max(200, Math.min(8000, midFreq));
  }

  applyFX({ dist, dlyT, dlyFb, dlyW, rvW }) {
    if (!this.ready) return;
    this.dist.curve          = distCurve((dist||0) / 100 * 400);
    this.dly.delayTime.value = (dlyT||30) / 100;
    this.dlyFb.gain.value    = (dlyFb||25) / 100;
    this.dlyW.gain.value     = (dlyW||0) / 100;
    this.revW.gain.value     = (rvW||0) / 50;
  }

  setRRDrive(v) { if (this.ready) this.rrIns.curve = distCurve(v * 4); }

  // ── Algorithmic IR ────────────────────────────────────────────────────────
  _genIR(room = 'hall', decaySecs = 2.5, damp = 30) {
    const ctx = this.ctx;
    const len = Math.max(1024, Math.floor(ctx.sampleRate * Math.max(0.1, decaySecs)));
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    const alpha = (damp / 100) * 0.92;
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        const t = i / len; let s = Math.random() * 2 - 1;
        if (room==='hall')   s *= Math.pow(1-t, 1.1) * (i < ctx.sampleRate*0.02 ? i/(ctx.sampleRate*0.02) : 1);
        else if (room==='room')   s *= Math.pow(1-t, 3.8) * (i < ctx.sampleRate*0.04 ? Math.pow(i/(ctx.sampleRate*0.04),0.5) : 1);
        else if (room==='plate')  s = s*Math.pow(1-t,2.2) + Math.sin(i*0.047)*0.18*Math.pow(1-t,2.8);
        else if (room==='cath')   { s *= Math.pow(1-t,0.62); s += (Math.random()*2-1)*0.25*Math.pow(1-t,0.4)*(i<len*0.1?i/(len*0.1):1); }
        else if (room==='spring') s = (s*0.55+Math.sin(i*0.092)*0.45)*Math.pow(1-t,3.6);
        else s *= Math.pow(1-t, 2.0);
        d[i] = s * (ch === 0 ? 1 : -1);
      }
      let prev = 0;
      const dd = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) { dd[i] = dd[i]*(1-alpha)+prev*alpha; prev = dd[i]; }
    }
    return buf;
  }

  setMasterReverb({ room='hall', decay=2.5, damp=30 }={}) {
    if (!this.ready) return;
    this.rev.buffer = this._genIR(room, decay, damp);
  }

  // ── Drums — accept { vel, tune, decay } ───────────────────────────────────
  // vel: 0-100, tune: semitones -24..+24, decay: multiplier 0.3..3.0
  playKick(t, { vel=100, tune=0, decay=1.0 }={}) {
    const { ctx, chD } = this;
    const g = ctx.createGain();
    g.gain.setValueAtTime((vel/100)*1.2, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.5*decay);
    const o = ctx.createOscillator();
    const baseFreq = 160 * Math.pow(2, tune/12);
    o.frequency.setValueAtTime(baseFreq, t);
    o.frequency.exponentialRampToValueAtTime(0.01, t + 0.5*decay);
    o.connect(g); g.connect(chD.gain); o.start(t); o.stop(t + 0.5*decay + 0.02);
  }

  playSnare(t, { vel=100, tune=0, decay=1.0 }={}) {
    const { ctx, chD } = this;
    const dur = 0.22 * decay;
    const len = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d   = buf.getChannelData(0);
    for (let i=0;i<len;i++) d[i]=Math.random()*2-1;
    const ns = ctx.createBufferSource(); ns.buffer = buf;
    const f  = ctx.createBiquadFilter(); f.type='highpass'; f.frequency.value=900;
    const g  = ctx.createGain();
    g.gain.setValueAtTime((vel/100)*1.0, t);
    g.gain.exponentialRampToValueAtTime(0.001, t+dur);
    ns.connect(f); f.connect(g); g.connect(chD.gain); ns.start(t); ns.stop(t+dur);
    const o  = ctx.createOscillator(); const og = ctx.createGain();
    o.frequency.value = 200 * Math.pow(2, tune/12);
    og.gain.setValueAtTime((vel/100)*0.8, t); og.gain.exponentialRampToValueAtTime(0.001, t+0.08*decay);
    o.connect(og); og.connect(chD.gain); o.start(t); o.stop(t+0.08*decay+0.02);
  }

  playHH(t, { vel=80, tune=0, decay=1.0, open=false }={}) {
    const { ctx, chD } = this;
    const dur = (open ? 0.4 : 0.07) * decay;
    const len = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d   = buf.getChannelData(0);
    for (let i=0;i<len;i++) d[i]=Math.random()*2-1;
    const ns = ctx.createBufferSource(); ns.buffer = buf;
    const f  = ctx.createBiquadFilter(); f.type='bandpass'; f.frequency.value=9000*(Math.pow(2,tune/12)); f.Q.value=0.5;
    const g  = ctx.createGain();
    g.gain.setValueAtTime((vel/100)*0.55, t);
    g.gain.exponentialRampToValueAtTime(0.001, t+dur);
    ns.connect(f); f.connect(g); g.connect(chD.gain); ns.start(t); ns.stop(t+dur);
  }

  playBass(t, freq=82, { vel=100, tune=0, decay=1.0 }={}) {
    const { ctx, chD } = this;
    const o  = ctx.createOscillator(); o.type='sawtooth';
    o.frequency.value = freq * Math.pow(2, tune/12);
    const lp = ctx.createBiquadFilter(); lp.type='lowpass'; lp.frequency.value=450; lp.Q.value=2;
    const g  = ctx.createGain();
    g.gain.setValueAtTime((vel/100)*0.9, t);
    g.gain.exponentialRampToValueAtTime(0.001, t+0.28*decay);
    o.connect(lp); lp.connect(g); g.connect(chD.gain); o.start(t); o.stop(t+0.28*decay+0.02);
  }

  // ── Polyphonic chord playback helper ─────────────────────────────────────
  // Plays all notes in a chord object { notes:[{note,oct},...], len } via device type
  playChord(t, chord, device, dur, { playPoly, playString, playAcid }) {
    if (!chord?.notes?.length) return;
    chord.notes.forEach(({ note, oct }) => {
      const freq = noteFreq(note, oct);
      if      (device.type === 'poly')   playPoly(t, freq, device, dur);
      else if (device.type === 'str')    playString(t, freq, device, dur);
      else if (device.type === 'acid')   playAcid(t, freq, device, dur);
      else if (device.type === 'rr')     this.playRR(freq, t, dur, device);
    });
  }

  // ── Poly synth (single voice — called per-note in chord) ──────────────────
  playSynthVoice(t, freq, { wave='sawtooth', atk=20, rel=600, flt=2000 }={}, dur=0.2) {
    if (!this.ready) return;
    const { ctx, chS } = this;
    const o = ctx.createOscillator(); o.type=wave; o.frequency.value=freq;
    const f = ctx.createBiquadFilter(); f.type='lowpass'; f.frequency.value=flt; f.Q.value=2;
    const g = ctx.createGain();
    const atkS=atk/1000, relS=rel/1000;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.55, t+atkS);
    g.gain.setValueAtTime(0.55, Math.max(t+atkS, t+dur));
    g.gain.exponentialRampToValueAtTime(0.001, Math.max(t+atkS,t+dur)+relS);
    o.connect(f); f.connect(g); g.connect(chS.gain);
    o.start(t); o.stop(Math.max(t+atkS,t+dur)+relS+0.05);
  }

  // ── String pad (6-osc detuned unison) ────────────────────────────────────
  playString(t, freq, { detune=8, spread=7, atk=800, rel=1200, flt=3500 }={}, dur=0.5) {
    if (!this.ready) return;
    const { ctx, chS } = this;
    const numOsc=6, atkS=atk/1000, relS=rel/1000;
    const sustain=Math.max(atkS,dur), peak=0.48/numOsc;
    for (let i=0;i<numOsc;i++) {
      const osc = ctx.createOscillator(); osc.type='sawtooth'; osc.frequency.value=freq;
      osc.detune.value=((i/(numOsc-1))*2-1)*detune*100;
      const pan = ctx.createStereoPanner(); pan.pan.value=((i/(numOsc-1))*2-1)*(spread/10);
      const lpf = ctx.createBiquadFilter(); lpf.type='lowpass'; lpf.frequency.value=flt; lpf.Q.value=0.7;
      const shelf = ctx.createBiquadFilter(); shelf.type='highshelf'; shelf.frequency.value=3000; shelf.gain.value=3;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(peak, t+atkS);
      g.gain.setValueAtTime(peak, t+sustain);
      g.gain.exponentialRampToValueAtTime(0.001, t+sustain+relS);
      osc.connect(lpf); lpf.connect(shelf); shelf.connect(g); g.connect(pan); pan.connect(chS.gain);
      osc.start(t); osc.stop(t+sustain+relS+0.1);
    }
  }

  // ── Acid bass ─────────────────────────────────────────────────────────────
  playAcid(t, freq, { wave='sawtooth', cut=400, res=80, env=3000, dec=250, dist:distAmt=60 }={}, dur=0.2) {
    if (!this.ready) return;
    const { ctx, chD } = this;
    const osc = ctx.createOscillator(); osc.type=wave; osc.frequency.setValueAtTime(freq, t);
    const flt = ctx.createBiquadFilter(); flt.type='lowpass'; flt.Q.value=(res/100)*25;
    flt.frequency.setValueAtTime(cut+env, t);
    flt.frequency.exponentialRampToValueAtTime(Math.max(40,cut), t+Math.max(0.01,dur));
    const shaper = ctx.createWaveShaper();
    const crv=new Float32Array(400); const k=distAmt;
    for(let i=0;i<400;i++){const x=i*2/400-1;crv[i]=(3+k)*x*20*Math.PI/180/(Math.PI+k*Math.abs(x));}
    shaper.curve=crv;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0,t); g.gain.linearRampToValueAtTime(0.65,t+0.01);
    g.gain.setValueAtTime(0.65,t+dur); g.gain.exponentialRampToValueAtTime(0.001,t+dur+dec/1000);
    osc.connect(flt); flt.connect(shaper); shaper.connect(g); g.connect(chD.gain);
    osc.start(t); osc.stop(t+dur+dec/1000+0.1);
  }

  // ── Road Rash FM — 3-osc unison + FM modulation ──────────────────────────
  playRR(freq, t, dur, { mr=1, mi=3.5, det=18, flt=1800, atk=5, rel=180 }={}) {
    if (!this.ready) return;
    const { ctx, rrIns } = this;
    const atkS=atk/1000, relS=rel/1000;
    const mod=ctx.createOscillator(); mod.type='sine'; mod.frequency.value=freq*mr;
    const mg=ctx.createGain(); mg.gain.value=freq*mi; mod.connect(mg);
    const lpf=ctx.createBiquadFilter(); lpf.type='lowpass'; lpf.frequency.value=flt; lpf.Q.value=3;
    const eg=ctx.createGain();
    eg.gain.setValueAtTime(0,t); eg.gain.linearRampToValueAtTime(0.55,t+atkS);
    eg.gain.setValueAtTime(0.55,t+Math.max(atkS,dur-relS));
    eg.gain.exponentialRampToValueAtTime(0.001,t+dur+relS);
    lpf.connect(eg); eg.connect(rrIns);
    [0,det,-det].forEach(d=>{
      const osc=ctx.createOscillator(); osc.type='sawtooth'; osc.frequency.value=freq; osc.detune.value=d;
      mg.connect(osc.frequency); osc.connect(lpf); osc.start(t); osc.stop(t+dur+relS+0.05);
    });
    mod.start(t); mod.stop(t+dur+relS+0.05);
  }

  // ── Sampler ───────────────────────────────────────────────────────────────
  playPad(buf, vol=100, pitch=0) {
    if (!this.ready||!buf) return;
    const { ctx, chP } = this;
    const src=ctx.createBufferSource(); src.buffer=buf; src.playbackRate.value=Math.pow(2,pitch/12);
    const g=ctx.createGain(); g.gain.value=vol/100;
    src.connect(g); g.connect(chP.gain); src.start();
  }
}
