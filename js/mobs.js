import * as THREE from 'three';
import { getBlock, isSolid, heightAt } from './world.js';
import { WORLD_H } from './config.js';

// Simple creatures that share the player's voxel-AABB physics. Passive pigs
// wander in daylight; hostile zombies spawn at night and chase the player.
// Everything is local to this browser (not synced over multiplayer yet).

const GRAVITY = 26;
const MAX_MOBS = 10;
const DESPAWN_DIST = 60;

const TYPES = {
  pig:    { w: 0.9, h: 0.9, maxHp: 10, speed: 1.6,  hostile: false },
  zombie: { w: 0.6, h: 1.9, maxHp: 20, speed: 2.7,  hostile: true  },
};

// A coloured box that remembers its base colour, so we can flash it red on
// hit and restore it afterwards.
function box(w, h, d, color, shade = 1) {
  const base = new THREE.Color(color).multiplyScalar(shade);
  const mat = new THREE.MeshBasicMaterial({ color: base.clone() });
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.userData.base = base;
  return m;
}

// A limb that pivots from its top joint, so it can swing while walking.
// `px,py,pz` is the joint position; the limb hangs `h` below it.
function limb(w, h, d, color, shade, px, py, pz) {
  const grp = new THREE.Group();
  grp.position.set(px, py, pz);
  const m = box(w, h, d, color, shade);
  m.position.y = -h / 2;
  grp.add(m);
  return grp;
}

function buildModel(type) {
  const g = new THREE.Group();
  const legs = [];
  const arms = [];

  if (type === 'pig') {
    const PINK = 0xf2a6b3, PINK_D = 0xe089a0, SNOUT = 0xd9788f, HOOF = 0x6b3b46;
    const body = box(0.62, 0.56, 1.0, PINK);  body.position.set(0, 0.58, 0.04);
    const head = box(0.5, 0.48, 0.44, PINK);  head.position.set(0, 0.62, -0.62);
    const snout = box(0.28, 0.22, 0.12, SNOUT); snout.position.set(0, 0.54, -0.88);
    g.add(body, head, snout);
    // nostrils
    for (const dx of [-0.06, 0.06]) {
      const n = box(0.05, 0.07, 0.03, 0x7a3b4a); n.position.set(dx, 0.54, -0.945); g.add(n);
    }
    // eyes
    for (const dx of [-0.14, 0.14]) {
      const e = box(0.08, 0.1, 0.03, 0x1b1014); e.position.set(dx, 0.7, -0.845); g.add(e);
    }
    // ears
    for (const dx of [-0.17, 0.17]) {
      const ear = box(0.14, 0.14, 0.06, PINK_D); ear.position.set(dx, 0.9, -0.5);
      ear.rotation.x = -0.3; g.add(ear);
    }
    // legs (swing while walking)
    const lp = [[-0.2, -0.32], [0.2, -0.32], [-0.2, 0.34], [0.2, 0.34]];
    for (const [dx, dz] of lp) {
      const l = limb(0.18, 0.34, 0.18, HOOF, 1, dx, 0.34, dz);
      legs.push(l); g.add(l);
    }
  } else { // zombie
    const SKIN = 0x6aa84f, SKIN_D = 0x5c9444, SHIRT = 0x2f6f63, PANTS = 0x44506b;
    const body = box(0.5, 0.6, 0.28, SHIRT);  body.position.y = 1.18;
    const head = box(0.5, 0.5, 0.5, SKIN);    head.position.set(0, 1.73, 0);
    g.add(body, head);
    // sunken eyes + mouth
    for (const dx of [-0.13, 0.13]) {
      const e = box(0.12, 0.1, 0.03, 0x101510); e.position.set(dx, 1.78, -0.255); g.add(e);
    }
    const mouth = box(0.26, 0.06, 0.03, 0x1c2a18); mouth.position.set(0, 1.6, -0.255); g.add(mouth);
    // arms outstretched forward (classic zombie), swing slightly
    for (const dx of [-0.34, 0.34]) {
      const a = limb(0.18, 0.6, 0.22, SKIN_D, 1, dx, 1.45, -0.04);
      a.rotation.x = -1.45;            // reach forward
      arms.push(a); g.add(a);
    }
    // two legs (swing while walking)
    for (const dx of [-0.13, 0.13]) {
      const l = limb(0.22, 0.85, 0.26, PANTS, 1, dx, 0.85, 0);
      legs.push(l); g.add(l);
    }
  }
  return { group: g, legs, arms };
}

function makeHealthBar() {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 8;
  const tex = new THREE.CanvasTexture(c);
  tex.magFilter = THREE.NearestFilter;
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false }));
  spr.scale.set(1.0, 0.125, 1);
  function draw(frac) {
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, 64, 8);
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, 64, 8);
    ctx.fillStyle = '#c0392b'; ctx.fillRect(1, 1, 62, 6);
    ctx.fillStyle = '#2ecc40'; ctx.fillRect(1, 1, Math.round(62 * Math.max(0, frac)), 6);
    tex.needsUpdate = true;
  }
  draw(1);
  return { sprite: spr, draw };
}

