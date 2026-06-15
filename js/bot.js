import * as THREE from 'three';
import { getBlock, setBlock, isSolid, raycast } from './world.js';
import { AIR, B, BLOCKS } from './blocks.js';
import { WORLD_H } from './config.js';
import { miningTime, mobDrop } from './items.js';

// A local "companion bot" — a player-shaped entity that joins your world and
// plays *with* you: follows, mines blocks for you, fights hostiles, or just
// wanders. It reuses the same voxel-AABB physics as mobs/player and the same
// world.setBlock + net path for edits, so its actions save and sync exactly
// like yours.
//
// SECURITY: this is 100% local — no network calls, no API key, no secrets, no
// eval. Commands come from a chat box parsed as a fixed KEYWORD ALLOWLIST
// (see command()); nothing the user types is ever executed as code, and all
// chat text reaches the DOM via textContent (handled by the caller). Its
// world edits go through the player's own setBlock/net.sendEdit path, so it
// can't corrupt the save shape or add new network messages.

const GRAVITY = 26;
const BOT_W = 0.6, BOT_H = 1.8;
const BOT_SPEED = 4.6;          // a touch under the player's sprint so it keeps up
const FOLLOW_NEAR = 3.2;        // stop closing in once this near the player
const FOLLOW_FAR = 24;          // beyond this, hop straight to the player's side
const COME_NEAR = 1.9;
const MINE_RADIUS = 6;          // search box half-extent for "mine X"
const MINE_REACH = 2.7;         // how close it must be to break a block
const MINE_QUOTA = 16;          // blocks per "mine X" command (no world-stripping)
const ATTACK_RANGE = 2.1;
const ATTACK_CD = 0.7;
const BOT_DAMAGE = 5;           // half-hearts per hit (between fist and sword)
const FIGHT_SEEK = 18;          // how far it'll look for a hostile to fight
const STUCK_LIMIT = 5;          // seconds trying to reach a block before skipping it

// "mine X" keyword -> block id. Only these are mineable on command.
const MINE_TARGETS = {
  wood: B.LOG, log: B.LOG, logs: B.LOG, tree: B.LOG, trees: B.LOG,
  stone: B.STONE, rock: B.STONE, cobble: B.COBBLE, cobblestone: B.COBBLE,
  dirt: B.DIRT, sand: B.SAND,
  coal: B.COAL, iron: B.IRON, gold: B.GOLD, diamond: B.DIAMOND, diamonds: B.DIAMOND,
  leaves: B.LEAVES, glass: B.GLASS,
};

function box(w, h, d, color, shade = 1) {
  const base = new THREE.Color(color).multiplyScalar(shade);
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d),
    new THREE.MeshBasicMaterial({ color: base }));
  return m;
}

// A limb pivoting from its top joint so it can swing while walking / mining.
function limb(w, h, d, color, shade, px, py, pz) {
  const grp = new THREE.Group();
  grp.position.set(px, py, pz);
  const m = box(w, h, d, color, shade);
  m.position.y = -h / 2;
  grp.add(m);
  return grp;
}

function makeNameTag(name) {
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d');
  ctx.font = 'bold 28px monospace';
  c.width = Math.max(2, Math.ceil(ctx.measureText(name).width) + 20);
  c.height = 40;
  const x = c.getContext('2d');
  x.fillStyle = 'rgba(0,0,0,0.45)';
  x.fillRect(0, 0, c.width, c.height);
  x.font = 'bold 28px monospace';
  x.fillStyle = '#d9b3ff';
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.fillText(name, c.width / 2, c.height / 2 + 1);
  const tex = new THREE.CanvasTexture(c);
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({
    map: tex, transparent: true, depthWrite: false,
  }));
  spr.scale.set(c.width / 70, c.height / 70, 1);
  return spr;
}

