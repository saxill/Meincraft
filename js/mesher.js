import * as THREE from 'three';
import { CHUNK, WORLD_H } from './config.js';
import { AIR, B, BLOCKS, NUM_TILES } from './blocks.js';
import { getBlock, blockIndex } from './world.js';

const FACES = [
  { dir: [-1, 0, 0], shade: 0.62, corners: [
    { pos: [0, 1, 0], uv: [0, 1] }, { pos: [0, 0, 0], uv: [0, 0] },
    { pos: [0, 1, 1], uv: [1, 1] }, { pos: [0, 0, 1], uv: [1, 0] }] },
  { dir: [1, 0, 0], shade: 0.62, corners: [
    { pos: [1, 1, 1], uv: [0, 1] }, { pos: [1, 0, 1], uv: [0, 0] },
    { pos: [1, 1, 0], uv: [1, 1] }, { pos: [1, 0, 0], uv: [1, 0] }] },
  { dir: [0, -1, 0], shade: 0.45, corners: [
    { pos: [1, 0, 1], uv: [1, 0] }, { pos: [0, 0, 1], uv: [0, 0] },
    { pos: [1, 0, 0], uv: [1, 1] }, { pos: [0, 0, 0], uv: [0, 1] }] },
  { dir: [0, 1, 0], shade: 1.0, corners: [
    { pos: [0, 1, 1], uv: [1, 1] }, { pos: [1, 1, 1], uv: [0, 1] },
    { pos: [0, 1, 0], uv: [1, 0] }, { pos: [1, 1, 0], uv: [0, 0] }] },
  { dir: [0, 0, -1], shade: 0.8, corners: [
    { pos: [1, 0, 0], uv: [0, 0] }, { pos: [0, 0, 0], uv: [1, 0] },
    { pos: [1, 1, 0], uv: [0, 1] }, { pos: [0, 1, 0], uv: [1, 1] }] },
  { dir: [0, 0, 1], shade: 0.8, corners: [
    { pos: [0, 0, 1], uv: [0, 0] }, { pos: [1, 0, 1], uv: [1, 0] },
    { pos: [0, 1, 1], uv: [0, 1] }, { pos: [1, 1, 1], uv: [1, 1] }] },
];
// Per-face tangent axes for AO sampling (face axis a; tangents u, v)
const FACE_AXIS = FACES.map(f => {
  const a = f.dir.findIndex(d => d !== 0);
  return { a, u: (a + 1) % 3, v: (a + 2) % 3 };
});

const AO_CURVE = [0.42, 0.62, 0.82, 1.0];
const WATER_TOP = 0.875;
const EPS = 0.02 / NUM_TILES;

// tiles: [top, bottom, side]; FACES index 3 is top, 2 is bottom
function tileForFace(block, faceIndex) {
  if (faceIndex === 3) return block.tiles[0];
  if (faceIndex === 2) return block.tiles[1];
  return block.tiles[2];
}

function faceVisible(id, neighborId) {
  if (neighborId === AIR) return true;
  const nb = BLOCKS[neighborId];
  if (!nb.transparent) return false;
  return neighborId !== id; // hide internal faces between same transparent type
}

const occludes = id => id !== AIR && !BLOCKS[id].transparent;

// Two crossed quads, each pushed with both windings so they render two-sided
const CROSS_QUADS = [
  [[0, 0, 0], [1, 0, 1], [0, 1, 0], [1, 1, 1]],
  [[1, 0, 1], [0, 0, 0], [1, 1, 1], [0, 1, 0]],
  [[1, 0, 0], [0, 0, 1], [1, 1, 0], [0, 1, 1]],
  [[0, 0, 1], [1, 0, 0], [0, 1, 1], [1, 1, 0]],
];
const CROSS_UV = [[0, 0], [1, 0], [0, 1], [1, 1]];

function pushCross(buf, lx, y, lz, tile) {
  const u0 = tile / NUM_TILES + EPS, u1 = (tile + 1) / NUM_TILES - EPS;
  for (const quad of CROSS_QUADS) {
    const start = buf.pos.length / 3;
    for (let i = 0; i < 4; i++) {
      buf.pos.push(lx + quad[i][0], y + quad[i][1], lz + quad[i][2]);
      buf.uv.push(CROSS_UV[i][0] ? u1 : u0, CROSS_UV[i][1] ? 0.98 : 0.02);
      buf.col.push(0.9, 0.9, 0.9);
    }
    buf.idx.push(start, start + 1, start + 2, start + 2, start + 1, start + 3);
  }
}

export function disposeChunkMesh(c, scene) {
  if (c.mesh) { scene.remove(c.mesh); c.mesh.geometry.dispose(); c.mesh = null; }
  if (c.waterMesh) { scene.remove(c.waterMesh); c.waterMesh.geometry.dispose(); c.waterMesh = null; }
}

