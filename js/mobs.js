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

function box(w, h, d, color, shade) {
  const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(shade) });
  return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
}

function buildModel(type) {
  const g = new THREE.Group();
  if (type === 'pig') {
    const body = box(0.55, 0.5, 0.95, 0xe89aa6, 1.0); body.position.set(0, 0.45, 0);
    const head = box(0.45, 0.42, 0.4, 0xefb0bb, 1.0); head.position.set(0, 0.5, -0.62);
    const snout = box(0.22, 0.18, 0.1, 0xd98494, 1.0); snout.position.set(0, 0.44, -0.85);
    for (const [dx, dz] of [[-0.18, -0.3], [0.18, -0.3], [-0.18, 0.3], [0.18, 0.3]]) {
      const leg = box(0.18, 0.3, 0.18, 0xcf8090, 0.85); leg.position.set(dx, 0.15, dz); g.add(leg);
    }
    g.add(body, head, snout);
  } else {
    const legs = box(0.5, 0.85, 0.3, 0x2f6b2f, 0.7);  legs.position.y = 0.42;
    const body = box(0.55, 0.7, 0.32, 0x3f7d3f, 0.95); body.position.y = 1.15;
    const head = box(0.5, 0.5, 0.5, 0x5a8f5a, 1.0);    head.position.y = 1.7;
    const arms = box(0.7, 0.25, 0.28, 0x3f7d3f, 0.9);  arms.position.set(0, 1.35, -0.28);
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0x111811 });
    for (const dx of [-0.12, 0.12]) {
      const e = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.08, 0.02), eyeMat);
      e.position.set(dx, 1.74, -0.26); g.add(e);
    }
    g.add(legs, body, head, arms);
  }
  return g;
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
    const group = buildModel(type);
    const hb = makeHealthBar();
    hb.sprite.position.y = def.h + 0.35;
    group.add(hb.sprite);
    scene.add(group);
    const mob = {
      type, w: def.w, h: def.h, hostile: def.hostile, speed: def.speed,
      hp: def.maxHp, maxHp: def.maxHp,
      pos: new THREE.Vector3(x, y, z), vel: new THREE.Vector3(),
      yaw: Math.random() * Math.PI * 2, onGround: false,
      wanderTimer: 0, wanderYaw: Math.random() * Math.PI * 2, moving: false,
      attackCd: 0, hurtT: 0, group, hb,
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
        if (mob.hurtT > 0) mob.hurtT -= dt;
        mob.group.position.copy(mob.pos);
        mob.group.rotation.y = mob.yaw;
        // Cheap hurt feedback: puff up briefly when struck.
        mob.group.scale.setScalar(mob.hurtT > 0 ? 1.12 : 1);
      }
    },
  };
}