export function createMobs(scene) {
  const mobs = [];
  let spawnTimer = 0;
  const tmp = new THREE.Vector3();

  function aabb(pos, w, h) {
    const hw = w / 2;
    return { minX: pos.x - hw, maxX: pos.x + hw, minY: pos.y, maxY: pos.y + h, minZ: pos.z - hw, maxZ: pos.z + hw };
  }
  function collides(pos, w, h) {
    const a = aabb(pos, w, h);
    for (let y = Math.floor(a.minY); y <= Math.floor(a.maxY); y++)
      for (let z = Math.floor(a.minZ); z <= Math.floor(a.maxZ); z++)
        for (let x = Math.floor(a.minX); x <= Math.floor(a.maxX); x++)
          if (isSolid(getBlock(x, y, z))) return true;
    return false;
  }
  function moveAxis(mob, axis, amount) {
    if (amount === 0) return false;
    const prev = mob.pos[axis];
    mob.pos[axis] += amount;
    if (!collides(mob.pos, mob.w, mob.h)) return false;
    mob.pos[axis] = prev;
    const step = Math.sign(amount) * 0.05;
    let moved = 0;
    while (Math.abs(moved + step) <= Math.abs(amount)) {
      mob.pos[axis] += step;
      if (collides(mob.pos, mob.w, mob.h)) { mob.pos[axis] -= step; break; }
      moved += step;
    }
    return true;
  }

  function spawn(type, x, y, z) {
    const def = TYPES[type];
    const model = buildModel(type);
    const group = model.group;
    const hb = makeHealthBar();
    hb.sprite.position.y = def.h + 0.35;
    group.add(hb.sprite);
    scene.add(group);
    const skin = [];
    group.traverse(o => { if (o.isMesh && o.userData.base) skin.push(o); });
    const mob = {
      type, w: def.w, h: def.h, hostile: def.hostile, speed: def.speed,
      hp: def.maxHp, maxHp: def.maxHp,
      pos: new THREE.Vector3(x, y, z), vel: new THREE.Vector3(),
      yaw: Math.random() * Math.PI * 2, onGround: false,
      wanderTimer: 0, wanderYaw: Math.random() * Math.PI * 2, moving: false,
      attackCd: 0, hurtT: 0, group, hb,
      legs: model.legs, arms: model.arms, skin, walkPhase: Math.random() * 6.28,
    };
    mobs.push(mob);
  }

  function surfaceSpawnY(x, z) {
    let y = heightAt(x, z) + 1;
    y = Math.min(y, WORLD_H - 3);
    // need 2 blocks of air above a solid floor
    if (isSolid(getBlock(x, y, z)) || isSolid(getBlock(x, y + 1, z))) return null;
    if (!isSolid(getBlock(x, y - 1, z))) return null;
    return y;
  }

  function trySpawn(player, night) {
    if (mobs.length >= MAX_MOBS) return;
    const ang = Math.random() * Math.PI * 2;
    const r = 16 + Math.random() * 16;
    const x = Math.floor(player.pos.x + Math.cos(ang) * r);
    const z = Math.floor(player.pos.z + Math.sin(ang) * r);
    const y = surfaceSpawnY(x, z);
    if (y == null) return;
    const passiveCount = mobs.filter(m => !m.hostile).length;
    const hostileCount = mobs.filter(m => m.hostile).length;
    if (night) {
      if (hostileCount < 6) spawn('zombie', x + 0.5, y, z + 0.5);
    } else {
      if (passiveCount < 5) spawn('pig', x + 0.5, y, z + 0.5);
    }
  }

  function removeMob(i) {
    const m = mobs[i];
    scene.remove(m.group);
    m.group.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); }
    });
    mobs.splice(i, 1);
  }

  // Push a mob and flash it red; returns true if the hit killed it.
  function damageMob(mob, dmg, fromX, fromZ) {
    mob.hp -= dmg;
    mob.hurtT = 0.25;
    const dx = mob.pos.x - fromX, dz = mob.pos.z - fromZ;
    const len = Math.hypot(dx, dz) || 1;
    mob.vel.x += (dx / len) * 6;
    mob.vel.z += (dz / len) * 6;
    mob.vel.y = Math.max(mob.vel.y, 4);
    if (mob.hostile) { mob.aggro = true; }
    mob.hb.draw(mob.hp / mob.maxHp);
    if (mob.hp <= 0) {
      const idx = mobs.indexOf(mob);
      if (idx >= 0) removeMob(idx);
      return true;
    }
    return false;
  }

  // Ray vs mob AABBs (slab test). Returns the nearest mob within maxDist.
  function pickMob(origin, dir, maxDist) {
    let best = null, bestT = maxDist;
    for (const mob of mobs) {
      const a = aabb(mob.pos, mob.w + 0.2, mob.h);
      let tmin = 0, tmax = bestT, hit = true;
      for (const ax of ['x', 'y', 'z']) {
        const lo = (a['min' + ax.toUpperCase()] - origin[ax]) / dir[ax];
        const hi = (a['max' + ax.toUpperCase()] - origin[ax]) / dir[ax];
        const t1 = Math.min(lo, hi), t2 = Math.max(lo, hi);
        tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
        if (tmin > tmax) { hit = false; break; }
      }
      if (hit && tmin >= 0 && tmin < bestT) { bestT = tmin; best = mob; }
    }
    return best ? { mob: best, dist: bestT } : null;
  }

  return {
    mobs,
    pickMob,
    damageMob,
    count: () => mobs.length,
    clear() { while (mobs.length) removeMob(0); },

    update(dt, player, night, hurtPlayer) {
      spawnTimer -= dt;
      if (spawnTimer <= 0) { spawnTimer = 1.5; trySpawn(player, night); }

      for (let i = mobs.length - 1; i >= 0; i--) {
        const mob = mobs[i];
        const distToPlayer = mob.pos.distanceTo(player.pos);

        // Despawn far mobs, and hostiles caught in daylight.
        if (distToPlayer > DESPAWN_DIST || (mob.hostile && !night && !mob.aggro)) {
          removeMob(i);
          continue;
        }

        // --- decide movement ---
        let speed = mob.speed;
        mob.moving = true;
        if (mob.hostile && (distToPlayer < 18 || mob.aggro)) {
          mob.yaw = Math.atan2(player.pos.x - mob.pos.x, player.pos.z - mob.pos.z);
        } else {
          mob.wanderTimer -= dt;
          if (mob.wanderTimer <= 0) {
            mob.wanderTimer = 2 + Math.random() * 3;
            mob.wanderYaw = Math.random() * Math.PI * 2;
            mob.moving = Math.random() < 0.7;
          }
          mob.yaw = mob.wanderYaw;
          speed *= 0.6;
        }

        const fwdX = Math.sin(mob.yaw), fwdZ = Math.cos(mob.yaw);
        mob.vel.x = mob.moving ? fwdX * speed : mob.vel.x * 0.6;
        mob.vel.z = mob.moving ? fwdZ * speed : mob.vel.z * 0.6;

        // gravity
        mob.vel.y -= GRAVITY * dt;
        mob.vel.y = Math.max(mob.vel.y, -50);

        const hitX = moveAxis(mob, 'x', mob.vel.x * dt);
        const hitZ = moveAxis(mob, 'z', mob.vel.z * dt);
        const hitY = moveAxis(mob, 'y', mob.vel.y * dt);
        if (hitY) {
          if (mob.vel.y < 0) mob.onGround = true;
          mob.vel.y = 0;
        } else if (mob.vel.y < -0.1) {
          mob.onGround = false;
        }
        // Hop over a 1-block step when walking into a wall.
        if ((hitX || hitZ) && mob.onGround && mob.moving) {
          mob.vel.y = 7.5; mob.onGround = false;
        }
        if (mob.pos.y < -20) { removeMob(i); continue; }

        // --- attack the player ---
        mob.attackCd -= dt;
        if (mob.hostile && distToPlayer < 1.5 && mob.attackCd <= 0) {
          mob.attackCd = 1.0;
          hurtPlayer(4, mob.pos.x, mob.pos.z);
        }

        // --- visuals ---
        mob.group.position.copy(mob.pos);
        mob.group.rotation.y = mob.yaw;

        // Walk cycle: swing legs (and the zombie's arms) when actually moving.
        const hSpeed = Math.hypot(mob.vel.x, mob.vel.z);
        if (mob.moving && hSpeed > 0.3 && mob.onGround) {
          mob.walkPhase += dt * (6 + hSpeed * 1.5);
        }
        const swing = (mob.moving && mob.onGround) ? Math.sin(mob.walkPhase) * 0.6 : 0;
        for (let li = 0; li < mob.legs.length; li++) {
          mob.legs[li].rotation.x = (li % 2 === 0 ? swing : -swing);
        }
        for (const a of mob.arms) {
          a.rotation.x = -1.45 + Math.sin(mob.walkPhase) * 0.12; // small reaching sway
        }

        // Hit feedback: flash the whole body red and puff up briefly.
        if (mob.hurtT > 0) {
          mob.hurtT -= dt;
          for (const m of mob.skin) m.material.color.setRGB(1, 0.25, 0.2);
          mob.group.scale.setScalar(1.12);
        } else if (mob.wasHurt) {
          for (const m of mob.skin) m.material.color.copy(m.userData.base);
          mob.group.scale.setScalar(1);
        }
        mob.wasHurt = mob.hurtT > 0;
      }
    },
  };
}
