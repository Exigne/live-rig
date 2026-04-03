/**
 * PianoRoll.jsx — Polyphonic Piano Roll
 *
 * Each sequencer step can hold a CHORD: { notes:[{note,oct},...], len }
 * Clicking an empty cell ADDS that pitch to the step's chord.
 * Clicking an active cell REMOVES that pitch from the chord.
 * If chord becomes empty the step is cleared.
 * Clicking the note label on the left keyboard previews the note.
 */
import { useCallback } from "react";

const NOTES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];

const CELL_H = 15;
const KEY_W  = 62;

// Build the pitch grid rows: B5 → C1 (high to low)
const ROLL_NOTES = [];
for (let oct = 5; oct >= 1; oct--) {
  for (let ni = NOTES.length - 1; ni >= 0; ni--) {
    ROLL_NOTES.push({ note: NOTES[ni], oct, isBlack: NOTES[ni].includes('#') });
  }
}

/** Return the chord object for a step, normalising legacy single-note format */
function getChord(step) {
  if (!step) return null;
  if (step.notes) return step;
  if (step.note) return { notes:[{ note:step.note, oct:step.oct }], len:step.len||1 };
  return null;
}

/** True if a given pitch exists in the chord */
function hasNote(step, note, oct) {
  const c = getChord(step);
  return c?.notes.some(n => n.note===note && n.oct===oct) ?? false;
}

/** CSS colour helpers */
const alpha = (hex, a) => {
  const r=parseInt(hex.slice(1,3),16), g=parseInt(hex.slice(3,5),16), b=parseInt(hex.slice(5,7),16);
  return `rgba(${r},${g},${b},${a})`;
};

