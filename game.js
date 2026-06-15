import * as THREE from 'three';
import { SEED, CHUNK, SEA, REACH, DAY_LENGTH, WORLD_H } from './js/config.js';
import { clamp } from './js/noise.js';
import {
  AIR, B, BLOCKS,
  buildAtlas, buildWaterTexture, computeTileColors,
} from './js/blocks.js';
import {
  chunks, getChunk, getBlock, setBlock, raycast, isSolid,
  flushEdits, clearChunkMemo, biomeAt,
  setPersist, setEdits, getAllEdits,
} from './js/world.js';
import { buildChunkMesh, disposeChunkMesh, makeBlockGeometry } from './js/mesher.js';
import { ensureAudio, playBlockSound, setMuted, isMuted } from './js/audio.js';
import { createParticles } from './js/particles.js';
import { createSky } from './js/sky.js';
import { createPlayer, EYE, playerAABB } from './js/player.js';
import { createUI } from './js/ui.js';
import { createNet } from './js/net.js';
import { createAvatars } from './js/avatars.js';
import {
  isTool, isMaterial, itemName, miningTime, drawToolIcon,
  attackDamage, blockDrop, toolDurability,
  mobDrop, isFood, foodHeal,
} from './js/items.js';
import { createInventory, HOTBAR_SIZE } from './js/inventory.js';
import { RECIPES, canCraft, craft } from './js/crafting.js';
import { createMobs } from './js/mobs.js';
import { createBot } from './js/bot.js';

// ---------------------------------------------------------------------------
// Saved state (position, hotbar, settings — block edits are saved in world.js)
// ---------------------------------------------------------------------------
const STATE_KEY = 'mineclone-state-v2-' + SEED;
let saved = {};
try { saved = JSON.parse(localStorage.getItem(STATE_KEY)) || {}; } catch (e) { saved = {}; }

let RENDER_DIST = clamp(saved.rd || 5, 2, 10);
let timeOfDay = typeof saved.t === 'number' ? saved.t : 0.05;
let selected = clamp(saved.sel || 0, 0, 8);
let creative = !!saved.creative;
const MAX_HP = 20;
let hp = typeof saved.hp === 'number' ? clamp(saved.hp, 0, MAX_HP) : MAX_HP;
let invulnT = 0;      // damage i-frames
let regenT = 0;       // time since last hurt (drives slow regen)

const inventory = createInventory(saved.inv);
// Migrate a pre-inventory save: pour the old 9-slot hotbar into the new bag.
if (!Array.isArray(saved.inv) && Array.isArray(saved.hotbar)) {
  for (const id of saved.hotbar) {
    if (id && (BLOCKS[id] || isTool(id))) inventory.addItem(id, 1);
  }
}
const heldId = () => { const s = inventory.get(selected); return s ? s.id : null; };
setMuted(!!saved.muted);

// ---------------------------------------------------------------------------
// Renderer / scene / materials
// ---------------------------------------------------------------------------
const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);

const scene = new THREE.Scene();
const bgColor = new THREE.Color(0x87ceeb);
scene.background = bgColor;
scene.fog = new THREE.Fog(0x87ceeb, 40, 80);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
scene.add(camera); // so the held block (a camera child) renders

const atlas = buildAtlas();
const waterTex = buildWaterTexture();
const tileColors = computeTileColors(atlas.canvas);

const materials = {
  // alphaTest cuts out glass interiors and plant sprites
  opaque: new THREE.MeshBasicMaterial({ map: atlas.texture, vertexColors: true, alphaTest: 0.5 }),
  water: new THREE.MeshBasicMaterial({
    map: waterTex, vertexColors: true, transparent: true, opacity: 0.65,
    depthWrite: false, side: THREE.DoubleSide,
  }),
};

const skyCtl = createSky(scene);
const particles = createParticles(scene);
const avatars = createAvatars(scene);
const mobs = createMobs(scene);

const highlight = new THREE.LineSegments(
  new THREE.EdgesGeometry(new THREE.BoxGeometry(1.002, 1.002, 1.002)),
  new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.6 })
);
highlight.visible = false;
scene.add(highlight);

