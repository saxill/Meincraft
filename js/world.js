import { SEED, CHUNK, WORLD_H, SEA } from './config.js';
import { makeNoise2D, makeNoise3D, fbm, hash2, hash3 } from './noise.js';
import { AIR, B, BLOCKS } from './blocks.js';

const noiseA = makeNoise2D(SEED);
const noiseB = makeNoise2D(SEED * 7 + 3);
const tempNoise = makeNoise2D(SEED * 13 + 5);
const moistNoise = makeNoise2D(SEED * 29 + 11);
const cave1 = makeNoise3D(SEED + 101);
const cave2 = makeNoise3D(SEED + 202);
const cave3 = makeNoise3D(SEED + 303);

export function heightAt(wx, wz) {
  const continental = fbm(noiseA, wx * 0.004, wz * 0.004, 4, 2, 0.5);
  const hills = fbm(noiseB, wx * 0.02, wz * 0.02, 3, 2, 0.5);
  const h = 32 + continental * 26 + hills * 7;
  return Math.max(2, Math.min(WORLD_H - 30, Math.floor(h)));
}

export function biomeAt(wx, wz) {
  const t = fbm(tempNoise, wx * 0.0032, wz * 0.0032, 3, 2, 0.5);
  const m = fbm(moistNoise, wx * 0.0032 + 100, wz * 0.0032 - 100, 3, 2, 0.5);
  if (t < -0.22) return 'snowy';
  if (t > 0.26 && m < 0.05) return 'desert';
  if (m > 0.12) return 'forest';
  return 'plains';
}

// Spaghetti tunnels (two intersecting noise bands) + cheese caverns deeper down.
// Caves never breach the floor of oceans, and never go below y=2 (bedrock).
export function carvedAt(wx, y, wz, h) {
  if (y < 2 || y > h) return false;
  if (y > h - 5 && h <= SEA + 2) return false;
  const sx = wx * 0.05, sy = y * 0.09, sz = wz * 0.05;
  if (Math.abs(cave1(sx, sy, sz)) < 0.085 && Math.abs(cave2(sx, sy, sz)) < 0.085) return true;
  return y < h - 8 && cave3(wx * 0.03, y * 0.055, wz * 0.03) > 0.62;
}

function oreAt(wx, y, wz) {
  if (hash3(wx, y * 3 + 1, wz) < 0.25) return B.STONE; // ragged vein edges
  const cell = hash3(Math.floor(wx / 2), Math.floor(y / 2), Math.floor(wz / 2));
  if (cell < 0.022) return B.COAL;
  if (cell < 0.036 && y < 42) return B.IRON;
  if (cell < 0.043 && y < 24) return B.GOLD;
  if (cell < 0.048 && y < 14) return B.DIAMOND;
  return B.STONE;
}

function topBlockFor(biome, h) {
  if (h <= SEA + 1) return B.SAND;
  if (biome === 'desert') return B.SAND;
  if (h >= 62) return B.SNOW;
  if (h >= 56 || biome === 'snowy') return B.SNOWGRASS;
  return B.GRASS;
}

export function treeAt(wx, wz) {
  const h = heightAt(wx, wz);
  if (h <= SEA + 1 || h >= 56) return null;
  const biome = biomeAt(wx, wz);
  let p, type;
  if (biome === 'forest') { p = 0.025; type = 'oak'; }
  else if (biome === 'plains') { p = 0.004; type = 'oak'; }
  else if (biome === 'snowy') { p = 0.012; type = 'spruce'; }
  else return null;
  if (hash2(wx, wz) > p) return null;
  if (carvedAt(wx, h, wz, h)) return null;
  const trunk = type === 'spruce'
    ? 5 + Math.floor(hash2(wx + 31, wz - 17) * 3)
    : 4 + Math.floor(hash2(wx + 31, wz - 17) * 3);
  return { ground: h, trunk, type };
}

export const chunkKey = (cx, cz) => cx + ',' + cz;
export const blockIndex = (lx, y, lz) => (y * CHUNK + lz) * CHUNK + lx;

