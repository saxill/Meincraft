import * as THREE from 'three';

const MAX = 400;
const GRAVITY = 18;

export function createParticles(scene) {
  const geo = new THREE.BufferGeometry();
  const posAttr = new THREE.BufferAttribute(new Float32Array(MAX * 3), 3);
  const colAttr = new THREE.BufferAttribute(new Float32Array(MAX * 3), 3);
  posAttr.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('position', posAttr);
  geo.setAttribute('color', colAttr);
  geo.setDrawRange(0, 0);

  const material = new THREE.PointsMaterial({ size: 0.14, vertexColors: true });
  const points = new THREE.Points(geo, material);
  points.frustumCulled = false;
  scene.add(points);

  const live = []; // {x,y,z,vx,vy,vz,life,r,g,b}

  return {
    material,
    // color: [r,g,b] in 0..1 (typically the broken block's average tile color)
    burst(bx, by, bz, color, count = 14) {
      for (let i = 0; i < count && live.length < MAX; i++) {
        const tint = 0.85 + Math.random() * 0.3;
        live.push({
          x: bx + 0.2 + Math.random() * 0.6,
          y: by + 0.2 + Math.random() * 0.6,
          z: bz + 0.2 + Math.random() * 0.6,
          vx: (Math.random() - 0.5) * 3.4,
          vy: Math.random() * 3 + 1.2,
          vz: (Math.random() - 0.5) * 3.4,
          life: 0.45 + Math.random() * 0.35,
          r: Math.min(1, color[0] * tint),
          g: Math.min(1, color[1] * tint),
          b: Math.min(1, color[2] * tint),
        });
      }
    },
    update(dt) {
      if (live.length === 0 && geo.drawRange.count === 0) return;
      for (let i = live.length - 1; i >= 0; i--) {
        const p = live[i];
        p.life -= dt;
        if (p.life <= 0) { live.splice(i, 1); continue; }
        p.vy -= GRAVITY * dt;
        p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      }
      for (let i = 0; i < live.length; i++) {
        posAttr.setXYZ(i, live[i].x, live[i].y, live[i].z);
        colAttr.setXYZ(i, live[i].r, live[i].g, live[i].b);
      }
      posAttr.needsUpdate = true;
      colAttr.needsUpdate = true;
      geo.setDrawRange(0, live.length);
    },
  };
}
