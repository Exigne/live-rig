/**
 * AudioEngine.js
 *
 * Signal flow per channel:
 *   sourceNode → channelGain → eqLo → eqMid → eqHi ──→ panner → master → dist → dly → out
 *                                                    ├──→ rvSend → rvBus → reverb → rvReturn → out
 *                                                    └──→ chSend → chBus → chorus → chReturn → out
 *
 * Channels are created/destroyed dynamically by the app.
 * 'drums' channel is always created on init.
 */

const NOTES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
export function noteFreq(n,o){ return 440*Math.pow(2,((o-4)*12+NOTES.indexOf(n)-9)/12); }

/** Normalise a seq step value → { notes:[{note,oct},...], len } or null */
export function stepToChord(step){
  if(!step) return null;
  if(step.notes) return step;
  if(step.note) return { notes:[{note:step.note,oct:step.oct}], len:step.len||1 };
  return null;
}

function distCurve(a){
  const n=256,c=new Float32Array(n);
  for(let i=0;i<n;i++){const x=(i*2)/n-1;c[i]=a>0?((Math.PI+a)*x)/(Math.PI+a*Math.abs(x)):x;}
  return c;
}

function makeRevBuf(ctx, room='hall', decay=2.5, damp=30){
  const len=Math.max(1024,Math.floor(ctx.sampleRate*Math.max(0.1,decay)));
  const buf=ctx.createBuffer(2,len,ctx.sampleRate);
  const alpha=(damp/100)*0.92;
  for(let ch=0;ch<2;ch++){
    const d=buf.getChannelData(ch);
    for(let i=0;i<len;i++){
      const t=i/len; let s=Math.random()*2-1;
      if(room==='hall')   s*=Math.pow(1-t,1.1)*(i<ctx.sampleRate*0.02?i/(ctx.sampleRate*0.02):1);
      else if(room==='room')  s*=Math.pow(1-t,3.8)*(i<ctx.sampleRate*0.04?Math.pow(i/(ctx.sampleRate*0.04),.5):1);
      else if(room==='plate') s=s*Math.pow(1-t,2.2)+Math.sin(i*.047)*.18*Math.pow(1-t,2.8);
      else if(room==='cath')  { s*=Math.pow(1-t,.62); s+=(Math.random()*2-1)*.25*Math.pow(1-t,.4)*(i<len*.1?i/(len*.1):1); }
      else if(room==='spring')s=(s*.55+Math.sin(i*.092)*.45)*Math.pow(1-t,3.6);
      else s*=Math.pow(1-t,2);
      d[i]=s*(ch===0?1:-1);
    }
    let prev=0;const dd=buf.getChannelData(ch);
    for(let i=0;i<len;i++){dd[i]=dd[i]*(1-alpha)+prev*alpha;prev=dd[i];}
  }
  return buf;
}

export class AudioEngine {
  constructor(){ this.ctx=null; this.ready=false; this.channels={}; }

