/**
 * LIVE RIG — Full Performance Suite
 * Modules: Step Sequencer · Polyphonic Synth · Road Rash FM Synth · Sampler · Mixer · FX · Presets
 * Audio engine: Web Audio API only — zero npm dependencies beyond React
 */

import { useState, useEffect, useRef, useCallback } from "react";

const NOTES    = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const TRACKS   = ['KICK','SNARE','HIHAT','BASS'];
const TC       = ['#BA7517','#0F6E56','#185FA5','#993556'];
const PAD_KEYS = ['Q','W','E','R','A','S','D','F'];
const WAVEFORMS= ['sawtooth','square','sine','triangle'];
const ROCK_NOTES=['E','G','A','B','D','C','F#','A#'];
const ROCK_OCTS = [2,  2,  2,  2,  2,  3,  2,   2];

const DEFAULT_RR_PAT = () =>
  ['E','E',null,'E','G',null,'A','G','E',null,'D',null,'E','B',null,'E']
    .map((n,i) => n
      ? {note:n, oct:[2,2,0,2,2,0,2,2,2,0,2,0,2,1,0,2][i]}
      : {note:null,oct:null});

const DEFAULT_PAT = () =>
  TRACKS.map((_,ti) => Array(16).fill(false).map((_,si)=>{
    if(ti===0) return si%4===0;
    if(ti===1) return si===4||si===12;
    if(ti===2) return si%2===0;
    return false;
  }));

const DEFAULT_MIX = () => ({
  drums: {vol:80,pan:0,mute:false,solo:false},
  synth: {vol:75,pan:0,mute:false,solo:false},
  rr:    {vol:70,pan:0,mute:false,solo:false},
  samp:  {vol:80,pan:0,mute:false,solo:false},
  master:{vol:85,pan:0},
});

function noteFreq(n,o){ return 440*Math.pow(2,((o-4)*12+NOTES.indexOf(n)-9)/12); }

function makeRevBuf(ctx){
  const len=ctx.sampleRate*2.5, buf=ctx.createBuffer(2,len,ctx.sampleRate);
  for(let c=0;c<2;c++){const d=buf.getChannelData(c);for(let i=0;i<len;i++)d[i]=(Math.random()*2-1)*Math.pow(1-i/len,2);}
  return buf;
}
function distCurve(a){
  const n=256,c=new Float32Array(n);
  for(let i=0;i<n;i++){const x=(i*2)/n-1;c[i]=a>0?((Math.PI+a)*x)/(Math.PI+a*Math.abs(x)):x;}
  return c;
}

// ── Audio Engine ─────────────────────────────────────────────────────────────
class LiveRigEngine {
  constructor(){ this.ctx=null; this.ready=false; }

  init(){
    if(this.ready) return;
    this.ctx = new(window.AudioContext||window.webkitAudioContext)();
    const ctx = this.ctx;

    const makeCh=(vol,pan)=>{
      const g=ctx.createGain(); g.gain.value=vol/100;
      const p=ctx.createStereoPanner(); p.pan.value=pan/100;
      g.connect(p); return {gain:g,panner:p};
    };
    this.chDrums=makeCh(80,0); this.chSynth=makeCh(75,0);
    this.chRR=makeCh(70,0);    this.chSamp=makeCh(80,0);

    // Road Rash insert distortion (gives FM its grit)
    this.rrInsert=ctx.createWaveShaper();
    this.rrInsert.curve=distCurve(280); this.rrInsert.oversample='4x';
    this.rrInsert.connect(this.chRR.gain);

    this.masterGain=ctx.createGain(); this.masterGain.gain.value=0.85;
    [this.chDrums,this.chSynth,this.chRR,this.chSamp].forEach(ch=>ch.panner.connect(this.masterGain));

    this.distNode=ctx.createWaveShaper(); this.distNode.curve=distCurve(0); this.distNode.oversample='4x';
    this.dlyNode=ctx.createDelay(2.0); this.dlyNode.delayTime.value=0.3;
    this.dlyFbN=ctx.createGain(); this.dlyFbN.gain.value=0.25;
    this.dlyWetN=ctx.createGain(); this.dlyWetN.gain.value=0;
    this.dlyNode.connect(this.dlyFbN); this.dlyFbN.connect(this.dlyNode); this.dlyNode.connect(this.dlyWetN);
    this.revNode=ctx.createConvolver(); this.revNode.buffer=makeRevBuf(ctx);
    this.revWetN=ctx.createGain(); this.revWetN.gain.value=0; this.revNode.connect(this.revWetN);

    this.masterGain.connect(this.distNode);
    this.distNode.connect(this.dlyNode); this.distNode.connect(this.revNode); this.distNode.connect(ctx.destination);
    this.dlyWetN.connect(ctx.destination); this.revWetN.connect(ctx.destination);
    this.ready=true;
  }

  resume(){ if(this.ctx?.state==='suspended') this.ctx.resume(); }

