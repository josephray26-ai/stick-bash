// Tiny synthesized SFX via Web Audio (no asset files needed)
let ctx = null;
let muted = false;

function ac() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) ctx = new AC();
  }
  if (ctx && ctx.state === 'suspended') ctx.resume();
  return ctx;
}

// Call once on first user gesture to unlock audio on mobile
export function unlockAudio() { ac(); }
export function setMuted(v) { muted = v; }
export function isMuted() { return muted; }

function tone({ freq = 440, type = 'sine', dur = 0.12, vol = 0.2, slideTo = null, delay = 0 }) {
  const c = ac();
  if (!c || muted) return;
  const t0 = c.currentTime + delay;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(vol, t0 + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(gain).connect(c.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

function noise({ dur = 0.15, vol = 0.25, delay = 0 }) {
  const c = ac();
  if (!c || muted) return;
  const t0 = c.currentTime + delay;
  const buf = c.createBuffer(1, c.sampleRate * dur, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
  const src = c.createBufferSource();
  src.buffer = buf;
  const gain = c.createGain();
  gain.gain.setValueAtTime(vol, t0);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  const filt = c.createBiquadFilter();
  filt.type = 'lowpass';
  filt.frequency.value = 1800;
  src.connect(filt).connect(gain).connect(c.destination);
  src.start(t0);
}

export const sfx = {
  swing() { tone({ freq: 520, slideTo: 180, type: 'triangle', dur: 0.16, vol: 0.12 }); },
  hit() {
    noise({ dur: 0.12, vol: 0.3 });
    tone({ freq: 160, slideTo: 70, type: 'square', dur: 0.14, vol: 0.18 });
  },
  coin() {
    tone({ freq: 880, type: 'square', dur: 0.06, vol: 0.12 });
    tone({ freq: 1320, type: 'square', dur: 0.08, vol: 0.12, delay: 0.06 });
  },
  unlock() {
    [523, 659, 784, 1046].forEach((f, i) => tone({ freq: f, type: 'triangle', dur: 0.18, vol: 0.16, delay: i * 0.08 }));
  },
  buy() {
    tone({ freq: 660, type: 'square', dur: 0.08, vol: 0.14 });
    tone({ freq: 990, type: 'square', dur: 0.1, vol: 0.14, delay: 0.08 });
  },
  deny() { tone({ freq: 200, slideTo: 120, type: 'sawtooth', dur: 0.18, vol: 0.14 }); },
  hurt() {
    noise({ dur: 0.18, vol: 0.28 });
    tone({ freq: 240, slideTo: 90, type: 'sawtooth', dur: 0.22, vol: 0.2 });
  },
  defeat() {
    [392, 330, 262, 196].forEach((f, i) => tone({ freq: f, type: 'triangle', dur: 0.22, vol: 0.16, delay: i * 0.1 }));
  },
};