export function PianoRoll({ trackDef, seqData, currentStep, highlightStep, seqLen=16, stepsPerBeat=4, onUpdate, onClose, onPlayNote }) {
  const col = trackDef.col;

  const toggle = useCallback((si, note, oct) => {
    const cur = seqData[si];
    const chord = getChord(cur);

    if (!chord) {
      // No notes yet — create chord with this note
      onUpdate(si, { notes:[{ note, oct }], len:1 });
      if (onPlayNote) onPlayNote(note, oct);
    } else {
      const already = chord.notes.some(n => n.note===note && n.oct===oct);
      if (already) {
        // Remove this note from chord
        const remaining = chord.notes.filter(n => !(n.note===note && n.oct===oct));
        onUpdate(si, remaining.length > 0 ? { ...chord, notes:remaining } : null);
      } else {
        // Add to chord
        const merged = { ...chord, notes:[...chord.notes, { note, oct }] };
        onUpdate(si, merged);
        if (onPlayNote) onPlayNote(note, oct);
      }
    }
  }, [seqData, onUpdate, onPlayNote]);

  // Chord label for step header (shows note names)
  const chordLabel = (si) => {
    const c = getChord(seqData[si]);
    if (!c) return '';
    if (c.notes.length === 1) return c.notes[0].note + c.notes[0].oct;
    return c.notes.map(n => n.note).join('+');
  };

  return (
    <div style={{
      position:'fixed', inset:0, background:'rgba(0,0,0,0.40)',
      display:'flex', alignItems:'center', justifyContent:'center', zIndex:2000,
    }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{
        width:'92vw', maxWidth:1020, height:'80vh', maxHeight:660,
        background:'#fff', borderRadius:12,
        boxShadow:'0 24px 80px rgba(0,0,0,0.22)',
        display:'flex', flexDirection:'column', overflow:'hidden',
        fontFamily:"'JetBrains Mono','Fira Code',monospace",
      }}>

        {/* Header */}
        <div style={{ height:48, flexShrink:0, background:col, display:'flex', alignItems:'center', padding:'0 18px', gap:14 }}>
          <div style={{ width:8, height:8, borderRadius:'50%', background:'rgba(255,255,255,0.55)', flexShrink:0 }}/>
          <span style={{ color:'#fff', fontSize:12, fontWeight:700, letterSpacing:2, textTransform:'uppercase' }}>
            Piano Roll — {trackDef.name}
          </span>
          <span style={{ fontSize:10, color:'rgba(255,255,255,0.65)', marginLeft:4 }}>
            Click to add note · Click again to remove · Chords: click multiple pitches in the same step
          </span>
          <button onClick={onClose} style={{
            marginLeft:'auto', width:28, height:28, borderRadius:'50%',
            background:'rgba(255,255,255,0.2)', border:'none', color:'#fff',
            fontSize:16, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center',
          }}>✕</button>
        </div>

        {/* Step header row */}
        <div style={{ display:'flex', flexShrink:0, borderBottom:`2px solid #e8e6e2`, background:'#f8f7f4' }}>
          <div style={{ width:KEY_W, flexShrink:0, borderRight:`2px solid #e0ddd8`, padding:'4px 8px' }}>
            <div style={{ fontSize:8, color:'#aaa', letterSpacing:1 }}>STEP</div>
          </div>
          <div style={{ flex:1, display:'flex', height:30 }}>
            {Array(seqLen).fill(0).map((_,si) => {
              const active  = !!getChord(seqData[si]);
              const beat    = si % stepsPerBeat === 0;
              const playing = si === currentStep;
              const label   = chordLabel(si);
              return (
                <div key={si} style={{
                  flex:1, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center',
                  fontSize:8, fontWeight: beat?700:400,
                  color: active ? '#fff' : beat ? '#555' : '#bbb',
                  background: playing ? '#fffbe6'
                    : active ? alpha(col, 0.75)
                    : si === highlightStep ? alpha(col, 0.12)
                    : si%8<4 ? '#fff' : '#f8f7f4',
                  borderRight:`1px solid ${(si+1)%stepsPerBeat===0?'#d0cdc8':'#ece9e4'}`,
                  gap:1, overflow:'hidden', padding:'0 1px', cursor:'default',
                }}>
                  <div style={{ fontSize:7, fontWeight:700, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis', maxWidth:'100%', padding:'0 1px' }}>
                    {label}
                  </div>
                  <div style={{ fontSize:7, opacity:0.7 }}>{si+1}</div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Piano + Grid */}
        <div style={{ flex:1, overflow:'hidden', display:'flex' }}>
          {/* Keyboard */}
          <div style={{ width:KEY_W, flexShrink:0, borderRight:`2px solid #e0ddd8`, background:'#fafafa', overflowY:'hidden' }} id="pr-keys">
            {ROLL_NOTES.map(({ note, oct, isBlack }) => (
              <div key={`k-${note}${oct}`}
                onClick={() => onPlayNote && onPlayNote(note, oct)}
                title={`Preview ${note}${oct}`}
                style={{
                  height:CELL_H, display:'flex', alignItems:'center', paddingLeft: isBlack?6:10,
                  background: isBlack ? '#2e2e2e' : '#fff',
                  borderBottom:`1px solid ${note==='C'?'#b8b5b0':isBlack?'#1a1a1a':'#ede9e4'}`,
                  fontSize:8, letterSpacing:0.5, cursor:'pointer',
                  color: isBlack ? '#888' : note==='C' ? col : '#bbb',
                  fontWeight: note==='C'?700:400,
                  borderLeft: `3px solid ${isBlack?'#111':note==='C'?col+'80':'#e0ddd8'}`,
                  userSelect:'none',
                }}>
                {(!isBlack && (note==='C'||note==='E'||note==='A')) ? `${note}${oct}` : ''}
              </div>
            ))}
          </div>

          {/* Grid */}
          <div style={{ flex:1, overflow:'auto' }} id="pr-grid"
            onScroll={e => { const k=document.getElementById('pr-keys'); if(k) k.scrollTop=e.target.scrollTop; }}>
            <div style={{ display:'flex', minWidth:`${seqLen*28}px` }}>
              {Array(seqLen).fill(0).map((_,si) => {
                const chord   = getChord(seqData[si]);
                const playing = si === currentStep;
                const hlit    = si === highlightStep;
                return (
                  <div key={si} style={{
                    flex:'0 0 28px', minWidth:28,
                    background: playing ? '#fffbe6' : hlit ? alpha(col,0.07) : si%8<4?'#fff':'#faf9f6',
                    borderRight:`1px solid ${(si+1)%stepsPerBeat===0?'#d0cdc8':'#ece9e4'}`,
                  }}>
                    {ROLL_NOTES.map(({ note, oct, isBlack }) => {
                      const on = hasNote(seqData[si], note, oct);
                      return (
                        <div key={`${note}${oct}`}
                          onClick={() => toggle(si, note, oct)}
                          style={{
                            height:CELL_H, cursor:'pointer',
                            background: on ? col : isBlack ? '#f0ede8' : 'transparent',
                            borderBottom:`1px solid ${note==='C'?'#d0cdc8':'#ede9e4'}`,
                            position:'relative', transition:'background 0.05s',
                          }}>
                          {on && (
                            <div style={{
                              position:'absolute', inset:1, background:'rgba(255,255,255,0.22)',
                              borderRadius:2, display:'flex', alignItems:'center', justifyContent:'center',
                              fontSize:6, color:'#fff', fontWeight:700, letterSpacing:0.3,
                            }}>
                              {note}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div style={{
          height:42, flexShrink:0, background:'#f4f2ee', borderTop:'1px solid #e0ddd8',
          display:'flex', alignItems:'center', padding:'0 18px', gap:14,
        }}>
          <span style={{ fontSize:10, color:'#999' }}>
            {seqData.filter(s => !!getChord(s)).length} / {seqLen} steps  ·  
            {seqData.reduce((acc,s)=>acc+(getChord(s)?.notes.length||0),0)} total notes
          </span>
          <button onClick={()=>onUpdate('clear')} style={{
            fontSize:10, padding:'4px 12px', border:'1px solid #d0cdc8', background:'#fff',
            borderRadius:4, cursor:'pointer', color:'#666', fontFamily:'inherit',
          }}>Clear All</button>
          <button onClick={()=>{
            // Fill all steps with the same chord (first non-null step)
            const firstChord = seqData.find(s => !!getChord(s));
            if (!firstChord) return;
            const c = getChord(firstChord);
            Array(seqLen).fill(0).forEach((_,si) => { if (!seqData[si]) onUpdate(si, { ...c, len:1 }); });
          }} style={{
            fontSize:10, padding:'4px 12px', border:'1px solid #d0cdc8', background:'#fff',
            borderRadius:4, cursor:'pointer', color:'#666', fontFamily:'inherit',
          }}>Fill Empty</button>
          <button onClick={onClose} style={{
            marginLeft:'auto', background:col, color:'#fff', border:'none',
            padding:'6px 22px', borderRadius:5, cursor:'pointer', fontSize:11,
            fontWeight:700, letterSpacing:1, fontFamily:'inherit',
          }}>DONE</button>
        </div>
      </div>
    </div>
  );
}