// Mining crack overlay: 5 progressively denser crack textures on a box that
// wraps the block being mined.
const crackTextures = [];
{
  for (let stage = 0; stage < 5; stage++) {
    const c = document.createElement('canvas');
    c.width = c.height = 16;
    const ctx = c.getContext('2d');
    ctx.strokeStyle = 'rgba(20,16,12,0.85)';
    let x = 8, y = 8;
    for (let i = 0; i < 4 + stage * 4; i++) {
      ctx.beginPath();
      ctx.moveTo(x, y);
      x = (x + 3 + ((i * 7 + stage * 5) % 11)) % 16;
      y = (y + 3 + ((i * 5 + stage * 3) % 13)) % 16;
      ctx.lineTo(x, y);
      ctx.stroke();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    crackTextures.push(tex);
  }
}
const crackMat = new THREE.MeshBasicMaterial({
  map: crackTextures[0], transparent: true, depthWrite: false,
  polygonOffset: true, polygonOffsetFactor: -2,
});
const crackMesh = new THREE.Mesh(new THREE.BoxGeometry(1.001, 1.001, 1.001), crackMat);
crackMesh.visible = false;
scene.add(crackMesh);

// Held block in the bottom-right corner
const hand = new THREE.Group();
hand.position.set(0.45, -0.4, -0.65);
hand.rotation.set(0.15, -0.55, 0);
camera.add(hand);
let handMesh = null;
const toolHandMaterials = {}; // toolId -> material with the icon texture
function toolMaterial(id) {
  if (!toolHandMaterials[id]) {
    const c = document.createElement('canvas');
    c.width = c.height = 48;
    drawToolIcon(c.getContext('2d'), id);
    const tex = new THREE.CanvasTexture(c);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.colorSpace = THREE.SRGBColorSpace;
    toolHandMaterials[id] = new THREE.MeshBasicMaterial({
      map: tex, alphaTest: 0.5, side: THREE.DoubleSide,
    });
  }
  return toolHandMaterials[id];
}
function refreshHand() {
  if (handMesh) { hand.remove(handMesh); handMesh.geometry.dispose(); handMesh = null; }
  const id = heldId();
  if (id == null || isMaterial(id)) return; // empty fist / non-visual item
  if (isTool(id)) {
    handMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), toolMaterial(id));
    handMesh.scale.setScalar(0.6);
    handMesh.rotation.set(0, 0.4, -0.5); // tilt so the head points up-left like a held tool
  } else {
    handMesh = new THREE.Mesh(makeBlockGeometry(id), materials.opaque);
    handMesh.scale.setScalar(0.35);
  }
  hand.add(handMesh);
}
let swingT = 0;
const SWING = 0.22;

// ---------------------------------------------------------------------------
// Player
// ---------------------------------------------------------------------------
const player = createPlayer();
if (Array.isArray(saved.pos) && saved.pos.length === 3) {
  player.pos.set(saved.pos[0], saved.pos[1], saved.pos[2]);
  player.yaw = saved.yaw || 0;
  player.pitch = saved.pitch || 0;
  player.flying = !!saved.flying;
}
// Respawn checkpoint: the last ground the player safely stood on. Updated as
// you walk, persisted, and used by respawn() instead of the world origin.
let spawnX = Array.isArray(saved.spawn) ? saved.spawn[0] : player.pos.x;
let spawnZ = Array.isArray(saved.spawn) ? saved.spawn[1] : player.pos.z;
let checkpointTimer = 0;

let keys = {};
let locked = false;
let bobPhase = 0;
let lastWTap = 0;

function eyeInWater() {
  return getBlock(
    Math.floor(camera.position.x),
    Math.floor(camera.position.y),
    Math.floor(camera.position.z)
  ) === B.WATER;
}

// ---------------------------------------------------------------------------
// Player health & damage
// ---------------------------------------------------------------------------
const hurtOverlay = document.getElementById('hurt-overlay');
let fallPeakY = null; // highest point of the current fall, for fall damage

function hurtPlayer(amount, fromX, fromZ) {
  if (creative || invulnT > 0 || hp <= 0) return;
  hp = Math.max(0, hp - amount);
  invulnT = 0.5;
  regenT = 0;
  hurtOverlay.style.opacity = '0.45';
  // Knock the player back/up away from the damage source.
  if (fromX != null) {
    const dx = player.pos.x - fromX, dz = player.pos.z - fromZ;
    const len = Math.hypot(dx, dz) || 1;
    player.vel.x += (dx / len) * 5;
    player.vel.z += (dz / len) * 5;
    if (!player.flying) player.vel.y = 6;
  }
  updateHearts();
  if (hp <= 0) respawn();
}

function respawn() {
  hp = MAX_HP;
  invulnT = 2.0;
  player.vel.set(0, 0, 0);
  player.flying = false;
  // Respawn at the last checkpoint (the ground you were last safely standing
  // on), not the world origin — so dying doesn't fling you across the map.
  const sx = Math.floor(spawnX), sz = Math.floor(spawnZ);
  player.pos.set(sx + 0.5, heightAtSafe(sx, sz), sz + 0.5);
  fallPeakY = null;
  updateHearts();
  saveState();
}

function heightAtSafe(x, z) {
  // Find a proper standing surface: a solid block (not foliage) with two
  // blocks of air above it, scanning down from the sky.
  for (let y = WORLD_H - 2; y > 1; y--) {
    const here = getBlock(x, y, z);
    if (isSolid(here) && here !== B.LEAVES &&
        getBlock(x, y + 1, z) === AIR && getBlock(x, y + 2, z) === AIR) {
      return y + 1.05;
    }
  }
  return SEA + 4;
}