  applyMixer(mx){
    if(!this.ready) return;
    const hasSolo=['drums','synth','rr','samp'].some(k=>mx[k].solo);
    [['drums',this.chDrums],['synth',this.chSynth],['rr',this.chRR],['samp',this.chSamp]].forEach(([k,ch])=>{
      const m=mx[k]; const eff=hasSolo?(m.solo?1:0):(m.mute?0:1);
      ch.gain.gain.value=(m.vol/100)*eff; ch.panner.pan.value=m.pan/100;
    });
    this.masterGain.gain.value=mx.master.vol/100;
  }

  applyFX({dist,dlyT,dlyFb,dlyW,rvW}){
    if(!this.ready) return;
    this.distNode.curve=distCurve(dist/100*400);
    this.dlyNode.delayTime.value=dlyT/100;
    this.dlyFbN.gain.value=dlyFb/100;
    this.dlyWetN.gain.value=dlyW/100;
    this.revWetN.gain.value=rvW/50;
  }

  setRRDrive(v){ if(this.ready) this.rrInsert.curve=distCurve(v*4); }

  // Drums
  playKick(t){
    const{ctx,chDrums}=this; const o=ctx.createOscillator(),g=ctx.createGain();
    o.frequency.setValueAtTime(160,t); o.frequency.exponentialRampToValueAtTime(0.01,t+0.5);
    g.gain.setValueAtTime(1.2,t); g.gain.exponentialRampToValueAtTime(0.001,t+0.5);
    o.connect(g);g.connect(chDrums.gain);o.start(t);o.stop(t+0.5);
  }
  playSnare(t){
    const{ctx,chDrums}=this;
    const len=ctx.sampleRate*0.22,buf=ctx.createBuffer(1,len,ctx.sampleRate);
    const d=buf.getChannelData(0);for(let i=0;i<len;i++)d[i]=Math.random()*2-1;
    const ns=ctx.createBufferSource();ns.buffer=buf;
    const f=ctx.createBiquadFilter();f.type='highpass';f.frequency.value=900;
    const g=ctx.createGain();g.gain.setValueAtTime(1,t);g.gain.exponentialRampToValueAtTime(0.001,t+0.22);
    ns.connect(f);f.connect(g);g.connect(chDrums.gain);ns.start(t);ns.stop(t+0.22);
    const o=ctx.createOscillator(),og=ctx.createGain();o.frequency.value=200;
    og.gain.setValueAtTime(0.8,t);og.gain.exponentialRampToValueAtTime(0.001,t+0.08);
    o.connect(og);og.connect(chDrums.gain);o.start(t);o.stop(t+0.08);
  }
  playHH(t){
    const{ctx,chDrums}=this;
    const len=ctx.sampleRate*0.07,buf=ctx.createBuffer(1,len,ctx.sampleRate);
    const d=buf.getChannelData(0);for(let i=0;i<len;i++)d[i]=Math.random()*2-1;
    const ns=ctx.createBufferSource();ns.buffer=buf;
    const f=ctx.createBiquadFilter();f.type='bandpass';f.frequency.value=9000;f.Q.value=0.5;
    const g=ctx.createGain();g.gain.setValueAtTime(0.5,t);g.gain.exponentialRampToValueAtTime(0.001,t+0.07);
    ns.connect(f);f.connect(g);g.connect(chDrums.gain);ns.start(t);ns.stop(t+0.07);
  }
  playBass(t,freq=82){
    const{ctx,chDrums}=this;
    const o=ctx.createOscillator(),f=ctx.createBiquadFilter(),g=ctx.createGain();
    o.type='sawtooth';o.frequency.value=freq;f.type='lowpass';f.frequency.value=450;f.Q.value=2;
    g.gain.setValueAtTime(0.9,t);g.gain.exponentialRampToValueAtTime(0.001,t+0.28);
    o.connect(f);f.connect(g);g.connect(chDrums.gain);o.start(t);o.stop(t+0.28);
  }

  // Polyphonic synth
  playSynth({freq,wave,atk,rel,filter}){
    if(!this.ready) return;
    const{ctx,chSynth}=this; const now=ctx.currentTime;
    const o=ctx.createOscillator(),flt=ctx.createBiquadFilter(),g=ctx.createGain();
    o.type=wave;o.frequency.value=freq;flt.type='lowpass';flt.frequency.value=filter;flt.Q.value=2;
    g.gain.setValueAtTime(0,now);g.gain.linearRampToValueAtTime(0.8,now+atk);
    g.gain.exponentialRampToValueAtTime(0.001,now+atk+rel);
    o.connect(flt);flt.connect(g);g.connect(chSynth.gain);o.start(now);o.stop(now+atk+rel+0.05);
  }

