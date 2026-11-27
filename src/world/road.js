// 道路与环境：按主题生成地面、路边景物、远景
import * as THREE from 'three';
import { CONFIG } from '../core/config.js';
import { toon, mesh, outline, makeCanvasTexture } from './materials.js';
import { makeRng } from '../core/utils.js';

const ROAD_LEN = 900;
const ROAD_Z_START = 60;

/**
 * @param {THREE.Scene} scene
 * @param {object} theme  THEMES 里的一项
 */
export function buildRoad(scene, theme) {
  const root = new THREE.Group();
  const { roadHalf, laneX } = CONFIG;
  const rng = makeRng(20241127);
  const T = theme;

  const disposables = [];

  /* ── 地面 ── */
  // 地面做得极大，边缘落在雾外，避免出现矩形边界
  const GROUND_SIZE = 3000;
  const ground = mesh(new THREE.PlaneGeometry(GROUND_SIZE, GROUND_SIZE), toon(T.ground.base), {
    cast: false, receive: false,
  });
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(0, -0.07, -ROAD_LEN / 2);
  root.add(ground);

  // 海边不需要草地条纹（海面覆盖），其余主题保留
  if (!T.water?.enabled) {
    const stripeMat = toon(T.ground.stripe);
    for (let i = 0; i < 40; i++) {
      const st = mesh(new THREE.PlaneGeometry(900, 11), stripeMat, {
        cast: false, receive: true,
      });
      st.rotation.x = -Math.PI / 2;
      st.position.set(0, -0.05, ROAD_Z_START - i * 22);
      root.add(st);
    }
  }

  /* ── 海边：水面 ── */
  if (T.water?.enabled) {
    const waterMat = new THREE.MeshStandardMaterial({
      color: T.water.color,
      roughness: 0.30,
      metalness: 0.18,
    });
    disposables.push(waterMat);

    for (const s of [-1, 1]) {
      // 海从沙滩外沿（约 14m）一直延伸到远处
      const sea = new THREE.Mesh(new THREE.PlaneGeometry(420, ROAD_LEN), waterMat);
      sea.rotation.x = -Math.PI / 2;
      sea.position.set(s * (14 + 210), -0.035, ROAD_Z_START - ROAD_LEN / 2);
        root.add(sea);

      // 岸边浪花：细长条，只贴在水陆交界
      for (let i = 0; i < 28; i++) {
        const foamMat = new THREE.MeshBasicMaterial({
          color: T.water.foam, transparent: true, opacity: 0.62, depthWrite: false,
        });
        disposables.push(foamMat);
        const foam = mesh(
          new THREE.PlaneGeometry(0.7 + rng() * 0.7, 5.5 + rng() * 4.5),
          foamMat,
          { cast: false, receive: false }
        );
        foam.rotation.x = -Math.PI / 2;
        foam.position.set(s * (13.4 + rng() * 0.7), -0.008, ROAD_Z_START - i * 32 - rng() * 16);
        root.add(foam);
      }
    }

    const sandMat = toon(0xead9b4);
    for (const s of [-1, 1]) {
      const band = mesh(new THREE.PlaneGeometry(5.6, ROAD_LEN), sandMat, {
        cast: false, receive: true,
      });
      band.rotation.x = -Math.PI / 2;
      band.position.set(s * (roadHalf + 3.4), -0.055, ROAD_Z_START - ROAD_LEN / 2);
      root.add(band);
    }
  }

  /* ── 主题地表纹理：用少量很宽的平面，颜色与地面接近，避免出现矩形边界 ── */
  if (T.id === 'country' || T.id === 'prairie') {
    const bandColor = T.id === 'country' ? T.ground.stripeAlt : T.ground.stripeAlt;
    const bandMat = toon(bandColor);
    for (let i = 0; i < 24; i++) {
      // 极宽（600m）+ 与地面同色系，只在近处形成柔和色带
      const b = mesh(new THREE.PlaneGeometry(600, 9), bandMat, { cast: false, receive: true });
      b.rotation.x = -Math.PI / 2;
      b.position.set(0, -0.048, ROAD_Z_START - i * 36);
      root.add(b);
    }
  }

  /* ── 路面 ── */
  const road = mesh(new THREE.PlaneGeometry(roadHalf * 2, ROAD_LEN), toon(T.road.surface), {
    cast: false, receive: true,
  });
  road.rotation.x = -Math.PI / 2;
  road.position.set(0, 0, ROAD_Z_START - ROAD_LEN / 2);
  root.add(road);

  /* ── 路肩 ── */
  const shoulderMat = toon(T.road.shoulder);
  const redMat = toon(0xe63946);
  const whiteRedMat = toon(0xf4f7fb);
  for (const s of [-1, 1]) {
    const sh = mesh(new THREE.BoxGeometry(1.4, 0.2, ROAD_LEN), shoulderMat, {
      cast: false, receive: true,
    });
    sh.position.set(s * (roadHalf + 0.7), 0.08, ROAD_Z_START - ROAD_LEN / 2);
    root.add(sh);

    for (let i = 0; i < 90; i++) {
      const seg = mesh(new THREE.BoxGeometry(0.24, 0.22, 4.6),
        i % 2 ? redMat : whiteRedMat, { cast: false, receive: false });
      seg.position.set(s * (roadHalf + 0.72), 0.09, ROAD_Z_START - i * 10);
      root.add(seg);
    }
  }

  /* ── 车道线 ── */
  const whiteMat = toon(0xe8eef6);
  for (const x of [-3.6, 0, 3.6]) {
    for (let i = 0; i < 78; i++) {
      const d = mesh(new THREE.PlaneGeometry(0.14, 2.2), whiteMat, { cast: false, receive: false });
      d.rotation.x = -Math.PI / 2;
      d.position.set(x, 0.014, ROAD_Z_START - i * 7.6);
      root.add(d);
    }
  }
  for (const s of [-1, 1]) {
    const l = mesh(new THREE.PlaneGeometry(0.18, ROAD_LEN), whiteMat, { cast: false, receive: false });
    l.rotation.x = -Math.PI / 2;
    l.position.set(s * (roadHalf - 0.32), 0.014, ROAD_Z_START - ROAD_LEN / 2);
    root.add(l);
  }

  /* ── 车道序号 ── */
  const laneNumMeshes = [];
  for (let i = 0; i < 4; i++) {
    const tex = makeCanvasTexture(128, 128, (g) => {
      g.clearRect(0, 0, 128, 128);
      g.font = '900 96px ui-rounded, "Helvetica Neue", Arial';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillStyle = 'rgba(255,255,255,0.5)';
      g.fillText(String(i + 1), 64, 68);
    });
    disposables.push(tex);
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(1.5, 1.5),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false })
    );
    m.rotation.x = -Math.PI / 2;
    m.rotation.z = Math.PI;
    m.position.set(laneX[i], 0.016, 0);
    root.add(m);
    laneNumMeshes.push(m);
  }

  /* ── 当前车道高亮 ── */
  const hlMat = new THREE.MeshBasicMaterial({
    color: 0x5ee6ff, transparent: true, opacity: 0.14, depthWrite: false,
  });
  disposables.push(hlMat);
  const hl = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 200), hlMat);
  hl.rotation.x = -Math.PI / 2;
  hl.position.set(laneX[1], 0.018, -40);
  root.add(hl);

  /* ══════════ 主题景物 ══════════ */
  const builders = makePropBuilders(rng);
  const windmills = [];

  for (let i = 0; i < 44; i++) {
    const z = 40 - i * 20 - rng() * 8;
    for (const s of [-1, 1]) {
      if (rng() < 0.12) continue;
      const kind = T.props[Math.floor(rng() * T.props.length)];
      const build = builders[kind];
      if (!build) continue;
      const dist = T.water?.enabled ? 13 + rng() * 6 : 10.5 + rng() * 12;
      const obj = build(0.72 + rng() * 0.65);
      obj.position.set(s * dist, 0, z);
      obj.rotation.y = rng() * Math.PI * 2;
      root.add(obj);
    }
  }

  for (const kind of T.propFar || []) {
    const build = builders[kind];
    if (!build) continue;
    for (let i = 0; i < 3; i++) {
      const obj = build(1.4 + rng() * 0.7);
      const s = rng() < 0.5 ? -1 : 1;
      obj.position.set(s * (60 + rng() * 70), 0, -120 - i * 90 - rng() * 40);
      obj.rotation.y = rng() * Math.PI * 2;
      if (obj.userData.blades) windmills.push(obj);
      root.add(obj);
    }
  }

  /* ── 路灯（海边和乡村） ── */
  if (T.id !== 'prairie') {
    const poleMat = toon(0x8e9bb3);
    const lampMat = new THREE.MeshBasicMaterial({ color: 0xfff2cc });
    disposables.push(lampMat);
    for (let i = 0; i < 16; i++) {
      const z = 20 - i * 34;
      for (const s of [-1, 1]) {
        const lampG = new THREE.Group();
        const pole = mesh(new THREE.CylinderGeometry(0.09, 0.12, 5.2, 8), poleMat, {
          outlineScale: 1.05,
        });
        pole.position.y = 2.6;
        lampG.add(pole);
        const arm = mesh(new THREE.BoxGeometry(1.1, 0.1, 0.1), poleMat, {});
        arm.position.set(-s * 0.55, 5.15, 0);
        lampG.add(arm);
        const lampHead = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.14, 0.28), lampMat);
        lampHead.position.set(-s * 1.0, 5.05, 0);
        lampG.add(lampHead);
        lampG.position.set(s * (roadHalf + 1.6), 0, z);
        root.add(lampG);
      }
    }
  }

  /* ── 远景山 ── */
  const mountainColor = T.id === 'coast' ? 0xa8c8e4 : T.id === 'prairie' ? 0xb9a98c : 0x9dbfdd;
  const mountainMat = toon(mountainColor);
  for (let i = 0; i < 12; i++) {
    const w = 60 + rng() * 70;
    const h = 42 + rng() * 46;
    const m = mesh(new THREE.ConeGeometry(w, h, 5, 1), mountainMat, {
      cast: false, receive: false,
    });
    m.position.set(-420 + i * 72 + rng() * 30, h / 2 - 6, -340 - rng() * 90);
    m.rotation.y = rng() * Math.PI;
    root.add(m);
  }

  /* ── 云 ── */
  const cloudMat = new THREE.MeshBasicMaterial({
    color: T.id === 'prairie' ? 0xfffaf0 : 0xffffff, fog: false,
  });
  disposables.push(cloudMat);
  for (let i = 0; i < 12; i++) {
    const cg = new THREE.Group();
    const n = 3 + Math.floor(rng() * 3);
    for (let j = 0; j < n; j++) {
      const r = 6 + rng() * 9;
      const b = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 1), cloudMat);
      b.position.set((j - n / 2) * r * 0.9, rng() * 5, rng() * 8);
      cg.add(b);
    }
    cg.position.set(-500 + rng() * 1000, 90 + rng() * 70, -260 - rng() * 180);
    cg.scale.y = 0.55;
    root.add(cg);
  }

  /* ── 飞鸟 ── */
  const birds = [];
  if (T.id !== 'country') {
    const birdMat = new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false, side: THREE.DoubleSide });
    disposables.push(birdMat);
    for (let i = 0; i < 5; i++) {
      const birdG = new THREE.Group();
      for (const s of [-1, 1]) {
        const wing = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.34), birdMat);
        wing.rotation.z = s * 0.3;
        wing.position.x = s * 0.7;
        birdG.add(wing);
      }
      birdG.position.set(-120 + rng() * 240, 44 + rng() * 34, -110 - rng() * 90);
      birdG.userData = { phase: rng() * Math.PI * 2, y0: birdG.position.y };
      birds.push(birdG);
      root.add(birdG);
    }
  }

  scene.add(root);

  /* ── 每帧 ── */
  let scroll = 0;

  function update(dt, speed, laneVisual, time = 0) {
    scroll += speed * dt;

    for (let i = 0; i < 4; i++) {
      laneNumMeshes[i].position.z = 6 - (scroll % 26);
    }

    const lx = CONFIG.laneX;
    // 4 条车道索引 0..3，插值上界必须是 3（原来写成 2，第 4 道会被夹住）
    const f = Math.max(0, Math.min(3, laneVisual));
    const i0 = Math.floor(f);
    const tt = f - i0;
    hl.position.x = lx[i0] * (1 - tt) + lx[Math.min(3, i0 + 1)] * tt;

    for (const bird of birds) {
      const { phase, y0 } = bird.userData;
      bird.position.y = y0 + Math.sin(time * 0.8 + phase) * 3;
      bird.children.forEach((wing, i) => {
        wing.rotation.z = (i ? 1 : -1) * (0.28 + Math.sin(time * 4.2 + phase) * 0.32);
      });
    }

    for (const w of windmills) {
      if (w.userData.blades) w.userData.blades.rotation.z += dt * 0.5;
    }
  }

  function dispose() {
    for (const d of disposables) d.dispose?.();
    root.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
      for (const m of mats) {
        for (const k of Object.keys(m)) if (m[k]?.isTexture) m[k].dispose();
        m.dispose();
      }
    });
    if (root.parent) root.parent.remove(root);
  }

  return { root, update, dispose, get scroll() { return scroll; } };
}

