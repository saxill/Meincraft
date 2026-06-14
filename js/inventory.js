import { isTool, toolDurability } from './items.js';

// A flat slot model. Slots 0..8 are the hotbar, 9..35 the main grid.
// Each slot is null or { id, count, dura? }. Blocks/items stack to 64;
// tools never stack (count 1) and carry their own remaining durability.
export const HOTBAR_SIZE = 9;
export const MAIN_SIZE = 27;
export const TOTAL_SLOTS = HOTBAR_SIZE + MAIN_SIZE;
export const MAX_STACK = 64;

export const maxStackFor = id => (isTool(id) ? 1 : MAX_STACK);

export function createInventory(saved) {
  const slots = new Array(TOTAL_SLOTS).fill(null);

  // Restore a previously saved layout (sparse array of {id,count,dura})
  if (Array.isArray(saved)) {
    for (let i = 0; i < TOTAL_SLOTS && i < saved.length; i++) {
      const s = saved[i];
      if (s && s.id != null && s.count > 0) {
        slots[i] = { id: s.id, count: s.count, dura: s.dura };
      }
    }
  }

  function freshStack(id, count) {
    const s = { id, count };
    if (isTool(id)) s.dura = toolDurability(id);
    return s;
  }

  // Add up to `count` of `id`; returns the number that didn't fit.
  function addItem(id, count = 1) {
    let left = count;
    if (isTool(id)) {
      // Each tool occupies its own slot, full durability.
      for (let n = 0; n < left; n++) {
        const i = slots.findIndex(s => s === null);
        if (i < 0) return left - n;
        slots[i] = freshStack(id, 1);
      }
      return 0;
    }
    // Top up existing stacks of the same block first.
    for (let i = 0; i < TOTAL_SLOTS && left > 0; i++) {
      const s = slots[i];
      if (s && s.id === id && s.count < MAX_STACK) {
        const room = MAX_STACK - s.count;
        const add = Math.min(room, left);
        s.count += add;
        left -= add;
      }
    }
    // Then spill into empty slots.
    for (let i = 0; i < TOTAL_SLOTS && left > 0; i++) {
      if (slots[i] === null) {
        const add = Math.min(MAX_STACK, left);
        slots[i] = freshStack(id, add);
        left -= add;
      }
    }
    return left;
  }

  // Remove one unit from slot i (used when placing a block). Returns true if removed.
  function removeOne(i) {
    const s = slots[i];
    if (!s) return false;
    s.count--;
    if (s.count <= 0) slots[i] = null;
    return true;
  }

  function count(id) {
    let n = 0;
    for (const s of slots) if (s && s.id === id) n += s.count;
    return n;
  }

  // Take `n` of `id` from anywhere (for crafting inputs). Assumes enough exist.
  function take(id, n) {
    for (let i = 0; i < TOTAL_SLOTS && n > 0; i++) {
      const s = slots[i];
      if (s && s.id === id) {
        const t = Math.min(s.count, n);
        s.count -= t;
        n -= t;
        if (s.count <= 0) slots[i] = null;
      }
    }
  }

  return {
    slots,
    get: i => slots[i],
    set: (i, stack) => { slots[i] = stack; },
    addItem,
    removeOne,
    count,
    take,
    freshStack,
    hasRoomFor(id) {
      if (isTool(id)) return slots.some(s => s === null);
      return slots.some(s => s === null || (s.id === id && s.count < MAX_STACK));
    },
    serialize: () => slots.map(s => (s ? { id: s.id, count: s.count, dura: s.dura } : null)),
  };
}
