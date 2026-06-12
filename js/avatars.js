import * as THREE from 'three';

// Remote players: a blocky head/body/legs figure with a floating name tag,
// smoothly interpolated toward the last position received over the network.

function nameHue(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return h % 360;
}

function makeNameTag(name) {
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d');
  ctx.font = 'bold 28px monospace';
  c.width = Math.max(2, Math.ceil(ctx.measureText(name).width) + 20);
  c.height = 40;
  const ctx2 = c.getContext('2d');
  ctx2.fillStyle = 'rgba(0,0,0,0.45)';
  ctx2.fillRect(0, 0, c.width, c.height);
  ctx2.font = 'bold 28px monospace';
  ctx2.fillStyle = '#fff';
  ctx2.textAlign = 'center';
  ctx2.textBaseline = 'middle';
  ctx2.fillText(name, c.width / 2, c.height / 2 + 1);
  const tex = new THREE.CanvasTexture(c);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: tex, transparent: true, depthWrite: false, sizeAttenuation: true,
  }));
  sprite.scale.set(c.width / 70, c.height / 70, 1);
  return sprite;
}

function box(w, h, d, color, shade) {
  const mat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(color).multiplyScalar(shade),
  });
  return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
}

export function createAvatars(scene) {
  const map = new Map(); // id -> { group, target:{x,y,z,yaw}, name }

  function add(id, name) {
    if (map.has(id)) return;
    name = String(name || 'player').slice(0, 16);
    const color = new THREE.Color().setHSL(nameHue(name) / 360, 0.6, 0.5);
    const skin = new THREE.Color().setHSL(nameHue(name) / 360, 0.3, 0.65);

    const group = new THREE.Group();
    const legs = box(0.5, 0.7, 0.3, color, 0.55);
    legs.position.y = 0.35;
    const body = box(0.55, 0.7, 0.32, color, 0.9);
    body.position.y = 1.05;
    const head = box(0.5, 0.5, 0.5, skin, 1.0);
    head.position.y = 1.65;
    // Simple face so you can tell which way they look
    const eye = new THREE.MeshBasicMaterial({ color: 0x222233 });
    for (const dx of [-0.11, 0.11]) {
      const e = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 0.02), eye);
      e.position.set(dx, 1.7, -0.26);
      group.add(e);
    }
    const tag = makeNameTag(name);
    tag.position.y = 2.25;
    group.add(legs, body, head, tag);
    scene.add(group);
    map.set(id, { group, name, target: null });
  }

  function remove(id) {
    const a = map.get(id);
    if (!a) return;
    scene.remove(a.group);
    a.group.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        if (o.material.map) o.material.map.dispose();
        o.material.dispose();
      }
    });
    map.delete(id);
  }

  return {
    add,
    remove,
    count: () => map.size,
    clear() { for (const id of [...map.keys()]) remove(id); },
    setTarget(id, p) {
      if (!map.has(id)) add(id, 'player');
      const a = map.get(id);
      if (!a.target) { // first packet: snap, don't glide in from spawn
        a.group.position.set(p.x, p.y, p.z);
        a.group.rotation.y = p.yaw || 0;
      }
      a.target = { x: p.x, y: p.y, z: p.z, yaw: p.yaw || 0 };
    },
    update(dt) {
      const k = 1 - Math.exp(-12 * dt);
      for (const a of map.values()) {
        if (!a.target) continue;
        const g = a.group;
        g.position.x += (a.target.x - g.position.x) * k;
        g.position.y += (a.target.y - g.position.y) * k;
        g.position.z += (a.target.z - g.position.z) * k;
        let dy = a.target.yaw - g.rotation.y;
        dy = ((dy + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
        g.rotation.y += dy * k;
      }
    },
  };
}
