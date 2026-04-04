/**
 * PianoRoll.jsx — Polyphonic chord editor with drag-to-extend
 *
 * Step data format: { notes:[{note,oct},...], len:N }
 * Drag:  mousedown on any active note cell → drag right across columns → extends chord len
 *        Drag is tracked via refs so no stale-closure issues.
 * Click: click empty cell → add that pitch to chord (or create new chord)
 *        click active note cell → remove that pitch from chord
 */
import { useRef, useEffect, useCallback } from "react";

const NOTES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const CELL_H = 15;
const KEY_W  = 62;

// Pitch rows high → low (B5 → C1)
const ROLL_NOTES = [];
for(let oct=5;oct>=1;oct--)
  for(let ni=NOTES.length-1;ni>=0;ni--)
    ROLL_NOTES.push({ note:NOTES[ni], oct, isBlack:NOTES[ni].includes('#') });

/** Normalise step → chord or null */
function getChord(step){
  if(!step) return null;
  if(step.notes) return step;
  if(step.note) return { notes:[{note:step.note,oct:step.oct}], len:step.len||1 };
  return null;
}

function hasNote(step,note,oct){
  return getChord(step)?.notes.some(n=>n.note===note&&n.oct===oct)??false;
}

function chordLabel(step){
  const c=getChord(step); if(!c) return '';
  if(c.notes.length===1) return c.notes[0].note+c.notes[0].oct;
  if(c.notes.length<=3)  return c.notes.map(n=>n.note).join('+');
  return `${c.notes.length}♪`;
}