export function buildChunkMesh(c, scene, materials) {
  disposeChunkMesh(c, scene);

  const opaque = { pos: [], uv: [], col: [], idx: [] };
  const water = { pos: [], uv: [], col: [], idx: [] };
  const baseX = c.cx * CHUNK, baseZ = c.cz * CHUNK;

  // Fast block sampler: chunk-local when possible, world lookup at borders
  const sample = (wx, wy, wz) => {
    if (wy < 0) return B.STONE; // never draw / never light the world's underside
    if (wy >= WORLD_H) return AIR;
    const lx = wx - baseX, lz = wz - baseZ;
    if (lx >= 0 && lx < CHUNK && lz >= 0 && lz < CHUNK) {
      return c.data[blockIndex(lx, wy, lz)];
    }
    return getBlock(wx, wy, wz);
  };

  const q = [0, 0, 0]; // scratch for AO neighbor coords

  for (let y = 0; y < WORLD_H; y++) {
    for (let lz = 0; lz < CHUNK; lz++) {
      for (let lx = 0; lx < CHUNK; lx++) {
        const id = c.data[blockIndex(lx, y, lz)];
        if (id === AIR) continue;
        const block = BLOCKS[id];
        const wx = baseX + lx, wz = baseZ + lz;

        if (block.cross) {
          pushCross(opaque, lx, y, lz, block.tiles[0]);
          continue;
        }

        const isWater = id === B.WATER;
        const target = isWater ? water : opaque;
        const topOpen = isWater && sample(wx, y + 1, wz) !== B.WATER;

        for (let f = 0; f < 6; f++) {
          const face = FACES[f];
          const neighbor = sample(wx + face.dir[0], y + face.dir[1], wz + face.dir[2]);
          if (!faceVisible(id, neighbor)) continue;

          const start = target.pos.length / 3;
          const ao = [3, 3, 3, 3];

          if (!isWater) {
            const ax = FACE_AXIS[f];
            const base = [wx + face.dir[0], y + face.dir[1], wz + face.dir[2]];
            for (let ci = 0; ci < 4; ci++) {
              const corner = face.corners[ci];
              const su = corner.pos[ax.u] ? 1 : -1;
              const sv = corner.pos[ax.v] ? 1 : -1;
              q[0] = base[0]; q[1] = base[1]; q[2] = base[2];
              q[ax.u] += su;
              const s1 = occludes(sample(q[0], q[1], q[2]));
              q[ax.u] -= su; q[ax.v] += sv;
              const s2 = occludes(sample(q[0], q[1], q[2]));
              q[ax.u] += su;
              const sc = occludes(sample(q[0], q[1], q[2]));
              ao[ci] = (s1 && s2) ? 0 : 3 - (s1 + s2 + sc);
            }
          }

          const tile = tileForFace(block, f);
          const u0 = tile / NUM_TILES + EPS, u1 = (tile + 1) / NUM_TILES - EPS;
          for (let ci = 0; ci < 4; ci++) {
            const corner = face.corners[ci];
            let cy = corner.pos[1];
            if (topOpen && cy === 1) cy = WATER_TOP;
            target.pos.push(lx + corner.pos[0], y + cy, lz + corner.pos[2]);
            if (isWater) {
              target.uv.push(corner.uv[0], corner.uv[1]);
            } else {
              target.uv.push(corner.uv[0] ? u1 : u0, corner.uv[1] ? 0.98 : 0.02);
            }
            const b = face.shade * AO_CURVE[ao[ci]];
            target.col.push(b, b, b);
          }
          // Flip the quad diagonal when AO is anisotropic, to avoid dark crosses
          if (ao[0] + ao[3] > ao[1] + ao[2]) {
            target.idx.push(start, start + 1, start + 3, start, start + 3, start + 2);
          } else {
            target.idx.push(start, start + 1, start + 2, start + 2, start + 1, start + 3);
          }
        }
      }
    }
  }

  function makeMesh(buf, material) {
    if (buf.idx.length === 0) return null;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(buf.pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(buf.uv, 2));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(buf.col, 3));
    geo.setIndex(buf.idx);
    const mesh = new THREE.Mesh(geo, material);
    mesh.position.set(baseX, 0, baseZ);
    scene.add(mesh);
    return mesh;
  }

  c.mesh = makeMesh(opaque, materials.opaque);
  c.waterMesh = makeMesh(water, materials.water);
  c.dirty = false;
}

// ---------------------------------------------------------------------------
// Small standalone geometry for the held block (centered on origin)
// ---------------------------------------------------------------------------
export function makeBlockGeometry(id) {
  const block = BLOCKS[id];

  if (block.cross) {
    const buf = { pos: [], uv: [], col: [], idx: [] };
    pushCross(buf, -0.5, -0.5, -0.5, block.tiles[0]);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(buf.pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(buf.uv, 2));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(buf.col, 3));
    geo.setIndex(buf.idx);
    return geo;
  }

  const geo = new THREE.BoxGeometry(1, 1, 1);
  // BoxGeometry face order: +x, -x, +y(top), -y(bottom), +z, -z
  const faceTiles = [block.tiles[2], block.tiles[2], block.tiles[0], block.tiles[1], block.tiles[2], block.tiles[2]];
  const faceShades = [0.62, 0.62, 1.0, 0.45, 0.8, 0.8];
  const uv = geo.getAttribute('uv');
  const colors = new Float32Array(uv.count * 3);
  for (let face = 0; face < 6; face++) {
    const tile = faceTiles[face];
    for (let v = 0; v < 4; v++) {
      const i = face * 4 + v;
      uv.setXY(i,
        (tile + 0.02 + uv.getX(i) * 0.96) / NUM_TILES,
        0.02 + uv.getY(i) * 0.96
      );
      colors[i * 3] = colors[i * 3 + 1] = colors[i * 3 + 2] = faceShades[face];
    }
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geo;
}