  // Road Rash FM + 3-osc unison synth
  playRRNote(freq,t,dur,{modRatio,modIdx,detune,filt,atk,rel}){
    if(!this.ready) return;
    const{ctx,rrInsert}=this;
    const atkS=atk/1000,relS=rel/1000;
    const mod=ctx.createOscillator();mod.type='sine';mod.frequency.value=freq*modRatio;
    const modGain=ctx.createGain();modGain.gain.value=freq*modIdx;
    mod.connect(modGain);
    const lpf=ctx.createBiquadFilter();lpf.type='lowpass';lpf.frequency.value=filt;lpf.Q.value=3;
    const envGain=ctx.createGain();
    envGain.gain.setValueAtTime(0,t);
    envGain.gain.linearRampToValueAtTime(0.55,t+atkS);
    envGain.gain.setValueAtTime(0.55,t+Math.max(atkS,dur-relS));
    envGain.gain.exponentialRampToValueAtTime(0.001,t+dur+relS);
    lpf.connect(envGain);envGain.connect(rrInsert);
    [0,detune,-detune].forEach(d=>{
      const osc=ctx.createOscillator();osc.type='sawtooth';osc.frequency.value=freq;osc.detune.value=d;
      modGain.connect(osc.frequency);osc.connect(lpf);osc.start(t);osc.stop(t+dur+relS+0.05);
    });
    mod.start(t);mod.stop(t+dur+relS+0.05);
  }

  // Sampler
  triggerPad(buf,vol,pitch){
    if(!this.ready||!buf) return;
    const{ctx,chSamp}=this;
    const src=ctx.createBufferSource();src.buffer=buf;src.playbackRate.value=Math.pow(2,pitch/12);
    const g=ctx.createGain();g.gain.value=vol/100;
    src.connect(g);g.connect(chSamp.gain);src.start();
  }
}

const engine = new LiveRigEngine();