function buildBody(name) {
  const g = new THREE.Group();
  const COAT = 0x6b3fa0, COAT_D = 0x553084, SKIN = 0xe8b89a, HAIR = 0x2a1830;
  const body = box(0.55, 0.7, 0.32, COAT); body.position.y = 1.05;
  const head = box(0.5, 0.5, 0.5, SKIN);   head.position.y = 1.65;
  const hair = box(0.54, 0.18, 0.54, HAIR); hair.position.y = 1.86;
  g.add(body, head, hair);
  for (const dx of [-0.11, 0.11]) {
    const e = box(0.09, 0.09, 0.02, 0x241a2e); e.position.set(dx, 1.7, -0.26); g.add(e);
  }
  const legs = [];
  for (const dx of [-0.13, 0.13]) {
    const l = limb(0.22, 0.7, 0.28, COAT_D, 1, dx, 0.7, 0);
    legs.push(l); g.add(l);
  }
  const arms = [];
  for (const dx of [-0.34, 0.34]) {
    const a = limb(0.16, 0.6, 0.22, COAT, 1, dx, 1.4, 0);
    arms.push(a); g.add(a);
  }
  const tag = makeNameTag(name);
  tag.position.y = 2.3;
  g.add(tag);
  return { group: g, legs, arms };
}