// ---------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------
const ui = createUI({
  atlasCanvas: atlas.canvas,
  inventory,
  getSelected: () => selected,
  getCreative: () => creative,
  recipes: RECIPES,
  canCraft: r => canCraft(inventory, r),
  onCraft(r) { craft(inventory, r); playBlockSound(B.PLANK, 'place'); },
  onToggleCreative() { creative = !creative; updateHearts(); saveState(); },
  onChange() { refreshHand(); saveState(); },
  onBackdropClose: () => closeInventory(true),
});
function updateHearts() {
  ui.setHealth(hp, MAX_HP, !creative);
}
refreshHand();
updateHearts();

function requestLock() {
  const p = canvas.requestPointerLock();
  if (p && p.catch) p.catch(() => {});
}
function openInventory() {
  keys = {};
  ui.showInventory(true);
  if (locked) document.exitPointerLock();
  ui.syncOverlay(locked);
}
function closeInventory(relock) {
  ui.showInventory(false);
  if (relock) requestLock();
  ui.syncOverlay(locked);
}

// ---------------------------------------------------------------------------
// Multiplayer (WebRTC peer-to-peer via PeerJS — works on static hosting)
// ---------------------------------------------------------------------------
const mpStatus = document.getElementById('mp-status');
const mpName = document.getElementById('mp-name');
const mpCode = document.getElementById('mp-code');
const mpPass = document.getElementById('mp-pass');
const mpHostBtn = document.getElementById('mp-host');
const mpJoinBtn = document.getElementById('mp-join');
mpName.value = saved.name || '';

// Host-side join approval. A would-be player must (1) supply the room password
// AND (2) be approved here before they receive any world data. We deliberately
// never persist the password (it's not written to the save).
const joinReqEl = document.getElementById('join-req');
const joinReqText = document.getElementById('join-req-text');
const joinAllowBtn = document.getElementById('join-allow');
const joinDenyBtn = document.getElementById('join-deny');
const joinQueue = [];
let joinCurrent = null;
function showNextJoinRequest() {
  joinCurrent = joinQueue.shift() || null;
  if (!joinCurrent) { joinReqEl.classList.add('hidden'); return; }
  // textContent only — a joiner's name is never rendered as markup.
  joinReqText.textContent = `"${joinCurrent.name}" wants to join your room — allow?`;
  joinReqEl.classList.remove('hidden');
  if (locked) document.exitPointerLock();
}
function queueJoinRequest(name, peerId, decide) {
  joinQueue.push({ name, decide });
  if (!joinCurrent) showNextJoinRequest();
}
function answerJoin(ok) {
  const j = joinCurrent;
  joinCurrent = null;
  if (j) { try { j.decide(ok); } catch (e) {} }
  showNextJoinRequest();
}
joinAllowBtn.addEventListener('click', e => { e.stopPropagation(); answerJoin(true); });
joinDenyBtn.addEventListener('click', e => { e.stopPropagation(); answerJoin(false); });

function playerName() {
  return (mpName.value.trim() || 'player' + Math.floor(Math.random() * 900 + 100)).slice(0, 16);
}

// Apply an edit that arrived from the network (never re-broadcast it)
function applyRemoteEdit(e) {
  const prev = getBlock(e.x, e.y, e.z);
  if (prev === e.id) return;
  setBlock(e.x, e.y, e.z, e.id);
  const broken = (e.id === AIR || e.id === B.WATER) && BLOCKS[prev] && prev !== B.WATER;
  if (broken) particles.burst(e.x, e.y, e.z, tileColors[BLOCKS[prev].tiles[0]]);
  const d = Math.hypot(e.x - player.pos.x, e.y - player.pos.y, e.z - player.pos.z);
  if (d < 24) playBlockSound(broken ? prev : e.id, broken ? 'break' : 'place');
}

const net = createNet({
  name: playerName,
  getTime: () => timeOfDay,
  getEdits: getAllEdits,
  // Host-side access control: the current room password + the approve/deny gate.
  getPassword: () => mpPass.value,
  approveJoin: (name, peerId, decide) => queueJoinRequest(name, peerId, decide),
  onDenied(reason) {
    mpStatus.textContent = 'join denied: ' + reason;
    mpHostBtn.disabled = false;
    mpJoinBtn.disabled = false;
  },
  onStatus(text) { mpStatus.textContent = text; },
  onInit(msg) {
    // We're now in the host's world: adopt their edits and clock, never
    // overwrite our own solo save, and rebuild everything already loaded.
    setPersist(false);
    setEdits(msg.edits);
    timeOfDay = msg.time;
    for (const [key, c] of chunks) {
      disposeChunkMesh(c, scene);
      chunks.delete(key);
    }
    clearChunkMemo();
    for (const p of msg.players || []) avatars.add(p.id, p.name);
  },
  onEdit: applyRemoteEdit,
  onPos(p) { avatars.setTarget(p.id, p); },
  onJoin(id, name) {
    avatars.add(id, name);
    mpStatus.textContent = name + ' joined' + (net.hosting ? ' room ' + net.code : '');
  },
  onLeave(id) { avatars.remove(id); },
  onTime(t) { timeOfDay = t; },
  onHostLost() {
    avatars.clear();
    mpStatus.textContent = 'host disconnected — playing offline (changes here are not saved)';
  },
});