export function PianoRoll({ trackDef, seqData, currentStep, highlightStep, seqLen=16, stepsPerBeat=4, onUpdate, onClose, onPlayNote }){
  const col = trackDef.col;

  // ── Drag-to-extend refs ───────────────────────────────────────────────────
  // dragPR.current = { si: startStepIndex } while dragging, null otherwise
  const dragPR    = useRef(null);
  // didDrag prevents onClick from toggling after a drag
  const didDrag   = useRef(false);

  useEffect(()=>{
    const onUp=()=>{ dragPR.current=null; };
    window.addEventListener('mouseup',onUp);
    return()=>window.removeEventListener('mouseup',onUp);
  },[]);

  // Extend chord at dragPR.current.si so it reaches step targetSi
  const extendTo = useCallback((targetSi)=>{
    const ds=dragPR.current;
    if(!ds||targetSi<=ds.si) return;
    const chord=getChord(seqData[ds.si]);
    if(!chord) return;
    const newLen=Math.min(targetSi-ds.si+1, seqLen-ds.si);
    if(newLen===(chord.len||1)) return;
    didDrag.current=true;
    onUpdate(ds.si,{ ...chord, len:newLen });
  },[seqData,seqLen,onUpdate]);

  // Add or remove a note from a step's chord
  const toggle = useCallback((si,note,oct)=>{
    const cur=seqData[si];
    const chord=getChord(cur);
    if(!chord){
      onUpdate(si,{ notes:[{note,oct}], len:1 });
      if(onPlayNote) onPlayNote(note,oct);
    } else {
      const already=chord.notes.some(n=>n.note===note&&n.oct===oct);
      if(already){
        const rest=chord.notes.filter(n=>!(n.note===note&&n.oct===oct));
        onUpdate(si, rest.length>0?{...chord,notes:rest}:null);
      } else {
        onUpdate(si,{...chord,notes:[...chord.notes,{note,oct}]});
        if(onPlayNote) onPlayNote(note,oct);
      }
    }
  },[seqData,onUpdate,onPlayNote]);

  return (
    <div style={{ position:'fixed',inset:0,background:'rgba(0,0,0,0.42)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:2000 }}
      onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div style={{ width:'92vw',maxWidth:1040,height:'80vh',maxHeight:660,background:'#fff',borderRadius:12,boxShadow:'0 24px 80px rgba(0,0,0,0.22)',display:'flex',flexDirection:'column',overflow:'hidden',fontFamily:"'JetBrains Mono','Fira Code',monospace" }}>

        {/* Header */}
        <div style={{ height:46,flexShrink:0,background:col,display:'flex',alignItems:'center',padding:'0 18px',gap:14 }}>
          <div style={{ width:8,height:8,borderRadius:'50%',background:'rgba(255,255,255,0.5)',flexShrink:0 }}/>
          <span style={{ color:'#fff',fontSize:12,fontWeight:700,letterSpacing:2,textTransform:'uppercase' }}>Piano Roll — {trackDef.name}</span>
          <span style={{ fontSize:10,color:'rgba(255,255,255,0.65)' }}>Click to add/remove · Drag note right to extend · Keyboard for preview</span>
          <button onClick={onClose} style={{ marginLeft:'auto',width:28,height:28,borderRadius:'50%',background:'rgba(255,255,255,0.2)',border:'none',color:'#fff',fontSize:16,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center' }}>✕</button>
        </div>

        {/* Step header */}
        <div style={{ display:'flex',flexShrink:0,borderBottom:'2px solid #e8e6e2',background:'#f8f7f4' }}>
          <div style={{ width:KEY_W,flexShrink:0,borderRight:'2px solid #e0ddd8',padding:'4px 8px',fontSize:8,color:'#aaa',letterSpacing:1,display:'flex',alignItems:'center' }}>STEP</div>
          <div style={{ flex:1,display:'flex',height:30 }}>
            {Array(seqLen).fill(0).map((_,si)=>{
              const c=getChord(seqData[si]);
              const beat=si%stepsPerBeat===0;
              const playing=si===currentStep;
              const hlit=si===highlightStep;
              return (
                <div key={si} style={{ flex:1,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:1,
                  fontSize:8,fontWeight:beat?700:400,
                  color:c?'#fff':beat?'#555':'#bbb',
                  background:playing?'#fffbe6':c?col+'cc':hlit?col+'18':si%8<4?'#fff':'#f8f7f4',
                  borderRight:`1px solid ${(si+1)%stepsPerBeat===0?'#d0cdc8':'#ece9e4'}`,
                  overflow:'hidden',padding:'0 1px',cursor:'default' }}>
                  <div style={{ fontSize:7,fontWeight:700,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',maxWidth:'100%' }}>{chordLabel(seqData[si])}</div>
                  <div style={{ fontSize:7,opacity:.7 }}>{si+1}</div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Piano keys + grid */}
        <div style={{ flex:1,overflow:'hidden',display:'flex' }}>
          {/* Piano keyboard — click to preview */}
          <div style={{ width:KEY_W,flexShrink:0,borderRight:'2px solid #e0ddd8',background:'#fafafa',overflowY:'hidden' }} id="pr-keys">
            {ROLL_NOTES.map(({note,oct,isBlack})=>(
              <div key={`k-${note}${oct}`} onClick={()=>onPlayNote&&onPlayNote(note,oct)}
                style={{ height:CELL_H,display:'flex',alignItems:'center',paddingLeft:isBlack?6:10,
                  background:isBlack?'#2e2e2e':'#fff',
                  borderBottom:`1px solid ${note==='C'?'#b8b5b0':isBlack?'#1a1a1a':'#ede9e4'}`,
                  fontSize:8,letterSpacing:.5,cursor:'pointer',userSelect:'none',
                  color:isBlack?'#888':note==='C'?col:'#bbb',fontWeight:note==='C'?700:400,
                  borderLeft:`3px solid ${isBlack?'#111':note==='C'?col+'80':'#e0ddd8'}` }}>
                {!isBlack&&(note==='C'||note==='E'||note==='A')?`${note}${oct}`:''}
              </div>
            ))}
          </div>

          {/* Grid — columns = steps, rows = pitches */}
          <div style={{ flex:1,overflow:'auto' }} id="pr-grid"
            onScroll={e=>{ const k=document.getElementById('pr-keys'); if(k) k.scrollTop=e.target.scrollTop; }}>
            <div style={{ display:'flex',minWidth:`${seqLen*28}px` }}>
              {Array(seqLen).fill(0).map((_,si)=>{
                const playing=si===currentStep;
                const hlit=si===highlightStep;
                return (
                  <div key={si}
                    onMouseEnter={()=>extendTo(si)}
                    style={{ flex:'0 0 28px',minWidth:28,
                      background:playing?'#fffbe6':hlit?col+'10':si%8<4?'#fff':'#faf9f6',
                      borderRight:`1px solid ${(si+1)%stepsPerBeat===0?'#d0cdc8':'#ece9e4'}` }}>
                    {ROLL_NOTES.map(({note,oct,isBlack})=>{
                      const on=hasNote(seqData[si],note,oct);
                      return (
                        <div key={`${note}${oct}`}
                          onMouseDown={e=>{
                            if(on){
                              // Start drag from this column
                              dragPR.current={ si };
                              didDrag.current=false;
                              e.preventDefault();
                            }
                          }}
                          onClick={()=>{
                            if(didDrag.current){ didDrag.current=false; return; } // was a drag
                            toggle(si,note,oct);
                          }}
                          style={{ height:CELL_H,cursor:'pointer',
                            background:on?col:isBlack?'#f0ede8':'transparent',
                            borderBottom:`1px solid ${note==='C'?'#d0cdc8':'#ede9e4'}`,
                            position:'relative',transition:'background .05s' }}>
                          {on&&(
                            <div style={{ position:'absolute',inset:1,background:'rgba(255,255,255,0.22)',borderRadius:2,display:'flex',alignItems:'center',justifyContent:'center',fontSize:6,color:'#fff',fontWeight:700 }}>
                              {note}
                            </div>
                          )}
                        </div>
                      );
                    })}
                    {/* Length tail indicator: shows extended len as a strip at bottom */}
                    {(()=>{
                      const chord=getChord(seqData[si]);
                      if(!chord||!chord.len||chord.len<=1) return null;
                      return (
                        <div style={{ position:'absolute',bottom:0,left:0,
                          width:chord.len*28-2,height:3,background:col+'50',
                          borderRadius:2,pointerEvents:'none',zIndex:3 }}/>
                      );
                    })()}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div style={{ height:42,flexShrink:0,background:'#f4f2ee',borderTop:'1px solid #e0ddd8',display:'flex',alignItems:'center',padding:'0 18px',gap:14 }}>
          <span style={{ fontSize:10,color:'#999' }}>
            {seqData.filter(s=>!!getChord(s)).length}/{seqLen} steps  ·  {seqData.reduce((a,s)=>a+(getChord(s)?.notes.length||0),0)} notes
          </span>
          <button onClick={()=>onUpdate('clear')} style={{ fontSize:10,padding:'4px 12px',border:'1px solid #d0cdc8',background:'#fff',borderRadius:4,cursor:'pointer',color:'#666',fontFamily:'inherit' }}>Clear All</button>
          <button onClick={onClose} style={{ marginLeft:'auto',background:col,color:'#fff',border:'none',padding:'6px 22px',borderRadius:5,cursor:'pointer',fontSize:11,fontWeight:700,letterSpacing:1,fontFamily:'inherit' }}>DONE</button>
        </div>
      </div>
    </div>
  );
}
