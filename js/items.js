import { B, BLOCKS } from './blocks.js';

// Tools live in the hotbar next to blocks. IDs start at 100 so they can never
// collide with block IDs (which must stay stable for saved worlds).
export const TOOL_BASE = 100;
export const isTool = id => id >= TOOL_BASE;

export const PICKAXE = 100;
export const AXE = 101;
export const SHOVEL = 102;
export const SWORD = 103;
export const TOOL_IDS = [PICKAXE, AXE, SHOVEL, SWORD];

export const TOOLS = {
  [PICKAXE]: { name: 'Pickaxe', head: '#b8c4d2' },
  [AXE]:     { name: 'Axe',     head: '#b8c4d2' },
  [SHOVEL]:  { name: 'Shovel',  head: '#b8c4d2' },
  [SWORD]:   { name: 'Sword',   head: '#dde6f2' },
};

// What each tool is good against
const EFFECTIVE = {
  [PICKAXE]: new Set([B.STONE, B.COBBLE, B.BRICK, B.COAL, B.IRON, B.GOLD, B.DIAMOND, B.GLASS]),
  [AXE]:     new Set([B.LOG, B.PLANK]),
  [SHOVEL]:  new Set([B.GRASS, B.DIRT, B.SAND, B.SNOW, B.SNOWGRASS]),
  [SWORD]:   new Set([B.LEAVES, B.CACTUS]),
};

// Seconds to break by hand. Cross plants are instant; bedrock is unbreakable.
const HARDNESS = {
  [B.GRASS]: 0.9, [B.DIRT]: 0.75, [B.STONE]: 2.4, [B.SAND]: 0.7,
  [B.LOG]: 1.6, [B.LEAVES]: 0.35, [B.PLANK]: 1.6, [B.COBBLE]: 2.6,
  [B.GLASS]: 0.45, [B.SNOWGRASS]: 0.9, [B.SNOW]: 0.4, [B.CACTUS]: 0.5,
  [B.COAL]: 3.2, [B.IRON]: 3.4, [B.GOLD]: 3.4, [B.DIAMOND]: 3.8,
  [B.BRICK]: 2.4,
};

// Seconds to break `blockId` while holding `heldId` (block, tool, or nothing)
export function miningTime(blockId, heldId) {
  const block = BLOCKS[blockId];
  if (!block || block.unbreakable) return Infinity;
  if (block.cross) return 0;
  let t = HARDNESS[blockId] !== undefined ? HARDNESS[blockId] : 1;
  const eff = EFFECTIVE[heldId];
  if (eff && eff.has(blockId)) t *= 0.27;
  return t;
}

// ---------------------------------------------------------------------------
// Pixel-art tool icons (12x12 maps drawn onto a 48x48 canvas)
// h = handle, b = head/blade, g = guard
// ---------------------------------------------------------------------------
const ART = {
  [PICKAXE]: [
    '...bbbbbb...',
    '..bb....bb..',
    '.b........b.',
    '.b...hk...b.',
    '.....hk.....',
    '.....hk.....',
    '....hk......',
    '....hk......',
    '...hk.......',
    '...hk.......',
    '..hk........',
    '..hk........',
  ],
  [AXE]: [
    '...bbb......',
    '..bbbbb.....',
    '.bbbbbbk....',
    '.bbbbbhk....',
    '.bbbbhk.....',
    '..bbhk......',
    '...hk.......',
    '...hk.......',
    '..hk........',
    '..hk........',
    '.hk.........',
    '.hk.........',
  ],
  [SHOVEL]: [
    '....bbbb....',
    '...bbbbbb...',
    '...bbbbbb...',
    '...bbbbbb...',
    '....bllb....',
    '.....bb.....',
    '.....hk.....',
    '.....hk.....',
    '.....hk.....',
    '.....hk.....',
    '.....hk.....',
    '.....hk.....',
  ],
  [SWORD]: [
    '..........b.',
    '.........bbl',
    '........bbl.',
    '.......bbl..',
    '......bbl...',
    '.....bbl....',
    '....bbl.....',
    '..g.bb.g....',
    '...gbbg.....',
    '....hk......',
    '...hk.......',
    '...hk.......',
  ],
};

export function drawToolIcon(ctx, toolId) {
  const art = ART[toolId];
  const colors = {
    h: '#7a5230',            // handle wood
    k: '#5c3d23',            // handle shadow (far edge)
    b: TOOLS[toolId].head,   // metal head / blade
    l: '#eef3fa',            // metal highlight
    g: '#caa64b',            // gold guard
  };
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, 48, 48);
  ctx.imageSmoothingEnabled = false;
  for (let y = 0; y < 12; y++) {
    for (let x = 0; x < 12; x++) {
      const ch = art[y][x];
      if (ch === '.') continue;
      ctx.fillStyle = colors[ch];
      ctx.fillRect(x * 4, y * 4, 4, 4);
    }
  }
}

export const itemName = id => (isTool(id) ? TOOLS[id].name : BLOCKS[id].name);
