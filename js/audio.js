import { B } from './blocks.js';

let ctx = null, master = null, noiseBuf = null;
let muted = false;

export function setMuted(m) { muted = m; }
export function isMuted() { return muted; }

// Must be called from a user gesture (click/keydown)
export function ensureAudio() {
  if (ctx) {
    if (ctx.state === 'suspended') ctx.resume();
    return;
  }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = 0.5;
  master.connect(ctx.destination);

  noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.3, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
}

const STONEY = new Set([B.STONE, B.COBBLE, B.COAL, B.IRON, B.GOLD, B.DIAMOND, B.BEDROCK, B.BRICK]);
const WOODY = new Set([B.LOG, B.PLANK]);
const PLANTY = new Set([B.LEAVES, B.ROSE, B.DANDELION, B.TALLGRASS, B.CACTUS]);

function baseFreq(id) {
  if (STONEY.has(id)) return 850;
  if (WOODY.has(id)) return 600;
  if (PLANTY.has(id)) return 1500;
  if (id === B.SAND) return 350;
  if (id === B.SNOW || id === B.SNOWGRASS) return 300;
  if (id === B.GLASS) return 2600;
  return 460; // dirt/grass
}

function thunk(freq, dur, vol) {
  if (!ctx || muted) return;
  const t0 = ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  src.playbackRate.value = 0.7 + Math.random() * 0.6;
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = freq;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(vol, t0);
  gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  src.connect(filter).connect(gain).connect(master);
  src.start(t0);
  src.stop(t0 + dur);
}

export function playBlockSound(id, kind) {
  const f = baseFreq(id);
  if (kind === 'break') thunk(f, 0.12, 0.25);
  else if (kind === 'place') thunk(f * 1.25, 0.07, 0.18);
  else if (kind === 'step') thunk(f * 0.7, 0.05, 0.08);
  else if (kind === 'land') thunk(f * 0.5, 0.1, 0.16);
}