// Keep panel interactions from reaching the click-to-play overlay
const mpPanel = document.getElementById('mp');
for (const ev of ['click', 'mousedown', 'mouseup']) {
  mpPanel.addEventListener(ev, e => e.stopPropagation());
}
mpName.addEventListener('click', () => mpName.focus());
mpCode.addEventListener('click', () => mpCode.focus());
mpPass.addEventListener('click', () => mpPass.focus());
mpHostBtn.addEventListener('click', () => {
  saveState();
  net.host(mpCode.value);            // optional fixed room id
  mpHostBtn.disabled = true;
  mpJoinBtn.disabled = true;
});
mpJoinBtn.addEventListener('click', () => {
  saveState();
  net.join(mpCode.value, mpPass.value);   // code + password
  mpHostBtn.disabled = true;
  mpJoinBtn.disabled = true;
});

// ---------------------------------------------------------------------------
// Companion bot "Zara" — a local player-shaped helper (no server, no API key).
// Summon with B, talk to it with T. See js/bot.js.
// ---------------------------------------------------------------------------
const botChat = document.getElementById('botchat');
const botLog = document.getElementById('botlog');
const botInput = document.getElementById('botinput');

// Append a line to the companion log via textContent only (never innerHTML) so
// nothing the bot or user "says" can inject markup.
function botSay(text) {
  const line = document.createElement('div');
  line.className = 'botline';
  line.textContent = 'Zara: ' + text;
  botLog.appendChild(line);
  while (botLog.children.length > 6) botLog.removeChild(botLog.firstChild);
  botLog.classList.remove('hidden');
  clearTimeout(botSay._fade);
  botSay._fade = setTimeout(() => botLog.classList.add('hidden'), 7000);
}

const bot = createBot(scene, {
  name: 'Zara',
  say: botSay,
  onEdit: (x, y, z, id) => net.sendEdit(x, y, z, id),
  onBreak: (x, y, z, id) => {
    if (BLOCKS[id]) particles.burst(x, y, z, tileColors[BLOCKS[id].tiles[0]]);
    const d = Math.hypot(x - player.pos.x, y - player.pos.y, z - player.pos.z);
    if (d < 24) playBlockSound(id, 'break');
    giveDrop(id); // the companion hands what it mines to you
    ui.refreshHotbar();
    saveState();
  },
  getMobs: () => mobs.mobs,
  damageMob: (mob, dmg, fx, fz) => mobs.damageMob(mob, dmg, fx, fz),
  onKill: (type) => {
    const drop = mobDrop(type);
    if (drop && !creative) { inventory.addItem(drop.id, drop.count); ui.refreshHotbar(); saveState(); }
  },
});

function openBotChat() {
  if (!locked || ui.inventoryOpen()) return;
  botChat.classList.remove('hidden');
  botLog.classList.remove('hidden');
  document.getElementById('overlay').classList.add('hidden');
  if (locked) document.exitPointerLock();
  botInput.value = '';
  setTimeout(() => botInput.focus(), 0);
}
function closeBotChat(relock) {
  botChat.classList.add('hidden');
  botInput.value = '';
  if (relock) requestLock();
}
botInput.addEventListener('keydown', e => {
  e.stopPropagation();
  if (e.code === 'Enter') {
    const v = botInput.value;
    closeBotChat(true);
    if (v.trim()) bot.command(v);
  } else if (e.code === 'Escape') {
    closeBotChat(true);
  }
});

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------
document.getElementById('overlay').addEventListener('click', e => {
  if (e.target.closest && e.target.closest('.mp')) return; // multiplayer panel
  ensureAudio();
  requestLock();
});
document.addEventListener('pointerlockchange', () => {
  locked = document.pointerLockElement === canvas;
  if (!locked) keys = {};
  ui.syncOverlay(locked);
  // Talking to the companion drops pointer lock on purpose — keep the
  // click-to-play overlay hidden so the chat box stays usable.
  if (!botChat.classList.contains('hidden')) {
    document.getElementById('overlay').classList.add('hidden');
  }
});