  init(){
    if(this.ready) return;
    const ctx=this.ctx=new(window.AudioContext||window.webkitAudioContext)();

    // Master dry chain
    this.master=ctx.createGain(); this.master.gain.value=0.85;
    this.dist=ctx.createWaveShaper(); this.dist.curve=distCurve(0); this.dist.oversample='4x';
    this.dly=ctx.createDelay(2.0); this.dly.delayTime.value=0.3;
    this.dlyFb=ctx.createGain(); this.dlyFb.gain.value=0.25;
    this.dlyW=ctx.createGain(); this.dlyW.gain.value=0;
    this.dly.connect(this.dlyFb); this.dlyFb.connect(this.dly); this.dly.connect(this.dlyW);
    this.master.connect(this.dist);
    this.dist.connect(this.dly); this.dist.connect(ctx.destination);
    this.dlyW.connect(ctx.destination);

    // Reverb send bus
    this.rvBus=ctx.createGain();
    this.reverb=ctx.createConvolver(); this.reverb.buffer=makeRevBuf(ctx);
    this.rvReturn=ctx.createGain(); this.rvReturn.gain.value=0;
    this.rvBus.connect(this.reverb); this.reverb.connect(this.rvReturn); this.rvReturn.connect(ctx.destination);

    // Chorus send bus — two LFO-modulated stereo delay lines
    this.chBus=ctx.createGain();
    this.chorusReturn=ctx.createGain(); this.chorusReturn.gain.value=0;
    this._chorusLFOs=[]; this._chorusLFOGains=[];
    [[-0.65,0.022,0.27],[0.65,0.026,0.34]].forEach(([pan,delMs,rate])=>{
      const delay=ctx.createDelay(0.05); delay.delayTime.value=delMs;
      const lfo=ctx.createOscillator(); lfo.type='sine'; lfo.frequency.value=rate;
      const lfoG=ctx.createGain(); lfoG.gain.value=0.007;
      const panner=ctx.createStereoPanner(); panner.pan.value=pan;
      lfo.connect(lfoG); lfoG.connect(delay.delayTime);
      this.chBus.connect(delay); delay.connect(panner); panner.connect(this.chorusReturn);
      lfo.start();
      this._chorusLFOs.push(lfo); this._chorusLFOGains.push(lfoG);
    });
    this.chorusReturn.connect(ctx.destination);

    // Drums channel is always present
    this._mkChannel('drums', 80, 0);
    this.ready=true;
  }

  resume(){ if(this.ctx?.state==='suspended') this.ctx.resume(); }

  /** Create a named channel bus. Safe to call multiple times (idempotent). */
  _mkChannel(id, vol=80, pan=0){
    if(this.channels[id]) return this.channels[id];
    const ctx=this.ctx;
    const gain=ctx.createGain(); gain.gain.value=vol/100;
    const eqLo=ctx.createBiquadFilter(); eqLo.type='lowshelf'; eqLo.frequency.value=200; eqLo.gain.value=0;
    const eqMid=ctx.createBiquadFilter(); eqMid.type='peaking'; eqMid.frequency.value=1000; eqMid.Q.value=1.2; eqMid.gain.value=0;
    const eqHi=ctx.createBiquadFilter(); eqHi.type='highshelf'; eqHi.frequency.value=8000; eqHi.gain.value=0;
    const panner=ctx.createStereoPanner(); panner.pan.value=pan;
    const rvSend=ctx.createGain(); rvSend.gain.value=0;
    const chSend=ctx.createGain(); chSend.gain.value=0;
    gain.connect(eqLo); eqLo.connect(eqMid); eqMid.connect(eqHi);
    eqHi.connect(panner); panner.connect(this.master);
    eqHi.connect(rvSend); rvSend.connect(this.rvBus);
    eqHi.connect(chSend); chSend.connect(this.chBus);
    const ch={gain,eqLo,eqMid,eqHi,panner,rvSend,chSend};
    this.channels[id]=ch;
    return ch;
  }

  createChannel(id, vol=80, pan=0){
    if(!this.ready) return null;
    return this._mkChannel(id, vol, pan);
  }

  destroyChannel(id){
    const ch=this.channels[id];
    if(!ch) return;
    try{ ch.gain.disconnect(); ch.panner.disconnect(); ch.rvSend.disconnect(); ch.chSend.disconnect(); }catch{}
    delete this.channels[id];
  }

  /** Returns the gain input node for a channel (what synths connect to). */
  destFor(id){ return this.channels[id]?.gain || null; }

