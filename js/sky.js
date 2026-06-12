import * as THREE from 'three';
import { SEED, WORLD_H } from './config.js';
import { mulberry32, smoothstep, clamp } from './noise.js';

const DAY_SKY = new THREE.Color(0x87ceeb);
const NIGHT_SKY = new THREE.Color(0x0a0e24);
const DUSK = new THREE.Color(0xff8a4d);

function squareSprite(size, draw) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const tex = new THREE.CanvasTexture(c);
  tex.magFilter = THREE.NearestFilter;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, fog: false, depthWrite: false });
  return new THREE.Sprite(mat);
}

export function createSky(scene) {
  const sun = squareSprite(64, (ctx) => {
    ctx.shadowColor = '#ffeebb';
    ctx.shadowBlur = 14;
    ctx.fillStyle = '#fdf2a0';
    ctx.fillRect(16, 16, 32, 32);
  });
  sun.scale.set(55, 55, 1);
  scene.add(sun);

  const moon = squareSprite(64, (ctx) => {
    ctx.fillStyle = '#e8e8f0';
    ctx.fillRect(20, 20, 24, 24);
    ctx.fillStyle = '#c9c9d6';
    ctx.fillRect(26, 24, 5, 5);
    ctx.fillRect(34, 33, 4, 4);
  });
  moon.scale.set(38, 38, 1);
  scene.add(moon);

  // Stars: fixed shell of points around the camera, fading in at night
  const rand = mulberry32(SEED ^ 0x57A125);
  const starPos = [];
  while (starPos.length < 500 * 3) {
    const x = rand() * 2 - 1, y = rand() * 2 - 1, z = rand() * 2 - 1;
    const len = Math.hypot(x, y, z);
    if (len < 0.2 || len > 1 || y / len < -0.1) continue;
    starPos.push((x / len) * 600, (y / len) * 600, (z / len) * 600);
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.Float32BufferAttribute(starPos, 3));
  const starMat = new THREE.PointsMaterial({
    size: 2, sizeAttenuation: false, color: 0xffffff,
    transparent: true, opacity: 0, fog: false, depthWrite: false,
  });
  const stars = new THREE.Points(starGeo, starMat);
  stars.frustumCulled = false;
  scene.add(stars);

  // Clouds: one big translucent plane following the camera
  const cc = document.createElement('canvas');
  cc.width = cc.height = 256;
  const cctx = cc.getContext('2d');
  cctx.fillStyle = 'rgba(255,255,255,0.9)';
  for (let i = 0; i < 60; i++) {
    cctx.fillRect(rand() * 256, rand() * 256, 10 + rand() * 30, 4 + rand() * 10);
  }
  const cloudTex = new THREE.CanvasTexture(cc);
  cloudTex.wrapS = cloudTex.wrapT = THREE.RepeatWrapping;
  cloudTex.repeat.set(6, 6);
  cloudTex.magFilter = THREE.NearestFilter;
  const cloudMat = new THREE.MeshBasicMaterial({
    map: cloudTex, transparent: true, opacity: 0.5, depthWrite: false,
    side: THREE.DoubleSide, fog: false,
  });
  const clouds = new THREE.Mesh(new THREE.PlaneGeometry(2000, 2000), cloudMat);
  clouds.rotation.x = -Math.PI / 2;
  clouds.position.y = WORLD_H + 24;
  scene.add(clouds);

  const sunDir = new THREE.Vector3();
  const sky = new THREE.Color();
  let lastCamX = null, lastCamZ = null;

  return {
    // t: time of day in [0,1); 0 = sunrise. Returns lighting info for materials/fog.
    update(dt, camera, t) {
      const angle = t * Math.PI * 2;
      sunDir.set(Math.cos(angle), Math.sin(angle), 0.35).normalize();
      const dayLight = smoothstep(-0.06, 0.22, sunDir.y);
      const glow = clamp(1 - Math.abs(sunDir.y) * 4, 0, 1) * smoothstep(-0.25, 0.05, sunDir.y);

      sky.lerpColors(NIGHT_SKY, DAY_SKY, dayLight);
      sky.lerp(DUSK, glow * 0.5);

      sun.position.copy(camera.position).addScaledVector(sunDir, 420);
      moon.position.copy(camera.position).addScaledVector(sunDir, -420);
      starMat.opacity = (1 - dayLight) * 0.9;
      stars.position.copy(camera.position);
      stars.rotation.z = -angle * 0.5;

      // Clouds track the camera; texture offset compensates so they stay world-fixed
      if (lastCamX !== null) {
        cloudTex.offset.x += (camera.position.x - lastCamX) * (6 / 2000);
        cloudTex.offset.y -= (camera.position.z - lastCamZ) * (6 / 2000);
      }
      lastCamX = camera.position.x; lastCamZ = camera.position.z;
      clouds.position.x = camera.position.x;
      clouds.position.z = camera.position.z;
      cloudTex.offset.x += dt * 0.002; // wind
      cloudMat.opacity = 0.12 + 0.42 * dayLight;

      return { dayLight, sky };
    },
  };
}
