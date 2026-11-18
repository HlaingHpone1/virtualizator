export interface ControlsProps {
  index: number;
  total: number;
  playing: boolean;
  speed: number;
  onIndex: (i: number) => void;
  onPlay: (playing: boolean) => void;
  onSpeed: (ms: number) => void;
}

const SPEEDS = [
  { label: 'Slow', ms: 1500 },
  { label: 'Normal', ms: 800 },
  { label: 'Fast', ms: 300 },
];

export function Controls({ index, total, playing, speed, onIndex, onPlay, onSpeed }: ControlsProps) {
  const last = Math.max(0, total - 1);
  const disabled = total === 0;
  return (
    <div className="controls">
      <div className="buttons">
        <button onClick={() => onIndex(0)} disabled={disabled || index === 0} title="First step (Home)" aria-label="First step">⏮︎</button>
        <button onClick={() => onIndex(index - 1)} disabled={disabled || index === 0} title="Previous step (←)" aria-label="Previous step">◀︎</button>
        <button className="primary" onClick={() => onPlay(!playing)} disabled={disabled || (index === last && !playing)} title="Play / pause (Space)">
          {playing ? 'Pause' : 'Play'}
        </button>
        <button onClick={() => onIndex(index + 1)} disabled={disabled || index === last} title="Next step (→)" aria-label="Next step">▶︎</button>
        <button onClick={() => onIndex(last)} disabled={disabled || index === last} title="Last step (End)" aria-label="Last step">⏭︎</button>
        <select value={speed} onChange={(e) => onSpeed(Number(e.target.value))} aria-label="Playback speed">
          {SPEEDS.map((s) => (
            <option key={s.ms} value={s.ms}>{s.label}</option>
          ))}
        </select>
      </div>
      <div className="scrubber">
        <input
          type="range"
          min={0}
          max={last}
          value={index}
          disabled={disabled}
          onChange={(e) => onIndex(Number(e.target.value))}
          aria-label="Step"
        />
        <span className="step-count">
          Step {disabled ? 0 : index + 1} / {total}
        </span>
      </div>
    </div>
  );
}