  // Apply mixer state — called by app useEffect whenever mx changes
  applyMixer(mx){
    if(!this.ready) return;
    const keys=Object.keys(mx).filter(k=>k!=='master');
    const hasSolo=keys.some(k=>mx[k]?.solo);
    keys.forEach(k=>{
      const ch=this.channels[k]; if(!ch) return;
      const m=mx[k]; if(!m) return;
      const eff=hasSolo?(m.solo?1:0):(m.mute?0:1);
      ch.gain.gain.value=(m.vol/100)*eff;
      ch.panner.pan.value=(m.pan||0)/100;
      const eq=m.eq||{};
      if(eq.lo!==undefined)  { ch.eqLo.gain.value=Math.max(-18,Math.min(18,eq.lo)); }
      if(eq.mid!==undefined) { ch.eqMid.gain.value=Math.max(-18,Math.min(18,eq.mid)); ch.eqMid.frequency.value=Math.max(200,Math.min(8000,eq.midFreq||1000)); }
      if(eq.hi!==undefined)  { ch.eqHi.gain.value=Math.max(-18,Math.min(18,eq.hi)); }
      const sends=m.sends||{};
      if(sends.rv!==undefined) ch.rvSend.gain.value=sends.rv/100;
      if(sends.ch!==undefined) ch.chSend.gain.value=sends.ch/100;
    });
    if(mx.master) this.master.gain.value=(mx.master.vol||85)/100;
  }

  applyFX({dist=0,dlyT=30,dlyFb=25,dlyW=0,rvW=0,chW=0,chRate=0.3,chDepth=7}={}){
    if(!this.ready) return;
    this.dist.curve=distCurve(dist/100*400);
    this.dly.delayTime.value=dlyT/100;
    this.dlyFb.gain.value=dlyFb/100;
    this.dlyW.gain.value=dlyW/100;
    this.rvReturn.gain.value=rvW/50;
    this.chorusReturn.gain.value=chW/50;
    this._chorusLFOs?.forEach((l,i)=>{ l.frequency.value=Math.max(0.05,chRate)+i*0.08; });
    this._chorusLFOGains?.forEach(g=>{ g.gain.value=chDepth*0.00008; }); // depth 0-100 → 0-0.008s
  }

  setMasterReverb({room='hall',decay=2.5,damp=30}={}){
    if(!this.ready) return;
    this.reverb.buffer=makeRevBuf(this.ctx,room,decay,damp);
  }