document.addEventListener('mousemove', e => {
  if (!locked) return;
  player.yaw -= e.movementX * 0.0024;
  player.pitch -= e.movementY * 0.0024;
  player.pitch = clamp(player.pitch, -Math.PI / 2 + 0.01, Math.PI / 2 - 0.01);
});

document.addEventListener('keydown', e => {
  if (e.target && e.target.tagName === 'INPUT') return; // typing in the MP panel
  if (e.code === 'KeyE') {
    if (ui.inventoryOpen()) closeInventory(true);
    else openInventory();
    return;
  }
  if (e.code === 'Escape' && ui.inventoryOpen()) {
    closeInventory(false);
    return;
  }
  if (e.code === 'KeyF') {
    player.flying = !player.flying;
    player.vel.y = 0;
  }
  if (e.code === 'KeyM') {
    setMuted(!isMuted());
    saveState();
  }
  if (e.code === 'KeyB') bot.toggle(player);
  if (e.code === 'KeyT') { openBotChat(); return; }
  if (e.code === 'BracketLeft') setRenderDist(RENDER_DIST - 1);
  if (e.code === 'BracketRight') setRenderDist(RENDER_DIST + 1);
  if (e.code === 'KeyW' && !e.repeat) {
    const now = performance.now();
    if (now - lastWTap < 280) player.sprinting = true;
    lastWTap = now;
  }
  if (e.code.startsWith('Digit')) {
    const n = parseInt(e.code.slice(5), 10);
    if (n >= 1 && n <= HOTBAR_SIZE) {
      selected = n - 1;
      ui.refreshHotbar();
      refreshHand();
    }
  }
  keys[e.code] = true;
});
document.addEventListener('keyup', e => { keys[e.code] = false; });

document.addEventListener('wheel', e => {
  if (!locked) return;
  selected = (selected + (e.deltaY > 0 ? 1 : -1) + HOTBAR_SIZE) % HOTBAR_SIZE;
  ui.refreshHotbar();
  refreshHand();
});

const lookDir = new THREE.Vector3();
function getLookDir() {
  camera.getWorldDirection(lookDir);
  return lookDir;
}

// Breaking is held, like real Minecraft: hardness per block, faster with the
// right tool. `mining` tracks progress on the block under the crosshair.
let mineHeld = false;
let mining = null; // { x, y, z, id, progress, total, tickTimer }

// Collect a broken block's drop (no-op in creative — building stays free).
function giveDrop(blockId) {
  if (creative) return;
  const d = blockDrop(blockId);
  if (d) inventory.addItem(d.id, d.count);
}

// Wear down the held tool by one use; it snaps at zero.
function wearTool() {
  if (creative) return;
  const s = inventory.get(selected);
  if (!s || !isTool(s.id)) return;
  s.dura = (s.dura == null ? toolDurability(s.id) : s.dura) - 1;
  if (s.dura <= 0) {
    inventory.set(selected, null);
    playBlockSound(B.STONE, 'break');
    refreshHand();
  }
}

function breakBlock(hit) {
  // Refill with water if a neighbour is water, so lakes don't get dry holes
  const touchesWater =
    getBlock(hit.x + 1, hit.y, hit.z) === B.WATER || getBlock(hit.x - 1, hit.y, hit.z) === B.WATER ||
    getBlock(hit.x, hit.y + 1, hit.z) === B.WATER ||
    getBlock(hit.x, hit.y, hit.z + 1) === B.WATER || getBlock(hit.x, hit.y, hit.z - 1) === B.WATER;
  const fill = touchesWater && hit.y <= SEA ? B.WATER : AIR;
  setBlock(hit.x, hit.y, hit.z, fill);
  net.sendEdit(hit.x, hit.y, hit.z, fill);
  particles.burst(hit.x, hit.y, hit.z, tileColors[BLOCKS[hit.id].tiles[0]]);
  playBlockSound(hit.id, 'break');
  giveDrop(hit.id);
  wearTool();
  // Plants pop when their ground is removed
  const above = getBlock(hit.x, hit.y + 1, hit.z);
  if (BLOCKS[above] && BLOCKS[above].cross) {
    setBlock(hit.x, hit.y + 1, hit.z, AIR);
    net.sendEdit(hit.x, hit.y + 1, hit.z, AIR);
    particles.burst(hit.x, hit.y + 1, hit.z, tileColors[BLOCKS[above].tiles[0]], 8);
    giveDrop(above);
  }
  ui.refreshHotbar();
  saveState();
}