export function genChunkData(cx, cz) {
  const data = new Uint8Array(CHUNK * CHUNK * WORLD_H);
  const baseX = cx * CHUNK, baseZ = cz * CHUNK;

  for (let lz = 0; lz < CHUNK; lz++) {
    for (let lx = 0; lx < CHUNK; lx++) {
      const wx = baseX + lx, wz = baseZ + lz;
      const h = heightAt(wx, wz);
      const biome = biomeAt(wx, wz);
      const top = topBlockFor(biome, h);
      const under = biome === 'desert' || h <= SEA + 1 ? B.SAND : B.DIRT;

      for (let y = 0; y <= h; y++) {
        let id;
        if (y === 0 || (y === 1 && hash2(wx * 5 + 3, wz * 9 - 7) < 0.5)) id = B.BEDROCK;
        else if (carvedAt(wx, y, wz, h)) id = AIR;
        else if (y === h) id = top;
        else if (y >= h - 3) id = under;
        else id = oreAt(wx, y, wz);
        data[blockIndex(lx, y, lz)] = id;
      }
      for (let y = h + 1; y <= SEA; y++) {
        data[blockIndex(lx, y, lz)] = B.WATER;
      }
    }
  }

  // Trees: consider columns up to 2 blocks outside this chunk so canopies
  // crossing chunk borders are generated identically on both sides.
  const place = (x, y, z, id, force) => {
    const lx = x - baseX, lz = z - baseZ;
    if (lx < 0 || lx >= CHUNK || lz < 0 || lz >= CHUNK || y < 1 || y >= WORLD_H) return;
    const i = blockIndex(lx, y, lz);
    if (force || data[i] === AIR) data[i] = id;
  };
  for (let wz = baseZ - 2; wz < baseZ + CHUNK + 2; wz++) {
    for (let wx = baseX - 2; wx < baseX + CHUNK + 2; wx++) {
      const tree = treeAt(wx, wz);
      if (!tree) continue;
      const top = tree.ground + tree.trunk;
      for (let y = tree.ground + 1; y <= top; y++) place(wx, y, wz, B.LOG, true);
      if (tree.type === 'spruce') {
        const radii = [0, 1, 2, 1, 2];
        for (let i = 0; i < radii.length; i++) {
          const y = top + 1 - i, r = radii[i];
          for (let dx = -r; dx <= r; dx++) {
            for (let dz = -r; dz <= r; dz++) {
              if (dx === 0 && dz === 0 && y <= top) continue;
              if (r === 2 && Math.abs(dx) === 2 && Math.abs(dz) === 2) continue;
              place(wx + dx, y, wz + dz, B.LEAVES, false);
            }
          }
        }
      } else {
        for (let y = top - 2; y <= top + 1; y++) {
          const r = y > top ? 1 : 2;
          for (let dx = -r; dx <= r; dx++) {
            for (let dz = -r; dz <= r; dz++) {
              if (dx === 0 && dz === 0 && y <= top) continue;
              if (Math.abs(dx) === r && Math.abs(dz) === r && hash2(wx + dx + y, wz + dz - y) < 0.5) continue;
              place(wx + dx, y, wz + dz, B.LEAVES, false);
            }
          }
        }
      }
    }
  }

  // Surface decorations (single-column, so no cross-chunk margin needed)
  for (let lz = 0; lz < CHUNK; lz++) {
    for (let lx = 0; lx < CHUNK; lx++) {
      const wx = baseX + lx, wz = baseZ + lz;
      const h = heightAt(wx, wz);
      if (h + 1 >= WORLD_H) continue;
      if (data[blockIndex(lx, h + 1, lz)] !== AIR) continue;
      const ground = data[blockIndex(lx, h, lz)];
      const biome = biomeAt(wx, wz);

      if (ground === B.GRASS) {
        const r1 = hash2(wx * 3 + 11, wz * 3 - 7);
        const r2 = hash2(wx - 99, wz + 77);
        const tallP = biome === 'plains' ? 0.1 : 0.05;
        if (r2 < 0.012) data[blockIndex(lx, h + 1, lz)] = B.ROSE;
        else if (r2 < 0.024) data[blockIndex(lx, h + 1, lz)] = B.DANDELION;
        else if (r1 < tallP) data[blockIndex(lx, h + 1, lz)] = B.TALLGRASS;
      } else if (ground === B.SAND && biome === 'desert' && h > SEA + 2) {
        if (hash2(wx * 7 - 3, wz * 11 + 9) < 0.006) {
          const ch = 1 + Math.floor(hash2(wx + 5, wz + 5) * 3);
          for (let y = h + 1; y <= Math.min(h + ch, WORLD_H - 1); y++) {
            data[blockIndex(lx, y, lz)] = B.CACTUS;
          }
        }
      }
    }
  }

  // Apply saved player edits
  const saved = edits[chunkKey(cx, cz)];
  if (saved) {
    for (const i in saved) data[i] = saved[i];
  }
  return data;
}

// ---------------------------------------------------------------------------
// Chunk storage + saved edits
// ---------------------------------------------------------------------------
export const chunks = new Map(); // "cx,cz" -> { data, mesh, waterMesh, dirty, cx, cz }

const SAVE_KEY = 'mineclone-edits-v2-' + SEED;
let edits = {};
try { edits = JSON.parse(localStorage.getItem(SAVE_KEY)) || {}; } catch (e) { edits = {}; }

// When joining someone else's world online we keep their edits in memory but
// never write them over the local solo save.
let persist = true;
export function setPersist(on) {
  persist = on;
  if (!on) clearTimeout(saveTimer);
}
export const getAllEdits = () => edits;
export function setEdits(remote) { edits = remote || {}; }

