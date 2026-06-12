import * as THREE from 'three';
import { B } from './blocks.js';
import { getBlock, isSolid, heightAt } from './world.js';

const GRAVITY = 26;
const JUMP_SPEED = 8.4;
const WALK_SPEED = 5.4;
const FLY_SPEED = 14;
export const PLAYER_W = 0.6;
export const PLAYER_H = 1.8;
export const EYE = 1.62;

export function playerAABB(pos) {
  const hw = PLAYER_W / 2;
  return {
    minX: pos.x - hw, maxX: pos.x + hw,
    minY: pos.y, maxY: pos.y + PLAYER_H,
    minZ: pos.z - hw, maxZ: pos.z + hw,
  };
}

function collides(pos) {
  const a = playerAABB(pos);
  for (let y = Math.floor(a.minY); y <= Math.floor(a.maxY); y++) {
    for (let z = Math.floor(a.minZ); z <= Math.floor(a.maxZ); z++) {
      for (let x = Math.floor(a.minX); x <= Math.floor(a.maxX); x++) {
        if (isSolid(getBlock(x, y, z))) return true;
      }
    }
  }
  return false;
}

export function createPlayer() {
  const player = {
    pos: new THREE.Vector3(8.5, heightAt(8, 8) + 2, 8.5),
    vel: new THREE.Vector3(),
    yaw: 0, pitch: 0,
    onGround: false,
    flying: false,
    sprinting: false,
    sneaking: false,
    stepDistance: 0,
  };

  function moveAxis(axis, amount) {
    if (amount === 0) return false;
    const prev = player.pos[axis];
    player.pos[axis] += amount;
    if (!collides(player.pos)) return false;
    // Hit something: back off, then advance in small steps to just touching
    player.pos[axis] = prev;
    const step = Math.sign(amount) * 0.02;
    let moved = 0;
    while (Math.abs(moved + step) <= Math.abs(amount)) {
      player.pos[axis] += step;
      if (collides(player.pos)) { player.pos[axis] -= step; break; }
      moved += step;
    }
    return true;
  }

  player.inWater = function () {
    return getBlock(
      Math.floor(player.pos.x),
      Math.floor(player.pos.y + 0.4),
      Math.floor(player.pos.z)
    ) === B.WATER;
  };

  player.blockBelow = function () {
    return getBlock(
      Math.floor(player.pos.x),
      Math.floor(player.pos.y - 0.5),
      Math.floor(player.pos.z)
    );
  };

  // Returns sound events: { step: blockId|null, land: blockId|null }
  player.update = function (dt, keys) {
    const events = { step: null, land: null };
    const forward = new THREE.Vector3(-Math.sin(player.yaw), 0, -Math.cos(player.yaw));
    const right = new THREE.Vector3(-forward.z, 0, forward.x);
    const move = new THREE.Vector3();
    if (keys['KeyW']) move.add(forward);
    if (keys['KeyS']) move.sub(forward);
    if (keys['KeyD']) move.add(right);
    if (keys['KeyA']) move.sub(right);
    if (move.lengthSq() > 0) move.normalize();

    player.sneaking = !player.flying && (keys['ShiftLeft'] || keys['ShiftRight']);
    if (!keys['KeyW'] || player.sneaking) player.sprinting = false;

    const swimming = player.inWater() && !player.flying;
    let speed = player.flying ? FLY_SPEED : WALK_SPEED;
    if (!player.flying) {
      if (swimming) speed *= 0.55;
      if (player.sneaking) speed *= 0.4;
      else if (player.sprinting) speed *= 1.65;
    }

    player.vel.x = move.x * speed;
    player.vel.z = move.z * speed;

    if (player.flying) {
      player.vel.y = 0;
      if (keys['Space']) player.vel.y = FLY_SPEED * 0.8;
      if (keys['ShiftLeft'] || keys['ShiftRight']) player.vel.y = -FLY_SPEED * 0.8;
    } else if (swimming) {
      player.vel.y -= GRAVITY * 0.25 * dt;
      player.vel.y = Math.max(player.vel.y, -3);
      if (keys['Space']) player.vel.y = 3.5;
    } else {
      player.vel.y -= GRAVITY * dt;
      player.vel.y = Math.max(player.vel.y, -50);
      if (keys['Space'] && player.onGround) {
        player.vel.y = JUMP_SPEED;
        player.onGround = false;
      }
    }

    const wasOnGround = player.onGround;
    const impact = player.vel.y;

    moveAxis('x', player.vel.x * dt);
    moveAxis('z', player.vel.z * dt);
    const hitY = moveAxis('y', player.vel.y * dt);
    if (hitY) {
      if (player.vel.y < 0) {
        player.onGround = true;
        if (!wasOnGround && impact < -9) events.land = player.blockBelow();
      }
      player.vel.y = 0;
    } else if (player.vel.y < -0.1) {
      player.onGround = false;
    }

    // Footsteps by distance walked
    if (player.onGround && !player.flying && dt > 0) {
      const hSpeed = Math.hypot(player.vel.x, player.vel.z);
      player.stepDistance += hSpeed * dt;
      if (hSpeed > 0.5 && player.stepDistance > 2.2) {
        player.stepDistance = 0;
        const below = player.blockBelow();
        if (below) events.step = below;
      }
    }

    // Safety: never fall through the world
    if (player.pos.y < -10) {
      player.pos.y = heightAt(Math.floor(player.pos.x), Math.floor(player.pos.z)) + 2;
      player.vel.y = 0;
    }
    return events;
  };

  return player;
}