export function createBot(scene, hooks = {}) {
  // hooks (all optional, provided by game.js):
  //   onEdit(x,y,z,id)   -> net.sendEdit (sync + persist the edit)
  //   onBreak(x,y,z,id)  -> particles + sound + drop the block to the player
  //   onKill(type)       -> reward the player a mob's drop
  //   getMobs()          -> live array of mobs (for fighting)
  //   damageMob(mob,dmg,fromX,fromZ) -> returns true if the hit killed it
  //   say(text)          -> show a line in the companion chat log
  const NAME = hooks.name || 'Zara';
  let built = null;       // { group, legs, arms } once spawned
  const bot = {
    active: false,
    mode: 'follow',
    pos: new THREE.Vector3(),
    vel: new THREE.Vector3(),
    yaw: 0,
    onGround: false,
    moving: false,
    walkPhase: 0,
    // mining state
    targetId: null,
    mineBlock: null,
    mineTimer: 0,
    mineTotal: 0,
    quota: 0,
    reachT: 0,
    skip: new Set(),
    // combat state
    attackCd: 0,
  };

  function say(t) { if (hooks.say) hooks.say(t); }

  // ---- physics (mirrors js/mobs.js) ----
  function aabb(pos) {
    const hw = BOT_W / 2;
    return {
      minX: pos.x - hw, maxX: pos.x + hw,
      minY: pos.y, maxY: pos.y + BOT_H,
      minZ: pos.z - hw, maxZ: pos.z + hw,
    };
  }
  function collides(pos) {
    const a = aabb(pos);
    for (let y = Math.floor(a.minY); y <= Math.floor(a.maxY); y++)
      for (let z = Math.floor(a.minZ); z <= Math.floor(a.maxZ); z++)
        for (let x = Math.floor(a.minX); x <= Math.floor(a.maxX); x++)
          if (isSolid(getBlock(x, y, z))) return true;
    return false;
  }
  function moveAxis(axis, amount) {
    if (amount === 0) return false;
    const prev = bot.pos[axis];
    bot.pos[axis] += amount;
    if (!collides(bot.pos)) return false;
    bot.pos[axis] = prev;
    const step = Math.sign(amount) * 0.05;
    let moved = 0;
    while (Math.abs(moved + step) <= Math.abs(amount)) {
      bot.pos[axis] += step;
      if (collides(bot.pos)) { bot.pos[axis] -= step; break; }
      moved += step;
    }
    return true;
  }

  // Find a standing spot (solid floor, 2 air above) near a point.
  function placeNear(px, py, pz) {
    const ring = [[2, 0], [-2, 0], [0, 2], [0, -2], [3, 1], [-3, -1], [1, 3], [-1, -3]];
    for (const [ox, oz] of ring) {
      const x = Math.floor(px + ox), z = Math.floor(pz + oz);
      for (let y = Math.floor(py) + 3; y > Math.floor(py) - 5; y--) {
        if (isSolid(getBlock(x, y - 1, z)) &&
            !isSolid(getBlock(x, y, z)) && !isSolid(getBlock(x, y + 1, z))) {
          bot.pos.set(x + 0.5, y, z + 0.5);
          bot.vel.set(0, 0, 0);
          return true;
        }
      }
    }
    bot.pos.set(px, py, pz);
    bot.vel.set(0, 0, 0);
    return false;
  }

  function steerTo(tx, tz, speed) {
    const dx = tx - bot.pos.x, dz = tz - bot.pos.z;
    const d = Math.hypot(dx, dz) || 1;
    bot.yaw = Math.atan2(dx, dz);
    bot.vel.x = (dx / d) * speed;
    bot.vel.z = (dz / d) * speed;
    bot.moving = true;
  }
  function halt() {
    bot.vel.x *= 0.6;
    bot.vel.z *= 0.6;
    bot.moving = false;
  }

  // Nearest block of `id` within the search box, skipping unreachable ones.
  function findBlock(id) {
    const bx = Math.floor(bot.pos.x), by = Math.floor(bot.pos.y), bz = Math.floor(bot.pos.z);
    let best = null, bestD = Infinity;
    for (let dy = 2; dy >= -3; dy--)
      for (let dx = -MINE_RADIUS; dx <= MINE_RADIUS; dx++)
        for (let dz = -MINE_RADIUS; dz <= MINE_RADIUS; dz++) {
          const x = bx + dx, y = by + dy, z = bz + dz;
          if (y < 1 || y >= WORLD_H) continue;
          if (getBlock(x, y, z) !== id) continue;
          if (bot.skip.has(x + ',' + y + ',' + z)) continue;
          const d = dx * dx + dy * dy * 1.4 + dz * dz;
          if (d < bestD) { bestD = d; best = { x, y, z }; }
        }
    return best;
  }

  function breakBlock(mb) {
    const id = getBlock(mb.x, mb.y, mb.z);
    if (id === AIR || (BLOCKS[id] && BLOCKS[id].unbreakable)) return;
    setBlock(mb.x, mb.y, mb.z, AIR);
    if (hooks.onEdit) hooks.onEdit(mb.x, mb.y, mb.z, AIR);
    if (hooks.onBreak) hooks.onBreak(mb.x, mb.y, mb.z, id);
  }

  // ---- per-frame behaviour ----
  function step(dt, player) {
    bot.attackCd -= dt;

    if (bot.mode === 'follow' || bot.mode === 'come') {
      const near = bot.mode === 'come' ? COME_NEAR : FOLLOW_NEAR;
      const d = bot.pos.distanceTo(player.pos);
      if (d > FOLLOW_FAR) { placeNear(player.pos.x, player.pos.y, player.pos.z); }
      else if (d > near) { steerTo(player.pos.x, player.pos.z, BOT_SPEED); }
      else { halt(); if (bot.mode === 'come') { bot.mode = 'follow'; say('here! 🙂'); } }

    } else if (bot.mode === 'stop') {
      halt();

    } else if (bot.mode === 'wander') {
      bot.wanderT = (bot.wanderT || 0) - dt;
      if (bot.wanderT <= 0) {
        bot.wanderT = 2 + Math.random() * 3;
        bot.wanderYaw = Math.random() * Math.PI * 2;
        bot.wanderMove = Math.random() < 0.7;
      }
      if (bot.wanderMove) steerTo(
        bot.pos.x + Math.sin(bot.wanderYaw), bot.pos.z + Math.cos(bot.wanderYaw),
        BOT_SPEED * 0.55); else halt();
      // don't stray too far from the player
      if (bot.pos.distanceTo(player.pos) > FOLLOW_FAR) steerTo(player.pos.x, player.pos.z, BOT_SPEED);

    } else if (bot.mode === 'mine') {
      if (!bot.mineBlock || getBlock(bot.mineBlock.x, bot.mineBlock.y, bot.mineBlock.z) !== bot.targetId) {
        bot.mineBlock = findBlock(bot.targetId);
        bot.mineTimer = 0;
        bot.reachT = 0;
        if (!bot.mineBlock) {
          say(`can't find any more of that nearby — back to following.`);
          bot.mode = 'follow'; bot.skip.clear();
          return;
        }
        bot.mineTotal = Math.min(2.4, Math.max(0.35, miningTime(bot.targetId, null) * 0.35));
      }
      const mb = bot.mineBlock;
      const cx = bot.pos.x, cy = bot.pos.y + 1.0, cz = bot.pos.z;
      const dist = Math.hypot(mb.x + 0.5 - cx, mb.y + 0.5 - cy, mb.z + 0.5 - cz);
      if (dist > MINE_REACH) {
        steerTo(mb.x + 0.5, mb.z + 0.5, BOT_SPEED);
        bot.mineTimer = 0;
        bot.reachT += dt;
        if (bot.reachT > STUCK_LIMIT) {        // give up on an unreachable block
          bot.skip.add(mb.x + ',' + mb.y + ',' + mb.z);
          bot.mineBlock = null;
        }
      } else {
        halt();
        bot.reachT = 0;
        bot.yaw = Math.atan2(mb.x + 0.5 - cx, mb.z + 0.5 - cz);
        bot.mineTimer += dt;
        if (bot.mineTimer >= bot.mineTotal) {
          breakBlock(mb);
          bot.mineBlock = null;
          bot.mineTimer = 0;
          bot.quota--;
          if (bot.quota <= 0) {
            say(`done mining 👍`);
            bot.mode = 'follow'; bot.skip.clear();
          }
        }
      }

    } else if (bot.mode === 'fight') {
      const list = hooks.getMobs ? hooks.getMobs() : [];
      let tgt = null, bestD = FIGHT_SEEK;
      for (const m of list) {
        if (!m.hostile) continue;
        const d = bot.pos.distanceTo(m.pos);
        if (d < bestD) { bestD = d; tgt = m; }
      }
      if (!tgt) {
        // nothing to fight: stay near the player
        const d = bot.pos.distanceTo(player.pos);
        if (d > FOLLOW_NEAR) steerTo(player.pos.x, player.pos.z, BOT_SPEED); else halt();
      } else {
        const d = bot.pos.distanceTo(tgt.pos);
        if (d > ATTACK_RANGE) { steerTo(tgt.pos.x, tgt.pos.z, BOT_SPEED); }
        else {
          halt();
          bot.yaw = Math.atan2(tgt.pos.x - bot.pos.x, tgt.pos.z - bot.pos.z);
          if (bot.attackCd <= 0 && hooks.damageMob) {
            bot.attackCd = ATTACK_CD;
            const killed = hooks.damageMob(tgt, BOT_DAMAGE, bot.pos.x, bot.pos.z);
            if (killed && hooks.onKill) hooks.onKill(tgt.type);
          }
        }
      }
    }

    // ---- apply physics ----
    bot.vel.y -= GRAVITY * dt;
    bot.vel.y = Math.max(bot.vel.y, -50);
    const hx = moveAxis('x', bot.vel.x * dt);
    const hz = moveAxis('z', bot.vel.z * dt);
    const hy = moveAxis('y', bot.vel.y * dt);
    if (hy) { if (bot.vel.y < 0) bot.onGround = true; bot.vel.y = 0; }
    else if (bot.vel.y < -0.1) bot.onGround = false;
    if ((hx || hz) && bot.onGround && bot.moving) { bot.vel.y = 7.5; bot.onGround = false; }
    if (!bot.moving) { bot.vel.x *= 0.6; bot.vel.z *= 0.6; }
    if (bot.pos.y < -30) placeNear(player.pos.x, player.pos.y, player.pos.z);
  }

  // ---- public API ----
  return {
    get active() { return bot.active; },
    get pos() { return bot.pos; },

    // Summon next to the player (or dismiss if already out). Returns new state.
    toggle(player) {
      if (bot.active) { this.despawn(); return false; }
      built = buildBody(NAME);
      scene.add(built.group);
      bot.active = true;
      bot.mode = 'follow';
      bot.skip.clear();
      placeNear(player.pos.x, player.pos.y + 1, player.pos.z);
      say(`hey ${player ? '' : ''}— I'm here. Press T to talk. Try "mine wood", "fight", or "stop".`);
      return true;
    },

    despawn() {
      if (!bot.active) return;
      bot.active = false;
      if (built) {
        scene.remove(built.group);
        built.group.traverse(o => {
          if (o.geometry) o.geometry.dispose();
          if (o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); }
        });
        built = null;
      }
      say('see you 👋');
    },

    // Parse a chat line as a KEYWORD command. Never executes user input as code.
    command(raw) {
      if (!bot.active) { say('(summon me first with B)'); return; }
      const text = String(raw || '').toLowerCase().trim().slice(0, 120);
      if (!text) return;

      if (/\b(stop|halt|wait|stay|chill)\b/.test(text)) {
        bot.mode = 'stop'; say('holding position. 🛑'); return;
      }
      if (/\b(follow|come|here|with me|to me)\b/.test(text)) {
        bot.mode = 'come'; say('on my way!'); return;
      }
      if (/\b(wander|explore|roam|look around)\b/.test(text)) {
        bot.mode = 'wander'; say('having a wander 🚶'); return;
      }
      if (/\b(fight|attack|defend|kill|protect|guard)\b/.test(text)) {
        bot.mode = 'fight'; say('got your back ⚔️'); return;
      }
      const m = text.match(/\b(mine|dig|chop|gather|get|grab|collect)\b\s+(?:some\s+|the\s+|me\s+)?([a-z]+)/);
      if (m) {
        const key = m[2];
        const id = MINE_TARGETS[key] ?? MINE_TARGETS[key.replace(/s$/, '')];
        if (id == null) {
          say(`not sure what "${key}" is — try wood, stone, dirt, sand, coal, iron, gold, diamond.`);
          return;
        }
        bot.targetId = id;
        bot.mineBlock = null;
        bot.quota = MINE_QUOTA;
        bot.skip.clear();
        bot.mode = 'mine';
        say(`mining ${key} for you ⛏️`);
        return;
      }
      if (/\b(hi|hello|hey|yo|zara|sup)\b/.test(text)) {
        say('hey! I can follow, come, stop, wander, fight, or "mine wood/stone/dirt/coal…".');
        return;
      }
      say('try: follow · come · stop · wander · fight · "mine wood" (or stone/dirt/sand/coal/iron/gold/diamond).');
    },

    update(dt, player) {
      if (!bot.active || !built) return;
      step(dt, player);

      built.group.position.copy(bot.pos);
      built.group.rotation.y = bot.yaw;

      // walk cycle + mining arm swing
      const hSpeed = Math.hypot(bot.vel.x, bot.vel.z);
      if (bot.moving && hSpeed > 0.3 && bot.onGround) bot.walkPhase += dt * (6 + hSpeed * 1.5);
      const swing = (bot.moving && bot.onGround) ? Math.sin(bot.walkPhase) * 0.55 : 0;
      for (let i = 0; i < built.legs.length; i++) built.legs[i].rotation.x = (i % 2 === 0 ? swing : -swing);
      const mining = bot.mode === 'mine' && bot.mineBlock && bot.reachT === 0 && bot.mineTimer > 0;
      const chop = mining ? -1.2 - Math.abs(Math.sin(performance.now() * 0.012)) * 0.6 : swing * 0.6;
      for (const a of built.arms) a.rotation.x = chop;
    },
  };
}
