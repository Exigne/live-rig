/**
 * AudioEngine.js — Live Rig Web Audio Engine
 * All audio routing: channel buses → master → shared FX (dist → delay → reverb → out)
 * New in this version:
 *   • playString  — 6-osc detuned string pad
 *   • _genIR      — algorithmic impulse response generator (Hall/Room/Plate/Cathedral/Spring)
 *   • setMasterReverb — swap the reverb IR live without clicks
 */

const NOTES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];

export function noteFreq(n, o) {
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

function makeSimpleRevBuf(ctx) {
  const len = ctx.sampleRate * 2.5, buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2);
  }
  return buf;
}

export class AudioEngine {
  constructor() { this.ctx = null; this.ready = false; }

  init() {
    if (this.ready) return;
    const ctx = this.ctx = new (window.AudioContext || window.webkitAudioContext)();

    const makeCh = (vol, pan) => {
      const g = ctx.createGain(), p = ctx.createStereoPanner();
      g.gain.value = vol / 100; p.pan.value = pan;
      g.connect(p); return { gain: g, panner: p };
    };

    this.chD = makeCh(80, 0);   // drums
    this.chS = makeCh(75, 0);   // synth + strings
    this.chR = makeCh(70, 0);   // road rash
    this.chP = makeCh(80, 0);   // sampler

    // Road Rash insert distortion (pre-channel FM grit)
    this.rrIns = ctx.createWaveShaper();
    this.rrIns.curve = distCurve(280); this.rrIns.oversample = '4x';
    this.rrIns.connect(this.chR.gain);

    this.master = ctx.createGain(); this.master.gain.value = 0.85;
    [this.chD, this.chS, this.chR, this.chP].forEach(ch => ch.panner.connect(this.master));

    // Post-master FX chain
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

  applyMixer(mx) {
    if (!this.ready) return;
    const hasSolo = ['drums','synth','rr','samp'].some(k => mx[k].solo);
    [['drums',this.chD],['synth',this.chS],['rr',this.chR],['samp',this.chP]].forEach(([k,ch]) => {
      const m = mx[k], eff = hasSolo ? (m.solo ? 1 : 0) : (m.mute ? 0 : 1);
      ch.gain.gain.value  = (m.vol / 100) * eff;
      ch.panner.pan.value = m.pan / 100;
    });
    this.master.gain.value = mx.master.vol / 100;
  }

  applyFX({ dist, dlyT, dlyFb, dlyW, rvW }) {
    if (!this.ready) return;
    this.dist.curve          = distCurve(dist / 100 * 400);
    this.dly.delayTime.value = dlyT / 100;
    this.dlyFb.gain.value    = dlyFb / 100;
    this.dlyW.gain.value     = dlyW / 100;
    this.revW.gain.value     = rvW / 50;
  }

  setRRDrive(v) { if (this.ready) this.rrIns.curve = distCurve(v * 4); }

  // ── Impulse Response Generator ─────────────────────────────────────────────
  // Generates algorithmically shaped impulse responses for 5 room types.
  // damp (0-100) applies a one-pole low-pass to simulate high-freq absorption.
  _genIR(room = 'hall', decaySecs = 2.5, damp = 30) {
    const ctx = this.ctx;
    const len = Math.max(1024, Math.floor(ctx.sampleRate * Math.max(0.1, decaySecs)));
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    const alpha = (damp / 100) * 0.92;   // LP coefficient (0 = no filter, ~0.92 = heavy HF cut)

    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        const t = i / len;
        let s = Math.random() * 2 - 1;

        switch (room) {
          case 'hall':
            // Smooth diffuse tail, gentle pre-build
            s *= Math.pow(1 - t, 1.1);
            if (i < ctx.sampleRate * 0.02) s *= (i / (ctx.sampleRate * 0.02));
            break;
          case 'room':
            // Short, dense, noticeable early reflections
            s *= Math.pow(1 - t, 3.8);
            if (i < ctx.sampleRate * 0.04) s *= Math.pow(i / (ctx.sampleRate * 0.04), 0.5);
            break;
          case 'plate':
            // Dense metallic shimmer with a slight flutter
            s = s * Math.pow(1 - t, 2.2) + Math.sin(i * 0.047) * 0.18 * Math.pow(1 - t, 2.8);
            break;
          case 'cath':
            // Very long, airy, slow build
            s *= Math.pow(1 - t, 0.62);
            s += (Math.random() * 2 - 1) * 0.25 * Math.pow(1 - t, 0.4) * (i < len * 0.1 ? i / (len * 0.1) : 1);
            break;
          case 'spring':
            // Boingy spring with wobble — classic old-school
            s = (s * 0.55 + Math.sin(i * 0.092) * 0.45) * Math.pow(1 - t, 3.6);
            break;
          default:
            s *= Math.pow(1 - t, 2.0);
        }

        d[i] = s * (ch === 0 ? 1 : -1);  // channel flip → stereo width
      }

      // One-pole LP for air absorption (damping)
      let prev = 0;
      for (let i = 0; i < len; i++) {
        d[i] = d[i] * (1 - alpha) + prev * alpha;
        prev = d[i];
      }
    }
    return buf;
  }

  // Update the master convolution reverb room type / size — call whenever the
  // Reverb Unit device params change. Cheap to call (buffer swap, not reconnect).
  setMasterReverb({ room = 'hall', decay = 2.5, damp = 30 } = {}) {
    if (!this.ready) return;
    this.rev.buffer = this._genIR(room, decay, damp);
  }

  // ── Drum Sounds ────────────────────────────────────────────────────────────
  playKick(t) {
    const { ctx, chD } = this;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(160, t); o.frequency.exponentialRampToValueAtTime(0.01, t + 0.5);
    g.gain.setValueAtTime(1.2, t);      g.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
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
    const o = ctx.createOscillator(), og = ctx.createGain(); o.frequency.value = 200;
    og.gain.setValueAtTime(0.8, t); og.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
    o.connect(og); og.connect(chD.gain); o.start(t); o.stop(t + 0.08);
  }

  playHH(t) {
    const { ctx, chD } = this;
    const len = ctx.sampleRate * 0.07, buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0); for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const ns = ctx.createBufferSource(); ns.buffer = buf;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 9000; f.Q.value = 0.5;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.5, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
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

  // ── Poly Synth ─────────────────────────────────────────────────────────────
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

  // ── String Pad — 6-osc unison with stereo spread ───────────────────────────
  // Routes through chS (synth channel bus).
  playString(t, freq, { detune = 8, spread = 7, atk = 800, rel = 1200, flt = 3500 } = {}, dur = 0.5) {
    if (!this.ready) return;
    const { ctx, chS } = this;
    const numOsc  = 6;
    const atkS    = atk / 1000;
    const relS    = rel / 1000;
    const sustain = Math.max(atkS, dur);
    const peak    = 0.48 / numOsc;  // Total = 0.48 across all oscillators

    for (let i = 0; i < numOsc; i++) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = freq;
      // Spread detune ±detune semitones across all oscillators
      osc.detune.value = ((i / (numOsc - 1)) * 2 - 1) * detune * 100;

      const pan = ctx.createStereoPanner();
      pan.pan.value = ((i / (numOsc - 1)) * 2 - 1) * (spread / 10);

      const lpf = ctx.createBiquadFilter();
      lpf.type = 'lowpass'; lpf.frequency.value = flt; lpf.Q.value = 0.6;

      // Slight high shelf boost for air
      const shelf = ctx.createBiquadFilter();
      shelf.type = 'highshelf'; shelf.frequency.value = 3000; shelf.gain.value = 3;

      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(peak, t + atkS);
      g.gain.setValueAtTime(peak, t + sustain);
      g.gain.exponentialRampToValueAtTime(0.001, t + sustain + relS);

      osc.connect(lpf); lpf.connect(shelf); shelf.connect(g); g.connect(pan); pan.connect(chS.gain);
      osc.start(t); osc.stop(t + sustain + relS + 0.1);
    }
  }

  // ── Road Rash FM — 3-osc unison + FM modulation ────────────────────────────
  playRR(freq, t, dur, { mr, mi, det, flt, atk, rel }) {
    if (!this.ready) return;
    const { ctx, rrIns } = this;
    const atkS = atk / 1000, relS = rel / 1000;
    const mod = ctx.createOscillator(); mod.type = 'sine'; mod.frequency.value = freq * mr;
    const mg  = ctx.createGain(); mg.gain.value = freq * mi; mod.connect(mg);
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
      mg.connect(osc.frequency); osc.connect(lpf); osc.start(t); osc.stop(t + dur + relS + 0.05);
    });
    mod.start(t); mod.stop(t + dur + relS + 0.05);
  }

  // ── Sampler ────────────────────────────────────────────────────────────────
  playPad(buf, vol = 100, pitch = 0) {
    if (!this.ready || !buf) return;
    const { ctx, chP } = this;
    const src = ctx.createBufferSource(); src.buffer = buf;
    src.playbackRate.value = Math.pow(2, pitch / 12);
    const g = ctx.createGain(); g.gain.value = vol / 100;
    src.connect(g); g.connect(chP.gain); src.start();
  }
}