  // ── Drums ─────────────────────────────────────────────────────────────────
  playKick(t,{vel=100,tune=0,decay=1}={}){
    const{ctx}=this; const dest=this.channels['drums']?.gain; if(!dest) return;
    const g=ctx.createGain(); g.gain.setValueAtTime((vel/100)*1.2,t); g.gain.exponentialRampToValueAtTime(0.001,t+0.5*decay);
    const o=ctx.createOscillator(); const bf=160*Math.pow(2,tune/12);
    o.frequency.setValueAtTime(bf,t); o.frequency.exponentialRampToValueAtTime(0.01,t+0.5*decay);
    o.connect(g); g.connect(dest); o.start(t); o.stop(t+0.5*decay+0.02);
  }
  playSnare(t,{vel=100,tune=0,decay=1}={}){
    const{ctx}=this; const dest=this.channels['drums']?.gain; if(!dest) return;
    const dur=0.22*decay; const len=Math.floor(ctx.sampleRate*dur);
    const buf=ctx.createBuffer(1,len,ctx.sampleRate); const d=buf.getChannelData(0);
    for(let i=0;i<len;i++) d[i]=Math.random()*2-1;
    const ns=ctx.createBufferSource(); ns.buffer=buf;
    const f=ctx.createBiquadFilter(); f.type='highpass'; f.frequency.value=900;
    const g=ctx.createGain(); g.gain.setValueAtTime(vel/100,t); g.gain.exponentialRampToValueAtTime(0.001,t+dur);
    ns.connect(f); f.connect(g); g.connect(dest); ns.start(t); ns.stop(t+dur);
    const o=ctx.createOscillator(),og=ctx.createGain(); o.frequency.value=200*Math.pow(2,tune/12);
    og.gain.setValueAtTime(vel/100*.8,t); og.gain.exponentialRampToValueAtTime(0.001,t+0.08*decay);
    o.connect(og); og.connect(dest); o.start(t); o.stop(t+0.08*decay+0.02);
  }
  playHH(t,{vel=80,tune=0,decay=1,open=false}={}){
    const{ctx}=this; const dest=this.channels['drums']?.gain; if(!dest) return;
    const dur=(open?.4:.07)*decay; const len=Math.floor(ctx.sampleRate*dur);
    const buf=ctx.createBuffer(1,len,ctx.sampleRate); const d=buf.getChannelData(0);
    for(let i=0;i<len;i++) d[i]=Math.random()*2-1;
    const ns=ctx.createBufferSource(); ns.buffer=buf;
    const f=ctx.createBiquadFilter(); f.type='bandpass'; f.frequency.value=9000*Math.pow(2,tune/12); f.Q.value=0.5;
    const g=ctx.createGain(); g.gain.setValueAtTime(vel/100*.55,t); g.gain.exponentialRampToValueAtTime(0.001,t+dur);
    ns.connect(f); f.connect(g); g.connect(dest); ns.start(t); ns.stop(t+dur);
  }
  playBass(t,freq=82,{vel=100,tune=0,decay=1}={}){
    const{ctx}=this; const dest=this.channels['drums']?.gain; if(!dest) return;
    const o=ctx.createOscillator(); o.type='sawtooth'; o.frequency.value=freq*Math.pow(2,tune/12);
    const lp=ctx.createBiquadFilter(); lp.type='lowpass'; lp.frequency.value=450; lp.Q.value=2;
    const g=ctx.createGain(); g.gain.setValueAtTime(vel/100*.9,t); g.gain.exponentialRampToValueAtTime(0.001,t+0.28*decay);
    o.connect(lp); lp.connect(g); g.connect(dest); o.start(t); o.stop(t+0.28*decay+0.02);
  }