/* ══════════ 道具工厂 ══════════ */
function makePropBuilders(rng) {
  const trunkMat = toon(0x8a5a33);
  const leafA = toon(0x2f9e5b);
  const leafB = toon(0x39ae66);
  const leafC = toon(0x45bd74);

  return {
    pine(scale) {
      const g = new THREE.Group();
      const t = mesh(new THREE.CylinderGeometry(0.18, 0.26, 2.0, 7), trunkMat, {});
      t.position.y = 1.0;
      g.add(t);
      [[2.2, 2.9, 2.8, leafA], [1.7, 2.4, 4.1, leafB], [1.15, 1.9, 5.2, leafC]]
        .forEach(([r, h, y, m]) => {
          const c = mesh(new THREE.ConeGeometry(r, h, 8), m, { outlineScale: 1.06 });
          c.position.y = y;
          g.add(c);
        });
      g.scale.setScalar(scale);
      return g;
    },

    roundTree(scale) {
      const g = new THREE.Group();
      const t = mesh(new THREE.CylinderGeometry(0.2, 0.3, 2.2, 7), trunkMat, {});
      t.position.y = 1.1;
      g.add(t);
      [[2.3, 0, 3.9, 0, leafA], [1.7, -1.5, 3.0, 0.3, leafB],
        [1.7, 1.5, 3.0, -0.3, leafC], [1.25, 0.3, 5.2, 0.2, leafB]]
        .forEach(([r, px, py, pz, m]) => {
          const b = mesh(new THREE.IcosahedronGeometry(r, 1), m, { outlineScale: 1.05 });
          b.position.set(px, py, pz);
          g.add(b);
        });
      g.scale.setScalar(scale);
      return g;
    },

    bush(scale) {
      const g = new THREE.Group();
      const bm = toon(0x4bb96e);
      [[1.0, 0, 0.65, 0], [0.75, -0.8, 0.5, 0.2], [0.75, 0.8, 0.5, -0.2]].forEach(([r, px, py, pz]) => {
        const b = mesh(new THREE.IcosahedronGeometry(r, 1), bm, { outlineScale: 1.06 });
        b.position.set(px, py, pz);
        b.scale.y = 0.85;
        g.add(b);
      });
      g.scale.setScalar(scale);
      return g;
    },

    rock(scale) {
      const g = new THREE.Group();
      const m = mesh(new THREE.DodecahedronGeometry(0.9, 0), toon(0x8b93a3), { outlineScale: 1.05 });
      m.scale.set(1.1, 0.72, 0.95);
      m.position.y = 0.5;
      g.add(m);
      const m2 = mesh(new THREE.DodecahedronGeometry(0.45, 0), toon(0x9ba3b2), { outlineScale: 1.06 });
      m2.position.set(0.85, 0.25, 0.4);
      g.add(m2);
      g.scale.setScalar(scale);
      return g;
    },

    /* ── 海边 ── */
    palm(scale) {
      const g = new THREE.Group();
      const H = 4.2;
      const segs = 5;
      const trunkM = toon(0x9c7346);
      for (let i = 0; i < segs; i++) {
        const t = i / segs;
        const seg = mesh(
          new THREE.CylinderGeometry(0.16 - t * 0.05, 0.19 - t * 0.05, H / segs + 0.06, 7),
          trunkM, { outlineScale: 1.06 }
        );
        seg.position.set(Math.sin(t * 1.3) * 0.55, H * t + H / segs * 0.5, 0);
        seg.rotation.z = -Math.cos(t * 1.3) * 0.16;
        g.add(seg);
      }
      const crown = new THREE.Vector3(Math.sin(1.3) * 0.55, H, 0);
      for (let i = 0; i < 7; i++) {
        const frond = new THREE.Group();
        frond.position.copy(crown);
        frond.rotation.y = (i / 7) * Math.PI * 2;
        const blade = mesh(new THREE.ConeGeometry(0.26, 2.3, 4), i % 2 ? leafA : leafB, {
          outlineScale: 1.05,
        });
        blade.rotation.z = Math.PI / 2 - 0.55;
        blade.rotation.x = Math.PI;
        blade.scale.z = 0.3;
        blade.position.set(1.05, -0.22, 0);
        frond.add(blade);
        g.add(frond);
      }
      const nutM = toon(0x6b4a2a);
      for (let i = 0; i < 3; i++) {
        const nut = mesh(new THREE.IcosahedronGeometry(0.13, 1), nutM, {});
        nut.position.copy(crown)
          .add(new THREE.Vector3(Math.cos(i * 2.1) * 0.2, -0.16, Math.sin(i * 2.1) * 0.2));
        g.add(nut);
      }
      g.scale.setScalar(scale * 1.15);
      return g;
    },

    umbrella(scale) {
      const g = new THREE.Group();
      const pole = mesh(new THREE.CylinderGeometry(0.05, 0.06, 2.2, 6), toon(0xe8e3d5), {
        outlineScale: 1.1,
      });
      pole.position.y = 1.1;
      g.add(pole);

      const colors = [0xe63946, 0x1e7be0, 0xffc233, 0x159a6e];
      const c1 = colors[Math.floor(rng() * colors.length)];
      const c2 = colors[Math.floor(rng() * colors.length)];

      // 伞盖：一个整体扁圆锥（开 8 边形），条纹用两种颜色的薄环描述
      const canopy = new THREE.Group();
      canopy.position.y = 2.24;

      const cone = new THREE.Mesh(
        new THREE.ConeGeometry(1.02, 0.42, 8, 1, true),
        toon(c1)
      );
      cone.material.side = THREE.DoubleSide;
      cone.castShadow = true;
      canopy.add(cone);

      // 交替色：8 条窄扇面贴在锥面上（半径略大，避免 z-fighting）
      for (let i = 0; i < 8; i += 2) {
        const a0 = (i / 8) * Math.PI * 2;
        const a1 = ((i + 1) / 8) * Math.PI * 2;
        const seg = new THREE.CylinderGeometry(1.045, 0.105, 0.415, 1, 1, true, a0, a1 - a0);
        const panel = new THREE.Mesh(seg, toon(c2));
        panel.material.side = THREE.DoubleSide;
        canopy.add(panel);
      }

      // 伞顶
      canopy.add(mesh(new THREE.SphereGeometry(0.08, 8, 6), toon(0xf0ead8), { pos: [0, 0.23, 0] }));
      g.add(canopy);

      const chair = mesh(new THREE.BoxGeometry(0.9, 0.08, 0.5), toon(0xf3efe2), {});
      chair.position.set(1.1, 0.28, 0.2);
      chair.rotation.z = 0.16;
      g.add(chair);

      g.scale.setScalar(scale);
      return g;
    },

    lighthouse(scale) {
      const g = new THREE.Group();
      const H = 9;
      const segs = 6;
      for (let i = 0; i < segs; i++) {
        const r0 = 1.45 - (i / segs) * 0.72;
        const r1 = 1.45 - ((i + 1) / segs) * 0.72;
        const seg = mesh(
          new THREE.CylinderGeometry(r1, r0, H / segs, 12),
          toon(i % 2 ? 0xf4f7fb : 0xe63946), {}
        );
        seg.position.y = (H / segs) * (i + 0.5);
        g.add(seg);
      }
      const topM = toon(0x2b3a55);
      const top = mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.9, 10), topM, {});
      top.position.y = H + 0.45;
      g.add(top);
      const lampRoom = new THREE.Mesh(
        new THREE.CylinderGeometry(0.42, 0.42, 0.7, 10),
        new THREE.MeshBasicMaterial({ color: 0xfff4c4 })
      );
      lampRoom.position.y = H + 1.2;
      g.add(lampRoom);
      const roof = mesh(new THREE.ConeGeometry(0.62, 0.55, 10), topM, {});
      roof.position.y = H + 1.8;
      g.add(roof);
      g.scale.setScalar(scale);
      return g;
    },

    /* ── 乡村 ── */
    haystack(scale) {
      const g = new THREE.Group();
      const base = mesh(new THREE.CylinderGeometry(1.5, 1.7, 1.2, 10), toon(0xd8bd5e), {
        outlineScale: 1.05,
      });
      base.position.y = 0.6;
      g.add(base);
      const top = mesh(new THREE.ConeGeometry(1.55, 1.5, 10), toon(0xe0c96a), {
        outlineScale: 1.05,
      });
      top.position.y = 1.95;
      g.add(top);
      g.scale.setScalar(scale);
      return g;
    },

    fence(scale) {
      const g = new THREE.Group();
      const woodM = toon(0xb08a5a);
      for (let i = 0; i < 3; i++) {
        const post = mesh(new THREE.BoxGeometry(0.13, 1.05, 0.13), woodM, {});
        post.position.set((i - 1) * 0.95, 0.52, 0);
        g.add(post);
      }
      for (const y of [0.42, 0.78]) {
        const rail = mesh(new THREE.BoxGeometry(2.3, 0.11, 0.09), woodM, {});
        rail.position.set(0, y, 0);
        g.add(rail);
      }
      g.scale.setScalar(scale);
      return g;
    },

    barn(scale) {
      const g = new THREE.Group();
      const body = mesh(new THREE.BoxGeometry(5.0, 3.2, 3.6), toon(0xb5443a), {
        outlineScale: 1.04,
      });
      body.position.y = 1.6;
      g.add(body);
      const roof = mesh(new THREE.ConeGeometry(4.0, 1.9, 4), toon(0x4a4f60), { outlineScale: 1.05 });
      roof.rotation.y = Math.PI / 4;
      roof.position.y = 4.1;
      roof.scale.set(1.0, 1, 0.72);
      g.add(roof);
      const frame = mesh(new THREE.BoxGeometry(1.7, 2.2, 0.06), toon(0xf0e8d8), {});
      frame.position.set(0, 1.05, 1.84);
      g.add(frame);
      const door = mesh(new THREE.BoxGeometry(1.5, 2.0, 0.12), toon(0x8c3a32), {});
      door.position.set(0, 1.0, 1.87);
      g.add(door);
      g.scale.setScalar(scale);
      return g;
    },

    windmill(scale) {
      const g = new THREE.Group();
      const tower = mesh(new THREE.CylinderGeometry(0.7, 1.5, 6.5, 8), toon(0xe8e0cc), {
        outlineScale: 1.04,
      });
      tower.position.y = 3.25;
      g.add(tower);
      const cap = mesh(new THREE.ConeGeometry(1.0, 1.2, 8), toon(0x6b5b45), { outlineScale: 1.05 });
      cap.position.y = 7.1;
      g.add(cap);

      const blades = new THREE.Group();
      blades.position.set(0, 6.6, 1.2);
      const bladeM = toon(0xf2ebd8);
      for (let i = 0; i < 4; i++) {
        const holder = new THREE.Group();
        holder.rotation.z = (i * Math.PI) / 2;
        const b = mesh(new THREE.BoxGeometry(0.24, 3.0, 0.08), bladeM, { outlineScale: 1.04 });
        b.position.y = 1.6;
        holder.add(b);
        blades.add(holder);
      }
      g.add(blades);
      g.userData.blades = blades;
      g.scale.setScalar(scale);
      return g;
    },

    /* ── 草原 ── */
    grassTuft(scale) {
      const g = new THREE.Group();
      const mA = toon(0xd8c373);
      const mB = toon(0xc9b463);
      const count = 7;
      for (let i = 0; i < count; i++) {
        const h = 0.5 + rng() * 0.55;
        const blade = mesh(new THREE.ConeGeometry(0.055, h, 3), i % 2 ? mA : mB, {
          cast: false, receive: false,
        });
        const a = (i / count) * Math.PI * 2;
        blade.position.set(Math.cos(a) * 0.2, h / 2, Math.sin(a) * 0.2);
        blade.rotation.z = Math.cos(a) * 0.28;
        blade.rotation.x = Math.sin(a) * 0.28;
        g.add(blade);
      }
      g.scale.setScalar(scale * 1.3);
      return g;
    },

    lonelyTree(scale) {
      const g = new THREE.Group();
      const trunk = mesh(new THREE.CylinderGeometry(0.22, 0.42, 2.4, 7), toon(0x7a5238), {
        outlineScale: 1.06,
      });
      trunk.position.y = 1.2;
      g.add(trunk);
      const crown = mesh(new THREE.SphereGeometry(2.3, 14, 10), toon(0x6aa84f), {
        outlineScale: 1.05,
      });
      crown.position.y = 4.1;
      crown.scale.set(1.35, 0.68, 1.35);
      g.add(crown);
      const crown2 = mesh(new THREE.SphereGeometry(1.6, 12, 9), toon(0x7cba5e), {});
      crown2.position.set(0.7, 4.5, -0.4);
      crown2.scale.set(1.1, 0.7, 1.1);
      g.add(crown2);
      g.scale.setScalar(scale);
      return g;
    },

    mesa(scale) {
      const g = new THREE.Group();
      const body = mesh(new THREE.CylinderGeometry(6.5, 8.5, 5.5, 7), toon(0xb08a63), {
        cast: false, receive: false,
      });
      body.position.y = 2.75;
      g.add(body);
      const top = mesh(new THREE.CylinderGeometry(6.2, 6.6, 0.9, 7), toon(0x9c7a55), {
        cast: false, receive: false,
      });
      top.position.y = 5.9;
      g.add(top);
      g.scale.setScalar(scale);
      return g;
    },
  };
}