let saveTimer = null;
function scheduleSave() {
  if (!persist) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushEdits, 800);
}
export function flushEdits() {
  if (!persist) return;
  clearTimeout(saveTimer);
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(edits)); } catch (e) { /* storage full/blocked */ }
}
export function clearSavedWorld() {
  edits = {};
  try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* ignore */ }
}

let memoCx = null, memoCz = null, memoChunk = null;
export function clearChunkMemo() { memoChunk = null; }

export function getChunk(cx, cz) {
  const key = chunkKey(cx, cz);
  let c = chunks.get(key);
  if (!c) {
    c = { data: genChunkData(cx, cz), mesh: null, waterMesh: null, dirty: true, cx, cz };
    chunks.set(key, c);
  }
  return c;
}

export function getBlock(wx, wy, wz) {
  if (wy < 0 || wy >= WORLD_H) return AIR;
  const cx = Math.floor(wx / CHUNK), cz = Math.floor(wz / CHUNK);
  let c;
  if (memoChunk && memoCx === cx && memoCz === cz) c = memoChunk;
  else { c = getChunk(cx, cz); memoChunk = c; memoCx = cx; memoCz = cz; }
  return c.data[blockIndex(wx - cx * CHUNK, wy, wz - cz * CHUNK)];
}

export function markDirty(cx, cz) {
  const c = chunks.get(chunkKey(cx, cz));
  if (c) c.dirty = true;
}

export function setBlock(wx, wy, wz, id) {
  if (wy < 0 || wy >= WORLD_H) return;
  const cx = Math.floor(wx / CHUNK), cz = Math.floor(wz / CHUNK);
  const c = getChunk(cx, cz);
  const lx = wx - cx * CHUNK, lz = wz - cz * CHUNK;
  c.data[blockIndex(lx, wy, lz)] = id;
  c.dirty = true;

  const key = chunkKey(cx, cz);
  if (!edits[key]) edits[key] = {};
  edits[key][blockIndex(lx, wy, lz)] = id;
  scheduleSave();

  // Border edits affect neighbour meshes too (incl. diagonals, via AO)
  if (lx === 0) markDirty(cx - 1, cz);
  if (lx === CHUNK - 1) markDirty(cx + 1, cz);
  if (lz === 0) markDirty(cx, cz - 1);
  if (lz === CHUNK - 1) markDirty(cx, cz + 1);
  if (lx === 0 && lz === 0) markDirty(cx - 1, cz - 1);
  if (lx === 0 && lz === CHUNK - 1) markDirty(cx - 1, cz + 1);
  if (lx === CHUNK - 1 && lz === 0) markDirty(cx + 1, cz - 1);
  if (lx === CHUNK - 1 && lz === CHUNK - 1) markDirty(cx + 1, cz + 1);
}

export const isSolid = id => id !== AIR && BLOCKS[id].solid;

// ---------------------------------------------------------------------------
// Voxel raycast (DDA). Returns the first non-air, non-water block hit.
// ---------------------------------------------------------------------------
export function raycast(origin, dir, maxDist) {
  let x = Math.floor(origin.x), y = Math.floor(origin.y), z = Math.floor(origin.z);
  const stepX = Math.sign(dir.x), stepY = Math.sign(dir.y), stepZ = Math.sign(dir.z);
  const tDeltaX = stepX !== 0 ? Math.abs(1 / dir.x) : Infinity;
  const tDeltaY = stepY !== 0 ? Math.abs(1 / dir.y) : Infinity;
  const tDeltaZ = stepZ !== 0 ? Math.abs(1 / dir.z) : Infinity;
  let tMaxX = stepX !== 0 ? (stepX > 0 ? (x + 1 - origin.x) : (origin.x - x)) * tDeltaX : Infinity;
  let tMaxY = stepY !== 0 ? (stepY > 0 ? (y + 1 - origin.y) : (origin.y - y)) * tDeltaY : Infinity;
  let tMaxZ = stepZ !== 0 ? (stepZ > 0 ? (z + 1 - origin.z) : (origin.z - z)) * tDeltaZ : Infinity;
  let face = [0, 0, 0];
  let t = 0;

  while (t <= maxDist) {
    const id = getBlock(x, y, z);
    if (id !== AIR && id !== B.WATER) {
      return { x, y, z, face, id };
    }
    if (tMaxX < tMaxY && tMaxX < tMaxZ) {
      x += stepX; t = tMaxX; tMaxX += tDeltaX; face = [-stepX, 0, 0];
    } else if (tMaxY < tMaxZ) {
      y += stepY; t = tMaxY; tMaxY += tDeltaY; face = [0, -stepY, 0];
    } else {
      z += stepZ; t = tMaxZ; tMaxZ += tDeltaZ; face = [0, 0, -stepZ];
    }
  }
  return null;
}
