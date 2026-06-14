import { BLOCKS, PLACEABLE, drawBlockIcon } from './blocks.js';
import {
  TOOL_IDS, STICK, isTool, isMaterial, itemName,
  drawToolIcon, drawMaterialIcon, toolDurability,
} from './items.js';
import { HOTBAR_SIZE, MAIN_SIZE, maxStackFor, MAX_STACK } from './inventory.js';

// Renders the hotbar, the E-inventory (click-to-move slots + crafting), the
// creative palette, and the health hearts. The game owns the model and
// selection; this module only draws and reports interactions via callbacks.
export function createUI(opts) {
  const {
    atlasCanvas, inventory, getSelected, getCreative,
    recipes, canCraft, onCraft, onToggleCreative, onChange, onBackdropClose,
  } = opts;

  const barEl = document.getElementById('hotbar');
  const invEl = document.getElementById('inventory');
  const bodyEl = document.getElementById('inv-body');
  const titleEl = document.getElementById('inv-title');
  const hintEl = document.getElementById('inv-hint');
  const modeBtn = document.getElementById('mode-btn');
  const cursorEl = document.getElementById('cursor-item');
  const heartsCanvas = document.getElementById('hearts');
  let invOpen = false;
  let cursor = null; // stack being dragged between slots: { id, count, dura? }

  // ---- icon drawing --------------------------------------------------------
  function drawStackIcon(ctx, id) {
    if (isTool(id)) drawToolIcon(ctx, id);
    else if (isMaterial(id)) drawMaterialIcon(ctx, id);
    else drawBlockIcon(ctx, atlasCanvas, id);
  }

  function makeSlot(stack, { clickable, index } = {}) {
    const slot = document.createElement('div');
    slot.className = 'slot' + (clickable ? ' clickable' : '');
    if (index != null) slot.dataset.index = index;
    if (stack) {
      slot.title = itemName(stack.id);
      const icon = document.createElement('canvas');
      icon.width = icon.height = 48;
      drawStackIcon(icon.getContext('2d'), stack.id);
      slot.appendChild(icon);
      if (stack.count > 1) {
        const c = document.createElement('span');
        c.className = 'count';
        c.textContent = stack.count;
        slot.appendChild(c);
      }
      if (isTool(stack.id) && stack.dura != null) {
        const max = toolDurability(stack.id);
        if (stack.dura < max) {
          const frac = Math.max(0, stack.dura / max);
          const bar = document.createElement('div');
          bar.className = 'durabar';
          const fill = document.createElement('i');
          fill.style.width = (frac * 100) + '%';
          fill.style.background = `hsl(${frac * 120}, 80%, 45%)`;
          bar.appendChild(fill);
          slot.appendChild(bar);
        }
      }
    }
    return slot;
  }

  // ---- bottom hotbar -------------------------------------------------------
  function refreshHotbar() {
    barEl.innerHTML = '';
    for (let i = 0; i < HOTBAR_SIZE; i++) {
      const slot = makeSlot(inventory.get(i));
      if (i === getSelected()) slot.classList.add('selected');
      const key = document.createElement('span');
      key.className = 'key';
      key.textContent = String(i + 1);
      slot.appendChild(key);
      barEl.appendChild(slot);
    }
  }

  // ---- cursor (item being moved) ------------------------------------------
  function updateCursorEl() {
    if (!cursor) { cursorEl.style.display = 'none'; cursorEl.innerHTML = ''; return; }
    cursorEl.innerHTML = '';
    const icon = document.createElement('canvas');
    icon.width = icon.height = 48;
    drawStackIcon(icon.getContext('2d'), cursor.id);
    cursorEl.appendChild(icon);
    if (cursor.count > 1) {
      const c = document.createElement('span');
      c.className = 'count';
      c.textContent = cursor.count;
      cursorEl.appendChild(c);
    }
    cursorEl.style.display = 'block';
  }

  function clickSlot(index) {
    const s = inventory.get(index);
    if (!cursor && !s) return;
    if (!cursor && s) {
      cursor = s; inventory.set(index, null);
    } else if (cursor && !s) {
      inventory.set(index, cursor); cursor = null;
    } else if (cursor.id === s.id && !isTool(cursor.id)) {
      const move = Math.min(MAX_STACK - s.count, cursor.count);
      s.count += move; cursor.count -= move;
      if (cursor.count <= 0) cursor = null;
    } else {
      inventory.set(index, cursor); cursor = s; // swap
    }
    afterChange();
  }

  // Return a held cursor stack to the inventory (called when closing).
  function returnCursor() {
    if (!cursor) return;
    const empty = inventory.slots.findIndex(x => x === null);
    if (empty >= 0) inventory.set(empty, cursor);
    else inventory.addItem(cursor.id, cursor.count);
    cursor = null;
  }

  function afterChange() {
    renderBody();
    refreshHotbar();
    updateCursorEl();
    onChange();
  }

  // ---- inventory body (rebuilt on open / mode change) ----------------------
  function renderBody() {
    const creative = getCreative();
    modeBtn.textContent = 'Mode: ' + (creative ? 'Creative' : 'Survival');
    titleEl.textContent = creative ? 'Creative' : 'Inventory';
    hintEl.textContent = creative
      ? 'click an item to grab a full stack, then place it on your hotbar'
      : 'click a stack to pick it up, click again to place it · craft on the left';
    bodyEl.innerHTML = '';

    const cols = document.createElement('div');
    cols.className = 'inv-cols';

    if (creative) {
      cols.appendChild(creativePalette());
    } else {
      cols.appendChild(craftingPanel());
      cols.appendChild(mainGridPanel());
    }
    bodyEl.appendChild(cols);

    // Hotbar row (editable) — shown in both modes, below the columns.
    const hb = document.createElement('div');
    hb.className = 'inv-section';
    const h = document.createElement('h3'); h.textContent = 'Hotbar'; hb.appendChild(h);
    const row = document.createElement('div'); row.className = 'inv-row';
    for (let i = 0; i < HOTBAR_SIZE; i++) {
      const slot = makeSlot(inventory.get(i), { clickable: true, index: i });
      slot.addEventListener('click', () => clickSlot(i));
      row.appendChild(slot);
    }
    hb.appendChild(row);
    bodyEl.appendChild(hb);
  }

  function mainGridPanel() {
    const sec = document.createElement('div');
    sec.className = 'inv-section';
    const h = document.createElement('h3'); h.textContent = 'Items'; sec.appendChild(h);
    const rows = document.createElement('div'); rows.className = 'inv-rows';
    for (let r = 0; r < MAIN_SIZE / HOTBAR_SIZE; r++) {
      const row = document.createElement('div'); row.className = 'inv-row';
      for (let c = 0; c < HOTBAR_SIZE; c++) {
        const index = HOTBAR_SIZE + r * HOTBAR_SIZE + c;
        const slot = makeSlot(inventory.get(index), { clickable: true, index });
        slot.addEventListener('click', () => clickSlot(index));
        row.appendChild(slot);
      }
      rows.appendChild(row);
    }
    sec.appendChild(rows);
    return sec;
  }

  function craftingPanel() {
    const sec = document.createElement('div');
    sec.className = 'inv-section';
    const h = document.createElement('h3'); h.textContent = 'Crafting'; sec.appendChild(h);
    const list = document.createElement('div'); list.className = 'craft-list';
    for (const recipe of recipes) {
      const ok = canCraft(recipe);
      const rowEl = document.createElement('div');
      rowEl.className = 'craft-row' + (ok ? '' : ' dim');
      const icon = document.createElement('canvas');
      icon.width = icon.height = 48;
      drawStackIcon(icon.getContext('2d'), recipe.out.id);
      const txt = document.createElement('div');
      const label = document.createElement('div');
      label.className = 'clabel';
      label.textContent = `${itemName(recipe.out.id)}${recipe.out.count > 1 ? ' ×' + recipe.out.count : ''}`;
      const req = document.createElement('div');
      req.className = 'creq';
      req.textContent = recipe.ins.map(i => `${i.count} ${itemName(i.id)}`).join(' + ');
      txt.appendChild(label); txt.appendChild(req);
      rowEl.appendChild(icon); rowEl.appendChild(txt);
      if (ok) rowEl.addEventListener('click', () => { onCraft(recipe); afterChange(); });
      list.appendChild(rowEl);
    }
    sec.appendChild(list);
    return sec;
  }

  function creativePalette() {
    const sec = document.createElement('div');
    sec.className = 'inv-section';
    const h = document.createElement('h3'); h.textContent = 'All items'; sec.appendChild(h);
    const grid = document.createElement('div');
    grid.className = 'creative-palette';
    const ids = [...PLACEABLE, ...TOOL_IDS, STICK];
    for (const id of ids) {
      const slot = makeSlot({ id, count: 1 }, { clickable: true });
      slot.querySelector('.count')?.remove();
      slot.addEventListener('click', () => {
        cursor = inventory.freshStack(id, maxStackFor(id));
        updateCursorEl();
      });
      grid.appendChild(slot);
    }
    sec.appendChild(grid);
    return sec;
  }

  // ---- health hearts -------------------------------------------------------
  function heartPath(ctx, x, y, s) {
    ctx.beginPath();
    ctx.moveTo(x + s / 2, y + s * 0.85);
    ctx.bezierCurveTo(x - s * 0.1, y + s * 0.45, x + s * 0.15, y, x + s / 2, y + s * 0.3);
    ctx.bezierCurveTo(x + s * 0.85, y, x + s * 1.1, y + s * 0.45, x + s / 2, y + s * 0.85);
    ctx.closePath();
  }
  function setHealth(hp, maxHp, visible) {
    heartsCanvas.style.display = visible ? 'block' : 'none';
    if (!visible) return;
    const ctx = heartsCanvas.getContext('2d');
    ctx.clearRect(0, 0, heartsCanvas.width, heartsCanvas.height);
    const hearts = Math.ceil(maxHp / 2);
    const s = 18, gap = 2;
    for (let i = 0; i < hearts; i++) {
      const x = i * (s + gap), y = 1;
      heartPath(ctx, x, y, s); ctx.fillStyle = '#3a0d0d'; ctx.fill();
      const filled = hp - i * 2; // 2, 1, or <=0
      if (filled >= 2) {
        heartPath(ctx, x, y, s); ctx.fillStyle = '#e23b3b'; ctx.fill();
      } else if (filled === 1) {
        ctx.save();
        ctx.beginPath(); ctx.rect(x, y, s / 2, s); ctx.clip();
        heartPath(ctx, x, y, s); ctx.fillStyle = '#e23b3b'; ctx.fill();
        ctx.restore();
      }
    }
  }

  // ---- wiring --------------------------------------------------------------
  invEl.addEventListener('click', e => { if (e.target === invEl) onBackdropClose(); });
  modeBtn.addEventListener('click', () => { returnCursor(); onToggleCreative(); afterChange(); });
  invEl.addEventListener('mousemove', e => {
    if (cursor) { cursorEl.style.left = e.clientX + 'px'; cursorEl.style.top = e.clientY + 'px'; }
  });

  refreshHotbar();

  return {
    refreshHotbar,
    refreshInventory: renderBody,
    setHealth,
    inventoryOpen: () => invOpen,
    showInventory(show) {
      invOpen = show;
      if (show) { renderBody(); updateCursorEl(); }
      else { returnCursor(); updateCursorEl(); refreshHotbar(); }
      invEl.classList.toggle('hidden', !show);
    },
    syncOverlay(locked) {
      document.getElementById('overlay').classList.toggle('hidden', locked || invOpen);
    },
  };
}