  // ── Melodic synths — caller passes destGain = engine.channels[deviceId].gain ──
  playSynthVoice(t,freq,{wave='sawtooth',atk=20,rel=600,flt=2000}={},dur=0.2,destGain){
    if(!this.ready||!destGain) return;
    const{ctx}=this; const atkS=atk/1000,relS=rel/1000;
    const o=ctx.createOscillator(); o.type=wave; o.frequency.value=freq;
    const f=ctx.createBiquadFilter(); f.type='lowpass'; f.frequency.value=flt; f.Q.value=2;
    const g=ctx.createGain();
    g.gain.setValueAtTime(0,t); g.gain.linearRampToValueAtTime(0.55,t+atkS);
    g.gain.setValueAtTime(0.55,Math.max(t+atkS,t+dur)); g.gain.exponentialRampToValueAtTime(0.001,Math.max(t+atkS,t+dur)+relS);
    o.connect(f); f.connect(g); g.connect(destGain); o.start(t); o.stop(Math.max(t+atkS,t+dur)+relS+0.05);
  }
  playString(t,freq,{detune=8,spread=7,atk=800,rel=1200,flt=3500}={},dur=0.5,destGain){
    if(!this.ready||!destGain) return;
    const{ctx}=this; const numOsc=6,atkS=atk/1000,relS=rel/1000;
    const sustain=Math.max(atkS,dur),peak=0.48/numOsc;
    for(let i=0;i<numOsc;i++){
      const osc=ctx.createOscillator(); osc.type='sawtooth'; osc.frequency.value=freq;
      osc.detune.value=((i/(numOsc-1))*2-1)*detune*100;
      const pan=ctx.createStereoPanner(); pan.pan.value=((i/(numOsc-1))*2-1)*(spread/10);
      const lpf=ctx.createBiquadFilter(); lpf.type='lowpass'; lpf.frequency.value=flt; lpf.Q.value=0.7;
      const shelf=ctx.createBiquadFilter(); shelf.type='highshelf'; shelf.frequency.value=3000; shelf.gain.value=3;
      const g=ctx.createGain();
      g.gain.setValueAtTime(0,t); g.gain.linearRampToValueAtTime(peak,t+atkS);
      g.gain.setValueAtTime(peak,t+sustain); g.gain.exponentialRampToValueAtTime(0.001,t+sustain+relS);
      osc.connect(lpf); lpf.connect(shelf); shelf.connect(g); g.connect(pan); pan.connect(destGain);
      osc.start(t); osc.stop(t+sustain+relS+0.1);
    }
  }
  playRR(freq,t,dur,{mr=1,mi=3.5,det=18,flt=1800,atk=5,rel=180,drv=70}={},destGain){
    if(!this.ready||!destGain) return;
    const{ctx}=this; const atkS=atk/1000,relS=rel/1000;
    const shaper=ctx.createWaveShaper(); shaper.curve=distCurve(drv*4); shaper.oversample='4x';
    const mod=ctx.createOscillator(); mod.type='sine'; mod.frequency.value=freq*mr;
    const mg=ctx.createGain(); mg.gain.value=freq*mi; mod.connect(mg);
    const lpf=ctx.createBiquadFilter(); lpf.type='lowpass'; lpf.frequency.value=flt; lpf.Q.value=3;
    const eg=ctx.createGain();
    eg.gain.setValueAtTime(0,t); eg.gain.linearRampToValueAtTime(0.55,t+atkS);
    eg.gain.setValueAtTime(0.55,t+Math.max(atkS,dur-relS)); eg.gain.exponentialRampToValueAtTime(0.001,t+dur+relS);
    lpf.connect(eg); eg.connect(shaper); shaper.connect(destGain);
    [0,det,-det].forEach(d=>{
      const osc=ctx.createOscillator(); osc.type='sawtooth'; osc.frequency.value=freq; osc.detune.value=d;
      mg.connect(osc.frequency); osc.connect(lpf); osc.start(t); osc.stop(t+dur+relS+0.05);
    });
    mod.start(t); mod.stop(t+dur+relS+0.05);
  }
  playAcid(t,freq,{wave='sawtooth',cut=400,res=80,env=3000,dec=250,dist:dstAmt=60}={},dur=0.2,destGain){
    if(!this.ready||!destGain) return;
    const{ctx}=this;
    const osc=ctx.createOscillator(); osc.type=wave; osc.frequency.setValueAtTime(freq,t);
    const flt=ctx.createBiquadFilter(); flt.type='lowpass'; flt.Q.value=(res/100)*25;
    flt.frequency.setValueAtTime(cut+env,t); flt.frequency.exponentialRampToValueAtTime(Math.max(40,cut),t+Math.max(0.01,dur));
    const shaper=ctx.createWaveShaper(); const crv=new Float32Array(400); const k=dstAmt;
    for(let i=0;i<400;i++){const x=i*2/400-1;crv[i]=(3+k)*x*20*Math.PI/180/(Math.PI+k*Math.abs(x));}
    shaper.curve=crv;
    const g=ctx.createGain();
    g.gain.setValueAtTime(0,t); g.gain.linearRampToValueAtTime(0.65,t+0.01);
    g.gain.setValueAtTime(0.65,t+dur); g.gain.exponentialRampToValueAtTime(0.001,t+dur+dec/1000);
    osc.connect(flt); flt.connect(shaper); shaper.connect(g); g.connect(destGain);
    osc.start(t); osc.stop(t+dur+dec/1000+0.1);
  }
  playPad(buf,vol=100,pitch=0,destGain){
    if(!this.ready||!buf) return;
    const{ctx}=this; const dest=destGain||this.master;
    const src=ctx.createBufferSource(); src.buffer=buf; src.playbackRate.value=Math.pow(2,pitch/12);
    const g=ctx.createGain(); g.gain.value=vol/100;
    src.connect(g); g.connect(dest); src.start();
  }
}