function updateMining(dt, hit) {
  if (!mineHeld || !hit || BLOCKS[hit.id].unbreakable) { mining = null; return; }
  const held = heldId();
  if (!mining || mining.x !== hit.x || mining.y !== hit.y || mining.z !== hit.z ||
      mining.id !== hit.id || mining.held !== held) {
    mining = {
      x: hit.x, y: hit.y, z: hit.z, id: hit.id, held,
      progress: 0, total: miningTime(hit.id, held), tickTimer: 0,
    };
  }
  if (swingT <= 0) swingT = SWING; // keep swinging while held
  mining.progress += dt;
  mining.tickTimer -= dt;
  if (mining.tickTimer <= 0 && mining.total > 0.3) {
    mining.tickTimer = 0.28;
    playBlockSound(hit.id, 'step'); // mining knock
  }
  if (mining.progress >= mining.total) {
    breakBlock(hit);
    mining = null;
  }
}

document.addEventListener('mousedown', e => {
  if (!locked) return;
  ensureAudio();
  swingT = SWING;
  const hit = raycast(camera.position, getLookDir(), REACH);

  if (e.button === 0) {
    // Attack a mob if one is in front and closer than the targeted block.
    const dir = getLookDir();
    const picked = mobs.pickMob(camera.position, dir, 3.6);
    const blockDist = hit
      ? Math.hypot(hit.x + 0.5 - camera.position.x, hit.y + 0.5 - camera.position.y, hit.z + 0.5 - camera.position.z)
      : Infinity;
    if (picked && picked.dist < blockDist) {
      const killed = mobs.damageMob(picked.mob, attackDamage(heldId()), player.pos.x, player.pos.z);
      wearTool();
      if (killed && !creative) {
        const drop = mobDrop(picked.mob.type);
        if (drop && drop.count > 0) {
          inventory.addItem(drop.id, drop.count);
          ui.refreshHotbar();
          saveState();
        }
      }
      return;
    }
    mineHeld = true;
    updateMining(0, hit); // instant blocks (plants) break on click
    return;
  }

  // Right-click to eat held food (works whether or not a block is targeted).
  if (e.button === 2 && isFood(heldId())) {
    if (!creative && hp < MAX_HP && (inventory.get(selected)?.count || 0) > 0) {
      hp = Math.min(MAX_HP, hp + foodHeal(heldId()));
      inventory.removeOne(selected);
      updateHearts();
      ui.refreshHotbar();
      if (!inventory.get(selected)) refreshHand();
      playBlockSound(B.GRASS, 'step'); // soft munch
      saveState();
    }
    return;
  }
  if (!hit) return;

  if (e.button === 2) {
    const id = heldId();
    if (id == null || isTool(id) || isMaterial(id)) return; // only blocks place
    if (!creative && (inventory.get(selected)?.count || 0) <= 0) return;
    let px, py, pz;
    if (BLOCKS[hit.id].cross) {
      px = hit.x; py = hit.y; pz = hit.z; // placing into a plant replaces it
    } else {
      px = hit.x + hit.face[0]; py = hit.y + hit.face[1]; pz = hit.z + hit.face[2];
    }
    const existing = getBlock(px, py, pz);
    const replaceable = existing === AIR || existing === B.WATER ||
      (BLOCKS[existing] && BLOCKS[existing].cross);
    if (!replaceable) return;
    if (BLOCKS[id].cross && !isSolid(getBlock(px, py - 1, pz))) return; // plants need ground
    if (BLOCKS[id].solid) {
      const a = playerAABB(player.pos);
      const overlapsPlayer =
        px + 1 > a.minX && px < a.maxX &&
        py + 1 > a.minY && py < a.maxY &&
        pz + 1 > a.minZ && pz < a.maxZ;
      if (overlapsPlayer) return;
    }
    setBlock(px, py, pz, id);
    net.sendEdit(px, py, pz, id);
    playBlockSound(id, 'place');
    if (!creative) {
      inventory.removeOne(selected);
      ui.refreshHotbar();
      if (!inventory.get(selected)) refreshHand();
      saveState();
    }
  }
});
document.addEventListener('mouseup', e => {
  if (e.button === 0) { mineHeld = false; mining = null; }
});
document.addEventListener('contextmenu', e => e.preventDefault());

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------------------------------------------------------------------------
// Chunk streaming
// ---------------------------------------------------------------------------
function setRenderDist(n) {
  RENDER_DIST = clamp(n, 2, 10);
  saveState();
}

