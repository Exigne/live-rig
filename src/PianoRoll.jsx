/**
 * PianoRoll.jsx
 * Pops up when a user clicks a step in a pitched sequencer track.
 * Shows a full 16-step × 5-octave grid with piano keyboard on the left.
 * Click a cell to set that step's note; click an active cell to clear it.
 */

const NOTES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const CELL_H = 15;
const KEY_W  = 58;

// Build notes high → low (B5 down to C1)
const ROLL_NOTES = [];
for (let oct = 5; oct >= 1; oct--) {
  for (let ni = NOTES.length - 1; ni >= 0; ni--) {
    ROLL_NOTES.push({ note: NOTES[ni], oct, isBlack: NOTES[ni].includes('#') });
  }
}

// Added onPlayNote to the props!
export function PianoRoll({ trackDef, seqData, currentStep, highlightStep, onUpdate, onClose, onPlayNote }) {
  
  const toggle = (si, note, oct) => {
    const cur = seqData[si];
    if (cur?.note === note && cur?.oct === oct) onUpdate(si, null);
    else onUpdate(si, { note, oct });
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 2000,
    }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{
        width: '90vw', maxWidth: 960,
        height: '78vh', maxHeight: 640,
        background: '#fff', borderRadius: 10,
        boxShadow: '0 24px 80px rgba(0,0,0,0.25)',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        fontFamily: "'JetBrains Mono','Fira Code',monospace",
      }}>

        {/* ── Header ── */}
        <div style={{
          height: 46, flexShrink: 0,
          background: trackDef.col,
          display: 'flex', alignItems: 'center', padding: '0 18px', gap: 12,
        }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'rgba(255,255,255,0.6)' }} />
          <span style={{ color: '#fff', fontSize: 12, fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase' }}>
            Piano Roll — {trackDef.name}
          </span>
          <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.6)', marginLeft: 8 }}>
            Click cell to place note · Click note to clear
          </span>
          <button onClick={onClose} style={{
            marginLeft: 'auto', width: 28, height: 28, borderRadius: '50%',
            background: 'rgba(255,255,255,0.2)', border: 'none', color: '#fff',
            fontSize: 16, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
            lineHeight: 1,
          }}>✕</button>
        </div>

        {/* ── Step header row ── */}
        <div style={{
          display: 'flex', flexShrink: 0,
          borderBottom: '2px solid #e8e6e2', background: '#f8f7f4',
        }}>
          <div style={{ width: KEY_W, flexShrink: 0, borderRight: '2px solid #e0ddd8' }} />
          <div style={{ flex: 1, display: 'flex', height: 28 }}>
            {Array(16).fill(0).map((_,si) => (
              <div key={si} style={{
                flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 9, fontWeight: si % 4 === 0 ? 700 : 400,
                color: si % 4 === 0 ? '#333' : '#bbb',
                background: si === highlightStep
                  ? trackDef.col + '28'
                  : si === currentStep
                    ? '#fffbe6'
                    : si % 8 < 4 ? '#fff' : '#f8f7f4',
                borderRight: `1px solid ${si % 4 === 3 ? '#d0cdc8' : '#ece9e4'}`,
                letterSpacing: 1,
              }}>
                {si % 4 === 0 ? `${si / 4 + 1}` : si + 1}
              </div>
            ))}
          </div>
        </div>

        {/* ── Piano keys + Grid ── */}
        <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', display: 'flex' }}>

          {/* Piano keyboard (Left Side) */}
          <div style={{
            width: KEY_W, flexShrink: 0,
            borderRight: '2px solid #e0ddd8',
            background: '#fafafa',
          }}>
            {ROLL_NOTES.map(({ note, oct, isBlack }) => (
              <div 
                key={`k-${note}${oct}`} 
                // Added onClick handler to play the note!
                onClick={() => onPlayNote && onPlayNote(note, oct)}
                style={{
                  height: CELL_H, display: 'flex', alignItems: 'center',
                  paddingLeft: isBlack ? 6 : 10,
                  background: isBlack ? '#2a2828' : '#fff',
                  borderBottom: `1px solid ${note === 'C' ? '#c0bdb8' : isBlack ? '#222' : '#ece9e4'}`,
                  fontSize: 8, letterSpacing: 0.5,
                  color: isBlack ? '#888'
                    : note === 'C' ? trackDef.col
                    : '#bbb',
                  fontWeight: note === 'C' ? 700 : 400,
                  boxSizing: 'border-box',
                  borderLeft: isBlack ? '3px solid #111' : `3px solid ${note === 'C' ? trackDef.col + '80' : '#e0ddd8'}`,
                  cursor: onPlayNote ? 'pointer' : 'default', // Make it look clickable
              }}>
                {!isBlack && (note === 'C' || note === 'E' || note === 'G' || note === 'A')
                  ? `${note}${oct}` : ''}
              </div>
            ))}
          </div>

          {/* Grid columns (Right Side) */}
          <div style={{ flex: 1, display: 'flex', minWidth: 0 }}>
            {Array(16).fill(0).map((_,si) => (
              <div key={si} style={{
                flex: 1, minWidth: 0,
                background: si === highlightStep
                  ? trackDef.col + '14'
                  : si === currentStep
                    ? '#fffbe6'
                    : si % 8 < 4 ? '#fff' : '#faf9f6',
                borderRight: `1px solid ${si % 4 === 3 ? '#d0cdc8' : '#ece9e4'}`,
              }}>
                {ROLL_NOTES.map(({ note, oct, isBlack }) => {
                  const active = seqData[si]?.note === note && seqData[si]?.oct === oct;
                  return (
                    <div key={`${note}${oct}`}
                      onClick={() => toggle(si, note, oct)}
                      title={active ? `Clear ${note}${oct}` : `Set step ${si+1} → ${note}${oct}`}
                      style={{
                        height: CELL_H, cursor: 'pointer',
                        background: active
                          ? trackDef.col
                          : isBlack ? '#f0ede8' : 'transparent',
                        borderBottom: `1px solid ${note === 'C' ? '#d8d5d0' : '#f0ede8'}`,
                        boxSizing: 'border-box',
                        transition: 'background 0.06s',
                        position: 'relative',
                      }}>
                      {active && (
                        <div style={{
                          position: 'absolute', inset: 1,
                          background: 'rgba(255,255,255,0.25)',
                          borderRadius: 2,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: 7, color: '#fff', fontWeight: 700,
                        }}>
                          {note}{oct}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>

        {/* ── Footer ── */}
        <div style={{
          height: 40, flexShrink: 0,
          background: '#f4f2ee', borderTop: '1px solid #e0ddd8',
          display: 'flex', alignItems: 'center', padding: '0 18px', gap: 12,
        }}>
          <span style={{ fontSize: 10, color: '#9a9590' }}>
            {seqData.filter(Boolean).length} / 16 steps programmed
          </span>
          <button
            onClick={() => onUpdate('clear')}
            style={{ fontSize: 10, padding: '4px 12px', border: '1px solid #d0cdc8', background: '#fff', borderRadius: 4, cursor: 'pointer', color: '#666', fontFamily: 'inherit' }}>
            Clear All
          </button>
          <button onClick={onClose} style={{
            marginLeft: 'auto', background: trackDef.col, color: '#fff',
            border: 'none', padding: '6px 20px', borderRadius: 5,
            cursor: 'pointer', fontSize: 11, fontWeight: 700, letterSpacing: 1,
            fontFamily: 'inherit',
          }}>DONE</button>
        </div>
      </div>
    </div>
  );
}
