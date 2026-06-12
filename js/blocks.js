import * as THREE from 'three';
import { SEED, TILE } from './config.js';
import { mulberry32 } from './noise.js';

// Tile indices in the atlas strip
export const T = {
  GRASS_TOP: 0, GRASS_SIDE: 1, DIRT: 2, STONE: 3, SAND: 4,
  LOG_SIDE: 5, LOG_TOP: 6, LEAVES: 7, PLANK: 8, COBBLE: 9,
  WATER: 10, GLASS: 11, SNOW: 12, SNOW_SIDE: 13, CACTUS_SIDE: 14,
  CACTUS_TOP: 15, FLOWER_RED: 16, FLOWER_YELLOW: 17, TALLGRASS: 18,
  COAL: 19, IRON: 20, GOLD: 21, DIAMOND: 22, BEDROCK: 23, BRICK: 24,
};
export const NUM_TILES = 25;

export const AIR = 0;
// tiles: [top, bottom, side]. IDs are stable — saved worlds depend on them.
export const BLOCKS = [
  null,
  { name: 'Grass',       tiles: [T.GRASS_TOP, T.DIRT, T.GRASS_SIDE], solid: true,  transparent: false },
  { name: 'Dirt',        tiles: [T.DIRT, T.DIRT, T.DIRT],            solid: true,  transparent: false },
  { name: 'Stone',       tiles: [T.STONE, T.STONE, T.STONE],         solid: true,  transparent: false },
  { name: 'Sand',        tiles: [T.SAND, T.SAND, T.SAND],            solid: true,  transparent: false },
  { name: 'Log',         tiles: [T.LOG_TOP, T.LOG_TOP, T.LOG_SIDE],  solid: true,  transparent: false },
  { name: 'Leaves',      tiles: [T.LEAVES, T.LEAVES, T.LEAVES],      solid: true,  transparent: false },
  { name: 'Planks',      tiles: [T.PLANK, T.PLANK, T.PLANK],         solid: true,  transparent: false },
  { name: 'Cobblestone', tiles: [T.COBBLE, T.COBBLE, T.COBBLE],      solid: true,  transparent: false },
  { name: 'Glass',       tiles: [T.GLASS, T.GLASS, T.GLASS],         solid: true,  transparent: true  },
  { name: 'Water',       tiles: [T.WATER, T.WATER, T.WATER],         solid: false, transparent: true  },
  { name: 'Snowy Grass', tiles: [T.SNOW, T.DIRT, T.SNOW_SIDE],       solid: true,  transparent: false },
  { name: 'Snow',        tiles: [T.SNOW, T.SNOW, T.SNOW],            solid: true,  transparent: false },
  { name: 'Cactus',      tiles: [T.CACTUS_TOP, T.CACTUS_TOP, T.CACTUS_SIDE], solid: true, transparent: false },
  { name: 'Rose',        tiles: [T.FLOWER_RED, T.FLOWER_RED, T.FLOWER_RED],          solid: false, transparent: true, cross: true },
  { name: 'Dandelion',   tiles: [T.FLOWER_YELLOW, T.FLOWER_YELLOW, T.FLOWER_YELLOW], solid: false, transparent: true, cross: true },
  { name: 'Tall Grass',  tiles: [T.TALLGRASS, T.TALLGRASS, T.TALLGRASS],             solid: false, transparent: true, cross: true },
  { name: 'Coal Ore',    tiles: [T.COAL, T.COAL, T.COAL],            solid: true,  transparent: false },
  { name: 'Iron Ore',    tiles: [T.IRON, T.IRON, T.IRON],            solid: true,  transparent: false },
  { name: 'Gold Ore',    tiles: [T.GOLD, T.GOLD, T.GOLD],            solid: true,  transparent: false },
  { name: 'Diamond Ore', tiles: [T.DIAMOND, T.DIAMOND, T.DIAMOND],   solid: true,  transparent: false },
  { name: 'Bedrock',     tiles: [T.BEDROCK, T.BEDROCK, T.BEDROCK],   solid: true,  transparent: false, unbreakable: true },
  { name: 'Bricks',      tiles: [T.BRICK, T.BRICK, T.BRICK],         solid: true,  transparent: false },
];

