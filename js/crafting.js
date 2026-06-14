import { B } from './blocks.js';
import { PICKAXE, AXE, SHOVEL, SWORD, STICK } from './items.js';

// Shapeless recipes: a flat list of inputs that yields one output stack.
// Kept deliberately simple (no 3x3 grid) so it works on a click and on mobile.
export const RECIPES = [
  { out: { id: B.PLANK, count: 4 }, ins: [{ id: B.LOG, count: 1 }] },
  { out: { id: STICK, count: 4 },   ins: [{ id: B.PLANK, count: 2 }] },
  { out: { id: PICKAXE, count: 1 }, ins: [{ id: B.PLANK, count: 3 }, { id: STICK, count: 2 }] },
  { out: { id: AXE, count: 1 },     ins: [{ id: B.PLANK, count: 3 }, { id: STICK, count: 2 }] },
  { out: { id: SHOVEL, count: 1 },  ins: [{ id: B.PLANK, count: 1 }, { id: STICK, count: 2 }] },
  { out: { id: SWORD, count: 1 },   ins: [{ id: B.PLANK, count: 2 }, { id: STICK, count: 1 }] },
];

export function canCraft(inv, recipe) {
  return recipe.ins.every(i => inv.count(i.id) >= i.count) && inv.hasRoomFor(recipe.out.id);
}

// Consume the inputs and add the output. Returns true on success.
export function craft(inv, recipe) {
  if (!canCraft(inv, recipe)) return false;
  for (const i of recipe.ins) inv.take(i.id, i.count);
  inv.addItem(recipe.out.id, recipe.out.count);
  return true;
}
