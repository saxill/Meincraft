import { BLOCKS, PLACEABLE, drawBlockIcon } from './blocks.js';
import { TOOL_IDS, isTool, itemName, drawToolIcon } from './items.js';

// Builds the hotbar and the E-inventory. The game owns selection/locking;
// this module only renders and reports clicks.
export function createUI({ atlasCanvas, hotbar, getSelected, onAssign, onBackdropClose }) {
  const barEl = document.getElementById('hotbar');
  const invEl = document.getElementById('inventory');
  const gridEl = invEl.querySelector('.inv-grid');
  let invOpen = false;

  function makeSlot(blockId, keyLabel) {
    const slot = document.createElement('div');
    slot.className = 'slot';
    slot.title = itemName(blockId);
    const icon = document.createElement('canvas');
    icon.width = icon.height = 48;
    if (isTool(blockId)) drawToolIcon(icon.getContext('2d'), blockId);
    else drawBlockIcon(icon.getContext('2d'), atlasCanvas, blockId);
    slot.appendChild(icon);
    if (keyLabel) {
      const key = document.createElement('span');
      key.className = 'key';
      key.textContent = keyLabel;
      slot.appendChild(key);
    }
    return slot;
  }

  function refreshHotbar() {
    barEl.innerHTML = '';
    hotbar.forEach((id, i) => {
      const slot = makeSlot(id, String(i + 1));
      if (i === getSelected()) slot.classList.add('selected');
      barEl.appendChild(slot);
    });
  }

  // Inventory grid is static — build once (tools first, then blocks)
  TOOL_IDS.concat(PLACEABLE).forEach(id => {
    const slot = makeSlot(id);
    slot.addEventListener('click', () => onAssign(id));
    gridEl.appendChild(slot);
  });
  invEl.addEventListener('click', e => {
    if (e.target === invEl) onBackdropClose();
  });

  refreshHotbar();

  return {
    refreshHotbar,
    inventoryOpen: () => invOpen,
    showInventory(show) {
      invOpen = show;
      invEl.classList.toggle('hidden', !show);
    },
    syncOverlay(locked) {
      document.getElementById('overlay').classList.toggle('hidden', locked || invOpen);
    },
  };
}