function updateChunks() {
  const pcx = Math.floor(player.pos.x / CHUNK);
  const pcz = Math.floor(player.pos.z / CHUNK);

  const wanted = [];
  for (let dz = -RENDER_DIST; dz <= RENDER_DIST; dz++) {
    for (let dx = -RENDER_DIST; dx <= RENDER_DIST; dx++) {
      const c = getChunk(pcx + dx, pcz + dz);
      if (c.dirty) wanted.push({ c, d: dx * dx + dz * dz });
    }
  }
  wanted.sort((a, b) => a.d - b.d);
  // Flood-fill fast on first load, then trickle to avoid frame hitches
  let budget = wanted.length > 24 ? 4 : 1;
  for (const w of wanted) {
    if (budget-- <= 0) break;
    buildChunkMesh(w.c, scene, materials);
  }

  for (const [key, c] of chunks) {
    const d = Math.max(Math.abs(c.cx - pcx), Math.abs(c.cz - pcz));
    if (d > RENDER_DIST + 3) {
      disposeChunkMesh(c, scene);
      chunks.delete(key);
      clearChunkMemo();
    } else if (d > RENDER_DIST && (c.mesh || c.waterMesh)) {
      disposeChunkMesh(c, scene);
      c.dirty = true; // remesh when it comes back into range
    }
  }
}