export const B = {
  GRASS: 1, DIRT: 2, STONE: 3, SAND: 4, LOG: 5, LEAVES: 6, PLANK: 7, COBBLE: 8,
  GLASS: 9, WATER: 10, SNOWGRASS: 11, SNOW: 12, CACTUS: 13, ROSE: 14,
  DANDELION: 15, TALLGRASS: 16, COAL: 17, IRON: 18, GOLD: 19, DIAMOND: 20,
  BEDROCK: 21, BRICK: 22,
};

export const PLACEABLE = [
  B.GRASS, B.DIRT, B.STONE, B.COBBLE, B.SAND, B.LOG, B.PLANK,
  B.LEAVES, B.GLASS, B.BRICK, B.SNOW, B.SNOWGRASS, B.CACTUS, B.COAL,
  B.IRON, B.GOLD, B.DIAMOND, B.WATER, B.ROSE, B.DANDELION, B.TALLGRASS,
];
export const DEFAULT_HOTBAR = [B.GRASS, B.DIRT, B.STONE, B.LOG, B.PLANK, B.COBBLE, B.GLASS, B.BRICK, B.SAND];

// ---------------------------------------------------------------------------
// Procedural texture atlas (one horizontal strip of 16x16 tiles)
// ---------------------------------------------------------------------------
export function buildAtlas() {
  const canvas = document.createElement('canvas');
  canvas.width = NUM_TILES * TILE;
  canvas.height = TILE;
  const ctx = canvas.getContext('2d');
  const rand = mulberry32(SEED ^ 0xA77A5);

  function speckle(tile, r, g, b, jitter) {
    const img = ctx.createImageData(TILE, TILE);
    for (let i = 0; i < TILE * TILE; i++) {
      const n = 1 + (rand() - 0.5) * jitter;
      img.data[i * 4]     = Math.min(255, r * n);
      img.data[i * 4 + 1] = Math.min(255, g * n);
      img.data[i * 4 + 2] = Math.min(255, b * n);
      img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, tile * TILE, 0);
  }
  // strip of another texture pasted on top of a tile (e.g. grass over dirt)
  function topStrip(tile, srcTile, rows) {
    ctx.drawImage(canvas, srcTile * TILE, 0, TILE, rows, tile * TILE, 0, TILE, rows);
  }

  speckle(T.GRASS_TOP, 106, 170, 64, 0.25);
  speckle(T.DIRT, 134, 96, 67, 0.3);
  speckle(T.STONE, 127, 127, 127, 0.22);
  speckle(T.SAND, 219, 207, 163, 0.15);
  speckle(T.LEAVES, 54, 116, 38, 0.5);
  speckle(T.COBBLE, 110, 110, 112, 0.5);
  speckle(T.SNOW, 238, 242, 248, 0.06);

  speckle(T.GRASS_SIDE, 134, 96, 67, 0.3);
  topStrip(T.GRASS_SIDE, T.GRASS_TOP, 4);
  speckle(T.SNOW_SIDE, 134, 96, 67, 0.3);
  topStrip(T.SNOW_SIDE, T.SNOW, 4);

  // Log side: vertical bark stripes
  speckle(T.LOG_SIDE, 103, 82, 49, 0.2);
  ctx.fillStyle = 'rgba(60,45,25,0.55)';
  for (let x = 0; x < TILE; x += 4) {
    ctx.fillRect(T.LOG_SIDE * TILE + x + Math.floor(rand() * 2), 0, 1, TILE);
  }

  // Log top: rings
  speckle(T.LOG_TOP, 168, 136, 88, 0.15);
  ctx.strokeStyle = 'rgba(90,65,35,0.8)';
  for (let r = 2; r <= 7; r += 2) {
    ctx.beginPath();
    ctx.arc(T.LOG_TOP * TILE + 8, 8, r, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Planks: horizontal boards
  speckle(T.PLANK, 178, 142, 88, 0.12);
  ctx.fillStyle = 'rgba(95,70,40,0.7)';
  for (let y = 3; y < TILE; y += 4) ctx.fillRect(T.PLANK * TILE, y, TILE, 1);

  // Cobble: darker mortar cracks
  ctx.strokeStyle = 'rgba(60,60,62,0.9)';
  for (let i = 0; i < 5; i++) {
    ctx.beginPath();
    ctx.moveTo(T.COBBLE * TILE + rand() * TILE, rand() * TILE);
    ctx.lineTo(T.COBBLE * TILE + rand() * TILE, rand() * TILE);
    ctx.stroke();
  }

  // Water tile (used for icons; the world water uses its own animated texture)
  speckle(T.WATER, 50, 90, 200, 0.12);
  ctx.fillStyle = 'rgba(120,160,255,0.35)';
  for (let y = 2; y < TILE; y += 5) ctx.fillRect(T.WATER * TILE, y, TILE, 1);

  // Glass: transparent interior (cut out by alphaTest), bright frame + shine
  ctx.clearRect(T.GLASS * TILE, 0, TILE, TILE);
  ctx.fillStyle = 'rgba(223,239,252,0.95)';
  ctx.fillRect(T.GLASS * TILE, 0, TILE, 1);
  ctx.fillRect(T.GLASS * TILE, TILE - 1, TILE, 1);
  ctx.fillRect(T.GLASS * TILE, 0, 1, TILE);
  ctx.fillRect(T.GLASS * TILE + TILE - 1, 0, 1, TILE);
  ctx.fillRect(T.GLASS * TILE + 3, 3, 1, 6);
  ctx.fillRect(T.GLASS * TILE + 4, 2, 1, 4);
  ctx.fillRect(T.GLASS * TILE + 11, 9, 1, 4);

  // Cactus
  speckle(T.CACTUS_SIDE, 58, 124, 56, 0.18);
  ctx.fillStyle = 'rgba(20,60,20,0.5)';
  for (let x = 2; x < TILE; x += 4) ctx.fillRect(T.CACTUS_SIDE * TILE + x, 0, 1, TILE);
  ctx.fillStyle = '#e8f5e0';
  for (let i = 0; i < 6; i++) {
    ctx.fillRect(T.CACTUS_SIDE * TILE + Math.floor(rand() * TILE), Math.floor(rand() * TILE), 1, 1);
  }
  speckle(T.CACTUS_TOP, 96, 156, 84, 0.15);
  ctx.strokeStyle = 'rgba(30,80,30,0.8)';
  ctx.strokeRect(T.CACTUS_TOP * TILE + 1.5, 1.5, TILE - 3, TILE - 3);

  // Flowers / tall grass: transparent background sprites
  function flower(tile, petal, center) {
    ctx.clearRect(tile * TILE, 0, TILE, TILE);
    ctx.fillStyle = '#3e7d22';
    ctx.fillRect(tile * TILE + 7, 8, 2, 8);   // stem
    ctx.fillRect(tile * TILE + 5, 11, 2, 2);  // leaf
    ctx.fillStyle = petal;
    ctx.fillRect(tile * TILE + 5, 3, 6, 5);
    ctx.fillRect(tile * TILE + 6, 2, 4, 7);
    ctx.fillStyle = center;
    ctx.fillRect(tile * TILE + 7, 4, 2, 2);
  }
  flower(T.FLOWER_RED, '#c33028', '#f2d245');
  flower(T.FLOWER_YELLOW, '#f2d245', '#caa820');

  ctx.clearRect(T.TALLGRASS * TILE, 0, TILE, TILE);
  for (let i = 0; i < 10; i++) {
    ctx.fillStyle = i % 2 ? '#4f9434' : '#3d7a26';
    const x = 1 + Math.floor(rand() * (TILE - 2));
    const h = 5 + Math.floor(rand() * 9);
    ctx.fillRect(T.TALLGRASS * TILE + x, TILE - h, 1, h);
  }

  // Ores: stone base + colored chunks
  function ore(tile, color) {
    speckle(tile, 127, 127, 127, 0.22);
    ctx.fillStyle = color;
    for (let i = 0; i < 5; i++) {
      const x = 2 + Math.floor(rand() * 11), y = 2 + Math.floor(rand() * 11);
      ctx.fillRect(tile * TILE + x, y, 2, 2);
    }
  }
  ore(T.COAL, '#2f2f33');
  ore(T.IRON, '#d8af93');
  ore(T.GOLD, '#fcee4b');
  ore(T.DIAMOND, '#4aedd9');

  speckle(T.BEDROCK, 62, 62, 66, 0.65);

  // Bricks: red base + mortar grid with offset rows
  speckle(T.BRICK, 150, 72, 56, 0.18);
  ctx.fillStyle = '#cfc6bd';
  for (let row = 0; row < 4; row++) {
    const y0 = row * 4;
    ctx.fillRect(T.BRICK * TILE, y0 + 3, TILE, 1);
    const off = row % 2 ? 2 : 6;
    for (let x = off; x < TILE; x += 8) ctx.fillRect(T.BRICK * TILE + x, y0, 1, 3);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.colorSpace = THREE.SRGBColorSpace;
  return { texture, canvas };
}

// Standalone 16x16 repeating water texture so it can scroll independently
export function buildWaterTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = TILE;
  const ctx = canvas.getContext('2d');
  const rand = mulberry32(SEED ^ 0x77A7E2);
  const img = ctx.createImageData(TILE, TILE);
  for (let i = 0; i < TILE * TILE; i++) {
    const n = 1 + (rand() - 0.5) * 0.14;
    img.data[i * 4] = 46 * n; img.data[i * 4 + 1] = 88 * n;
    img.data[i * 4 + 2] = 198 * n; img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  ctx.fillStyle = 'rgba(130,170,255,0.4)';
  for (let y = 1; y < TILE; y += 5) ctx.fillRect(0, y, TILE, 1);

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// Average color of each tile (for break particles)
export function computeTileColors(atlasCanvas) {
  const ctx = atlasCanvas.getContext('2d');
  const img = ctx.getImageData(0, 0, atlasCanvas.width, atlasCanvas.height);
  const colors = [];
  for (let t = 0; t < NUM_TILES; t++) {
    let r = 0, g = 0, b = 0, n = 0;
    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        const i = (y * atlasCanvas.width + t * TILE + x) * 4;
        if (img.data[i + 3] < 120) continue;
        r += img.data[i]; g += img.data[i + 1]; b += img.data[i + 2]; n++;
      }
    }
    n = Math.max(1, n);
    colors.push([r / n / 255, g / n / 255, b / n / 255]);
  }
  return colors;
}

// Fake-isometric block icon for the hotbar/inventory (48x48 canvas)
export function drawBlockIcon(ctx, atlasCanvas, blockId) {
  const block = BLOCKS[blockId];
  ctx.imageSmoothingEnabled = false;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, 48, 48);

  if (block.cross) {
    ctx.drawImage(atlasCanvas, block.tiles[0] * TILE, 0, TILE, TILE, 4, 4, 40, 40);
    return;
  }
  const face = (transform, tile, shade) => {
    ctx.setTransform(...transform);
    ctx.drawImage(atlasCanvas, tile * TILE, 0, TILE, TILE, 0, 0, TILE, TILE);
    if (shade > 0) {
      ctx.fillStyle = `rgba(0,0,0,${shade})`;
      ctx.fillRect(0, 0, TILE, TILE);
    }
  };
  face([1.375, 0.6875, 0, 1.375, 2, 12], block.tiles[2], 0.25);    // left
  face([1.375, -0.6875, 0, 1.375, 24, 23], block.tiles[2], 0.4);   // right
  face([1.375, -0.6875, 1.375, 0.6875, 2, 12], block.tiles[0], 0); // top
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}