export default function LiveRig(){
  const[authed,setAuthed]=useState(false);
  const[loginU,setLoginU]=useState(''); const[loginP,setLoginP]=useState(''); const[loginErr,setLoginErr]=useState('');
  const[tab,setTab]=useState('seq');
  const[playing,setPlaying]=useState(false);
  const[bpm,setBpm]=useState(120);
  const[step,setStep]=useState(-1);
  const[pat,setPat]=useState(DEFAULT_PAT());
  const[sw,setSw]=useState('sawtooth');const[sn,setSn]=useState('A');const[so,setSo]=useState(4);
  const[satk,setSatk]=useState(20);const[srel,setSrel]=useState(600);const[sflt,setSflt]=useState(2000);
  const[rrPat,setRrPat]=useState(DEFAULT_RR_PAT());
  const[rrOn,setRrOn]=useState(true);
  const[rrMR,setRrMR]=useState(1.0); const[rrMI,setRrMI]=useState(3.5);
  const[rrDet,setRrDet]=useState(18); const[rrFlt,setRrFlt]=useState(1800);
  const[rrAtk,setRrAtk]=useState(5);  const[rrRel,setRrRel]=useState(180);
  const[rrDrv,setRrDrv]=useState(70);
  const[pads,setPads]=useState(Array(8).fill(null).map((_,i)=>({name:`PAD ${i+1}`,buf:null,vol:100,pitch:0})));
  const[mx,setMx]=useState(DEFAULT_MIX());
  const[fxDist,setFxDist]=useState(0);const[fxDlyT,setFxDlyT]=useState(30);
  const[fxDlyFb,setFxDlyFb]=useState(25);const[fxDlyW,setFxDlyW]=useState(0);const[fxRvW,setFxRvW]=useState(0);
  const[presets,setPresets]=useState([]);const[presetName,setPresetName]=useState('');

  const schedRef=useRef(null); const stepRef=useRef(0); const nextTRef=useRef(0);
  const bpmRef=useRef(bpm); const patRef=useRef(pat); const rrPatRef=useRef(rrPat);
  const rrOnRef=useRef(rrOn); const rrP=useRef({modRatio:rrMR,modIdx:rrMI,detune:rrDet,filt:rrFlt,atk:rrAtk,rel:rrRel});
  bpmRef.current=bpm; patRef.current=pat; rrPatRef.current=rrPat; rrOnRef.current=rrOn;
  rrP.current={modRatio:rrMR,modIdx:rrMI,detune:rrDet,filt:rrFlt,atk:rrAtk,rel:rrRel};

  const ea=()=>{engine.init();engine.resume();};

  const schedStep=useCallback((s,t)=>{
    const p=patRef.current; const spb=(60/bpmRef.current)/4;
    if(p[0][s])engine.playKick(t); if(p[1][s])engine.playSnare(t);
    if(p[2][s])engine.playHH(t);   if(p[3][s])engine.playBass(t,82+(s%8)*3);
    if(rrOnRef.current){const rs=rrPatRef.current[s];if(rs?.note)engine.playRRNote(noteFreq(rs.note,rs.oct),t,spb*0.85,rrP.current);}
  },[]);

  const startSeq=useCallback(()=>{
    ea(); stepRef.current=0; nextTRef.current=engine.ctx.currentTime+0.05;
    const tick=()=>{
      while(nextTRef.current<engine.ctx.currentTime+0.12){
        const s=stepRef.current;
        schedStep(s,nextTRef.current);
        const delay=Math.max(0,(nextTRef.current-engine.ctx.currentTime)*1000);
        setTimeout(()=>setStep(s),delay);
        nextTRef.current+=(60/bpmRef.current)/4;
        stepRef.current=(stepRef.current+1)%16;
      }
      schedRef.current=setTimeout(tick,20);
    };tick();
  },[schedStep]);

  useEffect(()=>{if(playing)startSeq();else{clearTimeout(schedRef.current);setStep(-1);}return()=>clearTimeout(schedRef.current);},[playing,startSeq]);
  useEffect(()=>{engine.applyMixer(mx);},[mx]);
  useEffect(()=>{engine.applyFX({dist:fxDist,dlyT:fxDlyT,dlyFb:fxDlyFb,dlyW:fxDlyW,rvW:fxRvW});},[fxDist,fxDlyT,fxDlyFb,fxDlyW,fxRvW]);
  useEffect(()=>{engine.setRRDrive(rrDrv);},[rrDrv]);
  useEffect(()=>{
    const onKey=e=>{if(e.target.tagName==='INPUT')return;const i=PAD_KEYS.indexOf(e.key.toUpperCase());if(i>=0){ea();engine.triggerPad(pads[i].buf,pads[i].vol,pads[i].pitch);}};
    window.addEventListener('keydown',onKey);return()=>window.removeEventListener('keydown',onKey);
  },[pads]);

  const toggleStep=(ti,si)=>setPat(p=>p.map((row,r)=>r===ti?row.map((v,c)=>c===si?!v:v):row));
  const triggerSynth=()=>{ea();engine.playSynth({freq:noteFreq(sn,so),wave:sw,atk:satk/1000,rel:srel/1000,filter:sflt});};
  const cycleRRStep=si=>setRrPat(p=>{const cur=p[si];let next;if(!cur?.note){next={note:'E',oct:2};}else{const idx=ROCK_NOTES.indexOf(cur.note);next=idx===ROCK_NOTES.length-1?{note:null,oct:null}:{note:ROCK_NOTES[idx+1],oct:ROCK_OCTS[idx+1]};}return p.map((s,i)=>i===si?next:s);});
  const loadPad=async(i,file)=>{ea();const ab=await file.arrayBuffer();const buf=await engine.ctx.decodeAudioData(ab);setPads(p=>p.map((pad,pi)=>pi===i?{...pad,name:file.name.replace(/\.[^.]+$/,'').slice(0,14),buf}:pad));};
  const updateMx=(key,field,val)=>setMx(m=>({...m,[key]:{...m[key],[field]:val}}));
  const savePreset=()=>{if(!presetName.trim())return;setPresets(ps=>[...ps,{name:presetName,bpm,pat:pat.map(r=>[...r]),sw,sn,so,satk,srel,sflt,rrPat:rrPat.map(s=>({...s})),rrOn,rrMR,rrMI,rrDet,rrFlt,rrAtk,rrRel,rrDrv,mx:JSON.parse(JSON.stringify(mx)),fxDist,fxDlyT,fxDlyFb,fxDlyW,fxRvW}]);setPresetName('');};
  const loadPreset=p=>{setBpm(p.bpm);setPat(p.pat.map(r=>[...r]));setSw(p.sw);setSn(p.sn);setSo(p.so);setSatk(p.satk);setSrel(p.srel);setSflt(p.sflt);setRrPat(p.rrPat.map(s=>({...s})));setRrOn(p.rrOn);setRrMR(p.rrMR);setRrMI(p.rrMI);setRrDet(p.rrDet);setRrFlt(p.rrFlt);setRrAtk(p.rrAtk);setRrRel(p.rrRel);setRrDrv(p.rrDrv);setMx(JSON.parse(JSON.stringify(p.mx)));setFxDist(p.fxDist);setFxDlyT(p.fxDlyT);setFxDlyFb(p.fxDlyFb);setFxDlyW(p.fxDlyW);setFxRvW(p.fxRvW);};

  const mono="'JetBrains Mono','Fira Code',monospace";
  const C={bg:'#080808',surf:'#0f0f0f',border:'#1d1d1d',borderHi:'#2a2a2a',amber:'#BA7517',teal:'#0F6E56',blue:'#185FA5',pink:'#993556',purple:'#534AB7',red:'#A32D2D',text:'#d4c9b8',muted:'#555',dim:'#2a2a2a'};
  const panel={background:C.surf,border:`1px solid ${C.border}`,borderRadius:3,padding:'18px 22px',marginBottom:12};
  const lbl={fontSize:10,color:C.muted,letterSpacing:2,textTransform:'uppercase'};
  const B=(col=C.amber,fill=true)=>({fontFamily:mono,fontSize:11,letterSpacing:1.5,textTransform:'uppercase',padding:'7px 14px',cursor:'pointer',border:`1px solid ${col}`,background:fill?col:'transparent',color:fill?(col===C.amber||col===C.teal||col===C.blue?'#000':'#fff'):col,borderRadius:3,fontWeight:fill?700:400});

  if(!authed) return(
    <div style={{fontFamily:mono,background:C.bg,color:C.text,minHeight:'100vh',display:'flex',alignItems:'center',justifyContent:'center'}}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&display=swap');*{box-sizing:border-box;margin:0;padding:0}input{outline:none}`}</style>
      <div style={{width:320,background:C.surf,border:`1px solid ${C.amber}`,padding:'36px 40px'}}>
        <div style={{...lbl,marginBottom:6,color:C.amber}}>◆ LIVE RIG SYSTEM</div>
        <div style={{fontSize:22,fontWeight:700,letterSpacing:2,marginBottom:24}}>ACCESS</div>
        {[['text',loginU,setLoginU,'USERNAME'],['password',loginP,setLoginP,'PASSWORD']].map(([t,v,s,ph])=>(
          <input key={ph} type={t} placeholder={ph} value={v} onChange={e=>s(e.target.value)}
            onKeyDown={e=>e.key==='Enter'&&(loginU&&loginP?setAuthed(true):setLoginErr('ENTER CREDENTIALS'))}
            style={{display:'block',width:'100%',background:C.bg,border:`1px solid ${C.borderHi}`,color:C.text,padding:'10px 13px',fontFamily:mono,fontSize:12,marginBottom:10}}/>
        ))}
        {loginErr&&<div style={{fontSize:10,color:C.red,marginBottom:10}}>{loginErr}</div>}
        <button style={{...B(),width:'100%',padding:12,fontSize:12,letterSpacing:2}} onClick={()=>loginU&&loginP?setAuthed(true):setLoginErr('ENTER CREDENTIALS')}>ENTER →</button>
        <div style={{fontSize:9,color:C.dim,textAlign:'center',marginTop:14}}>DEMO: ANY CREDENTIALS</div>
      </div>
    </div>
  );

  const TABS=['seq','synth','rr','samp','mixer','fx','sets'];
  const TLBL={seq:'SEQ',synth:'SYNTH',rr:'ROAD RASH',samp:'SAMPLER',mixer:'MIXER',fx:'FX',sets:'SETS'};

  return(
    <div style={{fontFamily:mono,background:C.bg,color:C.text,minHeight:'100vh'}}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&display=swap');*{box-sizing:border-box;margin:0;padding:0}input[type=range]{-webkit-appearance:none;height:3px;background:#1e1e1e;border-radius:2px;outline:none}input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:14px;height:14px;border-radius:50%;background:#BA7517;cursor:pointer}button:hover{opacity:0.85}button{transition:opacity 0.1s}input{outline:none}`}</style>

      {/* HEADER */}
      <div style={{background:C.surf,borderBottom:`1px solid ${C.border}`,padding:'0 20px',display:'flex',alignItems:'stretch',flexWrap:'wrap',minHeight:50}}>
        <div style={{display:'flex',alignItems:'center',gap:10,paddingRight:18,borderRight:`1px solid ${C.border}`}}>
          <div style={{width:8,height:8,borderRadius:'50%',background:playing?C.teal:C.border}}/>
          <span style={{color:C.amber,fontSize:11,fontWeight:700,letterSpacing:3}}>LIVE RIG</span>
        </div>
        <div style={{display:'flex',alignItems:'center',gap:16,padding:'0 18px',borderRight:`1px solid ${C.border}`}}>
          <button style={{...B(playing?C.red:C.teal),padding:'6px 16px'}} onClick={()=>{ea();setPlaying(p=>!p);}}>
            {playing?'■ STOP':'▶ PLAY'}
          </button>
          <div style={{display:'flex',alignItems:'center',gap:8}}>
            <span style={lbl}>BPM</span>
            <input type="range" min={60} max={200} value={bpm} onChange={e=>setBpm(+e.target.value)} style={{width:100}}/>
            <span style={{color:C.amber,fontSize:14,fontWeight:700,minWidth:34}}>{bpm}</span>
          </div>
        </div>
        <div style={{display:'flex',alignItems:'center'}}>
          {TABS.map(t=>(
            <button key={t} onClick={()=>setTab(t)} style={{fontFamily:mono,fontSize:10,letterSpacing:1.5,textTransform:'uppercase',padding:'0 14px',height:'100%',border:'none',borderRight:`1px solid ${C.border}`,background:tab===t?C.amber:'transparent',color:tab===t?'#000':C.muted,fontWeight:tab===t?700:400,cursor:'pointer'}}>{TLBL[t]}</button>
          ))}
        </div>
        {playing&&<div style={{marginLeft:'auto',display:'flex',alignItems:'center',paddingRight:8}}><span style={{...lbl,color:C.teal}}>STEP {String(step+1).padStart(2,'0')}/16</span></div>}
      </div>

      <div style={{padding:'16px 20px',maxWidth:1100,margin:'0 auto'}}>

        {/* SEQ */}
        {tab==='seq'&&(
          <div style={panel}>
            <div style={{...lbl,marginBottom:16}}>◈ STEP SEQUENCER · {bpm} BPM</div>
            {TRACKS.map((name,ti)=>(
              <div key={ti} style={{display:'flex',alignItems:'center',gap:5,marginBottom:10}}>
                <div style={{width:46,fontSize:10,color:TC[ti],letterSpacing:1.5,flexShrink:0}}>{name}</div>
                {Array(16).fill(0).map((_,si)=>{const on=pat[ti][si],cur=si===step;return(
                  <div key={si} style={{display:'flex',alignItems:'center'}}>
                    {si>0&&si%4===0&&<div style={{width:1,height:30,background:C.border,marginRight:5}}/>}
                    <div onClick={()=>toggleStep(ti,si)} style={{width:30,height:30,borderRadius:3,cursor:'pointer',flexShrink:0,background:on?TC[ti]+'cc':cur?'#1a1a1a':'#111',border:`1px solid ${cur?TC[ti]:on?TC[ti]+'66':C.border}`,outline:cur&&!on?`1px solid ${C.muted}`:'',boxShadow:cur&&on?`0 0 10px ${TC[ti]}`:on?`0 0 5px ${TC[ti]}33`:'',transition:'all 0.04s'}}/>
                  </div>
                );})}
              </div>
            ))}
            <div style={{display:'flex',gap:6,marginTop:10}}>
              <button style={B(C.amber,false)} onClick={()=>setPat(DEFAULT_PAT())}>RESET</button>
              <button style={B(C.amber,false)} onClick={()=>setPat(TRACKS.map(()=>Array(16).fill(false)))}>CLEAR</button>
              <button style={B(C.blue,false)} onClick={()=>setPat(TRACKS.map(()=>Array(16).fill(false).map(()=>Math.random()>0.72)))}>RANDOM</button>
            </div>
          </div>
        )}

        {/* SYNTH */}
        {tab==='synth'&&(
          <div style={panel}>
            <div style={{...lbl,marginBottom:16}}>◈ SYNTH ENGINE · POLYPHONIC</div>
            <div style={{marginBottom:14}}><div style={{...lbl,marginBottom:8}}>WAVEFORM</div><div style={{display:'flex',gap:6}}>{WAVEFORMS.map(w=><button key={w} style={B(C.amber,sw===w)} onClick={()=>setSw(w)}>{w.slice(0,3).toUpperCase()}</button>)}</div></div>
            <div style={{marginBottom:14}}><div style={{...lbl,marginBottom:8}}>OCTAVE</div><div style={{display:'flex',gap:6}}>{[2,3,4,5,6].map(o=><button key={o} style={B(C.amber,so===o)} onClick={()=>setSo(o)}>{o}</button>)}</div></div>
            <div style={{marginBottom:14}}><div style={{...lbl,marginBottom:8}}>NOTE — click to play</div><div style={{display:'flex',gap:5,flexWrap:'wrap'}}>{NOTES.map(n=><button key={n} style={{...B(n.includes('#')?C.blue:C.amber,sn===n),minWidth:44}} onClick={()=>{setSn(n);setTimeout(()=>{ea();engine.playSynth({freq:noteFreq(n,so),wave:sw,atk:satk/1000,rel:srel/1000,filter:sflt});},0);}}>{n}</button>)}</div></div>
            {[['ATTACK ms',satk,setSatk,1,2000],['RELEASE ms',srel,setSrel,50,4000],['FILTER Hz',sflt,setSflt,100,8000]].map(([l,v,s,mn,mx])=>(
              <div key={l} style={{marginBottom:12}}><div style={{...lbl,marginBottom:5}}>{l}</div><div style={{display:'flex',alignItems:'center',gap:10}}><input type="range" min={mn} max={mx} value={v} onChange={e=>s(+e.target.value)} style={{width:200}}/><span style={{color:C.amber,fontSize:12,minWidth:60,fontFamily:mono}}>{v}</span></div></div>
            ))}
            <button style={{...B(C.teal),marginTop:4}} onClick={triggerSynth}>▶ TRIGGER</button>
            <span style={{fontSize:10,color:C.muted,marginLeft:12}}>{sn}{so} · {noteFreq(sn,so).toFixed(1)}Hz</span>
          </div>
        )}

        {/* ROAD RASH */}
        {tab==='rr'&&(
          <div style={panel}>
            <div style={{display:'flex',alignItems:'center',marginBottom:16}}>
              <div style={{...lbl}}>◈ ROAD RASH FM SYNTH · YM2612-STYLE</div>
              <div style={{marginLeft:'auto',display:'flex',gap:6}}>
                <button style={B(rrOn?C.teal:C.amber,true)} onClick={()=>setRrOn(v=>!v)}>{rrOn?'ARP ON':'ARP OFF'}</button>
                <button style={B(C.blue,false)} onClick={()=>{ea();engine.playRRNote(noteFreq('E',2),engine.ctx.currentTime,0.5,{modRatio:rrMR,modIdx:rrMI,detune:rrDet,filt:rrFlt,atk:rrAtk,rel:rrRel});}}>▶ TEST</button>
              </div>
            </div>
            <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:14,marginBottom:16}}>
              {[['MOD RATIO',rrMR,setRrMR,0.1,4,0.1],['MOD INDEX',rrMI,setRrMI,0,8,0.1],['DETUNE ct',rrDet,setRrDet,0,50,1],['FILTER Hz',rrFlt,setRrFlt,200,6000,10],['ATTACK ms',rrAtk,setRrAtk,1,200,1],['RELEASE ms',rrRel,setRrRel,20,800,5],['RR DRIVE',rrDrv,setRrDrv,0,100,1]].map(([l,v,s,mn,mx,st])=>(
                <div key={l}><div style={{...lbl,marginBottom:5}}>{l}</div><input type="range" min={mn} max={mx} step={st} value={v} onChange={e=>s(+e.target.value)} style={{width:'100%'}}/><span style={{fontSize:10,color:C.amber,fontFamily:mono}}>{v<10?+v.toFixed(1):Math.round(v)}</span></div>
              ))}
            </div>
            <div style={{...lbl,marginBottom:10}}>ARP PATTERN · CLICK STEP TO CYCLE NOTES</div>
            <div style={{display:'flex',gap:4,overflowX:'auto',paddingBottom:8}}>
              {rrPat.map((s,si)=>{const on=s?.note,cur=si===step;return(
                <div key={si} style={{display:'flex',alignItems:'center'}}>
                  {si>0&&si%4===0&&<div style={{width:1,height:50,background:C.border,marginRight:4}}/>}
                  <div onClick={()=>cycleRRStep(si)} style={{width:34,height:50,borderRadius:3,cursor:'pointer',flexShrink:0,border:`1px solid ${cur?C.amber:on?C.blue:C.border}`,background:on?C.blue+'22':'#111',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'flex-end',padding:3,gap:2,outline:cur?`1px solid ${C.amber}`:''}}>
                    {on?<div style={{background:C.blue,color:'#fff',fontSize:9,fontWeight:700,padding:'2px 3px',borderRadius:2,width:'100%',textAlign:'center',fontFamily:mono}}>{s.note}{s.oct}</div>:<div style={{color:C.dim,fontSize:9}}>—</div>}
                    <div style={{fontSize:8,color:C.muted}}>{si+1}</div>
                  </div>
                </div>
              );})}
            </div>
            <div style={{display:'flex',gap:6,marginTop:12}}>
              <button style={B(C.amber,false)} onClick={()=>setRrPat(DEFAULT_RR_PAT())}>RESET ARP</button>
              <button style={B(C.amber,false)} onClick={()=>setRrPat(Array(16).fill({note:null,oct:null}))}>CLEAR ARP</button>
            </div>
          </div>
        )}

        {/* SAMPLER */}
        {tab==='samp'&&(
          <div style={panel}>
            <div style={{...lbl,marginBottom:6}}>◈ SAMPLER · 8 PADS</div>
            <div style={{fontSize:10,color:C.muted,marginBottom:16}}>Keys: Q W E R / A S D F · Click empty pad to load audio file</div>
            <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:10}}>
              {pads.map((pad,i)=>(
                <div key={i} style={{display:'flex',flexDirection:'column',gap:5}}>
                  <div onClick={()=>{if(pad.buf){ea();engine.triggerPad(pad.buf,pad.vol,pad.pitch);}else document.getElementById(`file-${i}`).click();}} style={{border:`1px solid ${pad.buf?C.amber:C.border}`,borderRadius:3,background:pad.buf?C.amber+'11':'#0d0d0d',cursor:'pointer',padding:'12px 8px',height:82,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:4}}>
                    <div style={{fontSize:9,color:C.muted,letterSpacing:1.5}}>{PAD_KEYS[i]}</div>
                    {pad.buf?<div style={{fontSize:10,color:C.amber,fontWeight:700,textAlign:'center',wordBreak:'break-all',maxWidth:'100%',overflow:'hidden'}}>{pad.name}</div>:<div style={{fontSize:9,color:C.dim}}>EMPTY · CLICK TO LOAD</div>}
                  </div>
                  {pad.buf&&(
                    <div style={{display:'flex',gap:4}}>
                      <button style={{...B(C.amber,false),padding:'3px 8px',fontSize:9,flex:1}} onClick={()=>document.getElementById(`file-${i}`).click()}>LOAD</button>
                      <button style={{...B(C.red,false),padding:'3px 8px',fontSize:9}} onClick={()=>setPads(p=>p.map((pd,pi)=>pi===i?{...pd,buf:null,name:`PAD ${i+1}`}:pd))}>✕</button>
                    </div>
                  )}
                  <input id={`file-${i}`} type="file" accept="audio/*" style={{display:'none'}} onChange={e=>e.target.files[0]&&loadPad(i,e.target.files[0])}/>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* MIXER */}
        {tab==='mixer'&&(
          <div style={panel}>
            <div style={{...lbl,marginBottom:16}}>◈ CHANNEL MIXER — ALL DEVICES</div>
            <div style={{display:'flex',overflowX:'auto',gap:0}}>
              {[['DRUMS','drums',C.amber],['SYNTH','synth',C.blue],['ROAD RASH','rr',C.teal],['SAMPLER','samp',C.pink],['MASTER','master',C.purple]].map(([name,key,col],i)=>{
                const m=mx[key]; const isMaster=key==='master';
                return(
                  <div key={key} style={{display:'flex',flexDirection:'column',alignItems:'center',gap:8,padding:'12px 18px',borderRight:`1px solid ${C.border}`,minWidth:96,...(isMaster?{borderLeft:`2px solid ${C.borderHi}`,marginLeft:8}:{})}}>
                    <div style={{fontSize:10,color:col,letterSpacing:1,textAlign:'center',fontWeight:700,whiteSpace:'nowrap'}}>{name}</div>
                    {!isMaster&&(
                      <div style={{display:'flex',gap:4}}>
                        <button style={{...B(m.solo?col:C.amber,m.solo),padding:'2px 8px',fontSize:9}} onClick={()=>updateMx(key,'solo',!m.solo)}>S</button>
                        <button style={{...B(m.mute?C.red:C.amber,m.mute),padding:'2px 8px',fontSize:9}} onClick={()=>updateMx(key,'mute',!m.mute)}>M</button>
                      </div>
                    )}
                    {!isMaster&&<div style={{height:4}}/>}
                    {/* Vertical fader via rotation */}
                    <div style={{height:120,width:30,display:'flex',alignItems:'center',justifyContent:'center',overflow:'hidden'}}>
                      <input type="range" min={0} max={100} value={m.vol} onChange={e=>updateMx(key,'vol',+e.target.value)} style={{width:120,transform:'rotate(-90deg)',transformOrigin:'center',cursor:'pointer',margin:0}}/>
                    </div>
                    <span style={{fontSize:11,color:col,fontFamily:mono}}>{m.vol}%</span>
                    <div style={{...lbl,fontSize:9}}>PAN</div>
                    <input type="range" min={-100} max={100} value={m.pan} onChange={e=>updateMx(key,'pan',+e.target.value)} style={{width:72}}/>
                    <span style={{fontSize:10,color:C.muted,fontFamily:mono}}>{m.pan===0?'C':m.pan>0?`R${m.pan}`:`L${Math.abs(m.pan)}`}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* FX */}
        {tab==='fx'&&(
          <div style={panel}>
            <div style={{...lbl,marginBottom:18}}>◈ SHARED EFFECTS — POST MASTER BUS</div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:24}}>
              <div>
                <div style={{...lbl,color:C.pink,marginBottom:12}}>DISTORTION</div>
                <div style={{...lbl,marginBottom:5}}>DRIVE</div>
                <input type="range" min={0} max={100} value={fxDist} onChange={e=>setFxDist(+e.target.value)} style={{width:'100%'}}/>
                <span style={{fontSize:11,color:C.amber,fontFamily:mono}}>{fxDist}%</span>
              </div>
              <div>
                <div style={{...lbl,color:C.blue,marginBottom:12}}>DELAY</div>
                {[['TIME',fxDlyT,setFxDlyT,5,100],['FEEDBACK %',fxDlyFb,setFxDlyFb,0,85],['MIX %',fxDlyW,setFxDlyW,0,100]].map(([l,v,s,mn,mx])=>(
                  <div key={l} style={{marginBottom:8}}><div style={{...lbl,marginBottom:4}}>{l}</div><input type="range" min={mn} max={mx} value={v} onChange={e=>s(+e.target.value)} style={{width:'100%'}}/><span style={{fontSize:11,color:C.amber,fontFamily:mono}}>{l==='TIME'?(v/100).toFixed(2)+'s':v+'%'}</span></div>
                ))}
              </div>
              <div>
                <div style={{...lbl,color:C.purple,marginBottom:12}}>REVERB</div>
                <div style={{...lbl,marginBottom:5}}>WET</div>
                <input type="range" min={0} max={100} value={fxRvW} onChange={e=>setFxRvW(+e.target.value)} style={{width:'100%'}}/>
                <span style={{fontSize:11,color:C.amber,fontFamily:mono}}>{fxRvW}%</span>
              </div>
            </div>
          </div>
        )}

        {/* SETS */}
        {tab==='sets'&&(
          <div style={panel}>
            <div style={{...lbl,marginBottom:16}}>◈ SET PRESETS</div>
            <div style={{display:'flex',gap:8,marginBottom:18}}>
              <input value={presetName} onChange={e=>setPresetName(e.target.value)} placeholder="Preset name..."
                style={{background:C.bg,border:`1px solid ${C.borderHi}`,color:C.text,padding:'9px 13px',fontFamily:mono,fontSize:12,width:220}}/>
              <button style={B()} onClick={savePreset}>SAVE STATE</button>
            </div>
            {!presets.length&&<div style={{fontSize:12,color:C.muted}}>No presets saved.</div>}
            {presets.map((p,i)=>(
              <div key={i} style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'11px 16px',background:C.bg,border:`1px solid ${C.border}`,borderLeft:`3px solid ${C.amber}`,borderRadius:3,marginBottom:6}}>
                <div>
                  <div style={{fontSize:12,fontWeight:700}}>{p.name}</div>
                  <div style={{fontSize:10,color:C.muted,marginTop:3,letterSpacing:1}}>{p.bpm} BPM · {p.sw} · DIST {p.fxDist}% · RR {p.rrOn?'ON':'OFF'}</div>
                </div>
                <div style={{display:'flex',gap:6}}>
                  <button style={B(C.teal,false)} onClick={()=>loadPreset(p)}>LOAD</button>
                  <button style={B(C.red,false)} onClick={()=>setPresets(ps=>ps.filter((_,j)=>j!==i))}>✕</button>
                </div>
              </div>
            ))}
          </div>
        )}

      </div>
    </div>
  );
}