// ---------------------------------------------------------------------------
// State persistence
// ---------------------------------------------------------------------------
function saveState() {
  const s = {
    rd: RENDER_DIST,
    sel: selected,
    inv: inventory.serialize(),
    hp,
    creative,
    spawn: [Math.round(spawnX * 100) / 100, Math.round(spawnZ * 100) / 100],
    muted: isMuted(),
    t: Math.round(timeOfDay * 1000) / 1000,
    pos: [
      Math.round(player.pos.x * 100) / 100,
      Math.round(player.pos.y * 100) / 100,
      Math.round(player.pos.z * 100) / 100,
    ],
    name: mpName.value.trim().slice(0, 16),
    yaw: Math.round(player.yaw * 1000) / 1000,
    pitch: Math.round(player.pitch * 1000) / 1000,
    flying: player.flying,
  };
  try { localStorage.setItem(STATE_KEY, JSON.stringify(s)); } catch (e) { /* ignore */ }
}
setInterval(saveState, 3000);
window.addEventListener('beforeunload', () => {
  saveState();
  flushEdits();
});

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------
const hud = document.getElementById('hud');
const waterOverlay = document.getElementById('water-overlay');
const tint = new THREE.Color();
const NIGHT_TINT = new THREE.Color(0.30, 0.34, 0.55);
const WHITE = new THREE.Color(1, 1, 1);
const UNDERWATER = new THREE.Color(0x2a5cae);
const clock = new THREE.Clock();
let fpsTime = 0, fpsFrames = 0, fps = 0;
let posTimer = 0;

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);

  if (locked || net.active) timeOfDay = (timeOfDay + dt / DAY_LENGTH) % 1;
  if (locked) {
    const wasOnGround = player.onGround;
    const events = player.update(dt, keys);
    if (events.step) playBlockSound(events.step, 'step');
    if (events.land) playBlockSound(events.land, 'land');

    // Fall damage: track the apex of a fall, hurt on landing past ~4 blocks.
    if (!player.onGround && !player.flying && !player.inWater()) {
      fallPeakY = fallPeakY == null ? player.pos.y : Math.max(fallPeakY, player.pos.y);
    } else if (player.onGround) {
      if (!wasOnGround && fallPeakY != null) {
        const dist = fallPeakY - player.pos.y;
        if (dist > 4) hurtPlayer(Math.floor(dist - 4));
      }
      fallPeakY = null;
    }

    // Update the respawn checkpoint while standing safely on dry ground.
    checkpointTimer -= dt;
    if (checkpointTimer <= 0 && player.onGround && !player.inWater() && hp > 0) {
      checkpointTimer = 1.0;
      spawnX = player.pos.x;
      spawnZ = player.pos.z;
    }

    // Health regen + i-frames
    if (invulnT > 0) invulnT -= dt;
    regenT += dt;
    if (!creative && hp > 0 && hp < MAX_HP && regenT > 4) {
      regenT = 2.5; hp = Math.min(MAX_HP, hp + 1); updateHearts();
    }
    if (parseFloat(hurtOverlay.style.opacity) > 0) {
      hurtOverlay.style.opacity = String(Math.max(0, parseFloat(hurtOverlay.style.opacity) - dt * 1.8));
    }

    // Mobs hunt at night; they only act while you're in the world.
    const night = timeOfDay >= 0.5;
    mobs.update(dt, player, night, hurtPlayer);

    // Companion bot acts alongside the player (no-op until summoned with B).
    bot.update(dt, player);
  }

  avatars.update(dt);
  posTimer += dt;
  if (net.active && posTimer >= 0.1) {
    posTimer = 0;
    net.sendPos(
      Math.round(player.pos.x * 100) / 100,
      Math.round(player.pos.y * 100) / 100,
      Math.round(player.pos.z * 100) / 100,
      Math.round(player.yaw * 100) / 100
    );
  }

  // Camera: position + view bob + sneak crouch
  const hSpeed = Math.hypot(player.vel.x, player.vel.z);
  let bobY = 0;
  if (locked && player.onGround && !player.flying && hSpeed > 0.5) {
    bobPhase += dt * hSpeed * 1.6;
    bobY = Math.sin(bobPhase * 2) * 0.045 * Math.min(1, hSpeed / 5);
  }
  const eyeH = EYE - (player.sneaking ? 0.15 : 0);
  camera.position.set(player.pos.x, player.pos.y + eyeH + bobY, player.pos.z);
  camera.rotation.set(0, 0, 0);
  camera.rotateY(player.yaw);
  camera.rotateX(player.pitch);

  // Sprint FOV
  const targetFov = 75 + (player.sprinting ? 8 : 0);
  if (Math.abs(camera.fov - targetFov) > 0.01) {
    camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 10);
    camera.updateProjectionMatrix();
  }

  // Held-item swing: tools sweep a diagonal chop, blocks do a forward punch.
  // `a` rises 0→1→0 over the swing; `wind` biases the arc so it whips through
  // the low point rather than easing symmetrically (a meatier mining feel).
  const usingTool = isTool(heldId());
  if (swingT > 0) {
    swingT = Math.max(0, swingT - dt);
    const p = 1 - swingT / SWING;
    const a = Math.sin(p * Math.PI);
    const wind = Math.sin(p * Math.PI - 0.6) * 0.5 + 0.5;
    if (usingTool) {
      hand.position.set(0.45 - a * 0.12, -0.4 - wind * 0.18, -0.65 + a * 0.12);
      hand.rotation.set(0.15 - wind * 1.05, -0.55 + a * 0.25, wind * 1.15);
    } else {
      hand.position.set(0.45, -0.4 - a * 0.16, -0.65);
      hand.rotation.set(0.15 - a * 0.85, -0.55, 0);
    }
  } else {
    hand.position.set(0.45, -0.4, -0.65);
    hand.rotation.set(0.15, -0.55, 0);
  }

  updateChunks();

  // Day/night lighting + fog
  const { dayLight, sky } = skyCtl.update(dt, camera, timeOfDay);
  const underwater = eyeInWater();
  if (underwater) {
    bgColor.copy(UNDERWATER).multiplyScalar(0.3 + 0.7 * dayLight);
    scene.fog.near = 4;
    scene.fog.far = 28;
  } else {
    bgColor.copy(sky);
    scene.fog.near = RENDER_DIST * CHUNK * 0.55;
    scene.fog.far = RENDER_DIST * CHUNK * 0.92;
  }
  scene.fog.color.copy(bgColor);
  tint.lerpColors(NIGHT_TINT, WHITE, dayLight);
  materials.opaque.color.copy(tint);
  materials.water.color.copy(tint);
  particles.material.color.copy(tint);
  waterOverlay.style.display = underwater ? 'block' : 'none';
  waterTex.offset.y -= dt * 0.025;

  particles.update(dt);

  // Block highlight
  const hit = locked ? raycast(camera.position, getLookDir(), REACH) : null;
  if (hit) {
    highlight.position.set(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5);
    highlight.visible = true;
  } else {
    highlight.visible = false;
  }

  // Advance held-mining and show the crack overlay
  updateMining(dt, hit);
  if (mining && mining.total > 0) {
    const stage = clamp(Math.floor((mining.progress / mining.total) * 5), 0, 4);
    if (crackMat.map !== crackTextures[stage]) {
      crackMat.map = crackTextures[stage];
      crackMat.needsUpdate = true;
    }
    crackMesh.position.set(mining.x + 0.5, mining.y + 0.5, mining.z + 0.5);
    crackMesh.visible = true;
  } else {
    crackMesh.visible = false;
  }

  // HUD
  fpsFrames++;
  fpsTime += dt;
  if (fpsTime >= 0.5) {
    fps = Math.round(fpsFrames / fpsTime);
    fpsFrames = 0; fpsTime = 0;
    const mins = ((timeOfDay * 24 + 6) % 24) * 60;
    const hh = String(Math.floor(mins / 60)).padStart(2, '0');
    const mm = String(Math.floor(mins % 60)).padStart(2, '0');
    const biome = biomeAt(Math.floor(player.pos.x), Math.floor(player.pos.z));
    hud.textContent =
      `${fps} fps · ${RENDER_DIST} chunks` +
      `\nxyz ${player.pos.x.toFixed(1)} ${player.pos.y.toFixed(1)} ${player.pos.z.toFixed(1)}` +
      `\n${biome} · ${hh}:${mm}${isMuted() ? ' · muted' : ''}` +
      `\n${heldId() != null ? itemName(heldId()) : 'empty hand'}${creative ? ' · creative' : ''}${player.flying ? ' · flying' : ''}` +
      (net.active
        ? `\nroom ${net.code}${net.hosting ? ' (hosting)' : ''} · ${avatars.count() + 1} players`
        : '');
  }

  renderer.render(scene, camera);
}

animate();
