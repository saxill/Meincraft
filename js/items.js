import { B, BLOCKS } from './blocks.js';

// Tools live in the hotbar next to blocks. IDs are partitioned so they can
// never collide with block IDs (which must stay stable for saved worlds):
//   1..99   blocks      100..199 tools      200+ crafting materials/items
export const TOOL_BASE = 100;
export const ITEM_BASE = 200;
export const isTool = id => id >= TOOL_BASE && id < ITEM_BASE;
export const isMaterial = id => id >= ITEM_BASE;

export const PICKAXE = 100;
export const AXE = 101;
export const SHOVEL = 102;
export const SWORD = 103;
export const TOOL_IDS = [PICKAXE, AXE, SHOVEL, SWORD];

// Non-placeable crafting materials + mob loot / food
export const STICK = 200;
export const PORK = 201;   // raw porkchop (pig drop)
export const ROTTEN = 202; // rotten flesh (zombie drop)
export const MATERIALS = {
  [STICK]:  { name: 'Stick' },
  [PORK]:   { name: 'Raw Porkchop' },
  [ROTTEN]: { name: 'Rotten Flesh' },
};

// Edible items: id -> HP restored when eaten (right-click). No hunger system,
// so food simply heals.
const FOOD = { [PORK]: 5, [ROTTEN]: 2 };
export const isFood = id => id in FOOD;
export const foodHeal = id => FOOD[id] || 0;

// What a mob drops when killed in survival. null = nothing.
export function mobDrop(type) {
  if (type === 'pig')    return { id: PORK, count: 1 + Math.floor(Math.random() * 2) }; // 1–2
  if (type === 'zombie') return { id: ROTTEN, count: 1 };
  return null;
}

export const TOOLS = {
  [PICKAXE]: { name: 'Pickaxe', head: '#b8c4d2' },
  [AXE]:     { name: 'Axe',     head: '#b8c4d2' },
  [SHOVEL]:  { name: 'Shovel',  head: '#b8c4d2' },
  [SWORD]:   { name: 'Sword',   head: '#dde6f2' },
};

// Total uses before a tool snaps (wooden tier). Read by the inventory model.
const DURABILITY = {
  [PICKAXE]: 132, [AXE]: 132, [SHOVEL]: 132, [SWORD]: 120,
};
export const toolDurability = id => DURABILITY[id] || 1;

// Melee damage in half-hearts (mob/player health is on a 20-point scale).
const DAMAGE = { [SWORD]: 7, [AXE]: 5, [PICKAXE]: 3, [SHOVEL]: 3 };
export const attackDamage = heldId => DAMAGE[heldId] || 2; // bare fist = 2

// What a broken block yields. null = nothing (e.g. leaves, bedrock).
export function blockDrop(blockId) {
  switch (blockId) {
    case B.GRASS:     return { id: B.DIRT, count: 1 };
    case B.SNOWGRASS: return { id: B.DIRT, count: 1 };
    case B.STONE:     return { id: B.COBBLE, count: 1 };
    case B.LEAVES:    return null;
    case B.BEDROCK:   return null;
    case B.WATER:     return null;
    default:          return { id: blockId, count: 1 };
  }
}

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

// Hard blocks that really want a tool: mining these bare-handed is slow and
// miserable, which is what makes the matching tool feel sharp.
const NEEDS_TOOL = new Set([B.STONE, B.COBBLE, B.BRICK, B.COAL, B.IRON, B.GOLD, B.DIAMOND]);

// Seconds to break `blockId` while holding `heldId` (block, tool, or nothing)
export function miningTime(blockId, heldId) {
  const block = BLOCKS[blockId];
  if (!block || block.unbreakable) return Infinity;
  if (block.cross) return 0;
  let t = HARDNESS[blockId] !== undefined ? HARDNESS[blockId] : 1;
  const eff = EFFECTIVE[heldId];
  if (eff && eff.has(blockId)) t *= 0.16;        // right tool: crisp and fast
  else if (NEEDS_TOOL.has(blockId)) t *= 2.6;    // bare hands on rock/ore: a slog
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

export const itemName = id =>
  isTool(id) ? TOOLS[id].name :
  isMaterial(id) ? MATERIALS[id].name :
  BLOCKS[id].name;

// Pixel-art icons for crafting materials (same 12x12 → 48x48 scheme as tools)
const MATERIAL_ART = {
  [STICK]: [
    '..........h.',
    '.........hk.',
    '........hk..',
    '.......hk...',
    '......hk....',
    '.....hk.....',
    '....hk......',
    '...hk.......',
    '..hk........',
    '.hk.........',
    '.hk.........',
    'hk..........',
  ],
  // p = raw meat, k = darker meat edge, b = bone
  [PORK]: [
    '............',
    '...ppppp....',
    '..ppppppp...',
    '..ppppppkb..',
    '.pppppppkb..',
    '.ppppppppk..',
    '.ppppppppk..',
    '..pppppppk..',
    '..kppppppk..',
    '...kkkkkk...',
    '............',
    '............',
  ],
  // r = sickly flesh, k = darker edge
  [ROTTEN]: [
    '............',
    '...rrkr.....',
    '..rrrrrrk...',
    '.rrkrrrrr...',
    '.rrrrrkrrk..',
    '.rrrrrrrrk..',
    '..rrkrrrrk..',
    '..rrrrrkk...',
    '...krrrk....',
    '....kkk.....',
    '............',
    '............',
  ],
};

export function drawMaterialIcon(ctx, id) {
  const art = MATERIAL_ART[id];
  const colors = {
    h: '#8a6233', k: '#5c3d23',
    p: '#e07a82', b: '#efe6d2',           // raw pork + bone
    r: '#7a9a5c',                          // rotten flesh
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
