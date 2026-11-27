// 景物：把 Blender 产出的模型按真实分布铺到公路两侧
//
// 关键设计
// - 用 InstancedMesh 而非每个 copy 一个 mesh：一帧几十棵树也只有几个 draw call
// - 分布用「分区 + 抖动」，避免均匀网格那种塑料感
// - 远山用多层剪影，越远越亮越蓝（空气透视），这是空间深度的主要来源
import * as THREE from 'three';
import { CONFIG } from '../core/config.js';
import { loadModel } from './assets.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const ROAD_LEN = 1600;
const Z_FAR = -ROAD_LEN * 0.75;
const Z_NEAR = ROAD_LEN * 0.25;

function rngFactory(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** 把一个 glb 场景摊平成「可实例化的几何 + 材质组」 */
async function toInstancedSource(url) {
  const gltf = await loadModel(url);
  const meshes = [];
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse(o => {
    if (!o.isMesh) return;
    const g = o.geometry.clone();
    g.applyMatrix4(o.matrixWorld);
    // 统一属性，否则 merge 会失败
    if (!g.attributes.uv) {
      const n = g.attributes.position.count;
      g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
    }
    if (!g.attributes.normal) g.computeVertexNormals();
    // 只保留 merge 兼容的属性
    for (const key of Object.keys(g.attributes)) {
      if (!['position', 'normal', 'uv'].includes(key)) g.deleteAttribute(key);
    }
    meshes.push({ geo: g, mat: o.material });
  });
  return meshes;
}

/**
 * 把多材质模型合并成「按材质分组」的实例化集合。
 * 一颗树有树皮 + 3 种叶子 = 4 组，每组一个 InstancedMesh，
 * 同一棵树的所有 instance 站在同一位置。
 */
async function buildInstancedSet(url, placements, opts = {}) {
  const { castShadow = true, receiveShadow = true, textureOverride = null } = opts;
  const meshes = await toInstancedSource(url);
  const group = new THREE.Group();

  // 按材质分组
  const byMat = new Map();
  for (const { geo, mat } of meshes) {
    const key = mat.name || 'default';
    if (!byMat.has(key)) byMat.set(key, { mat, geos: [] });
    byMat.get(key).geos.push(geo);
  }

  for (const [key, { mat, geos }] of byMat) {
    const merged = geos.length === 1 ? geos[0] : mergeGeometries(geos, false);
    if (!merged) continue;
    const material = textureOverride || mat;
    if (material) {
      material.side = THREE.FrontSide;
      if (material.envMapIntensity !== undefined) material.envMapIntensity = 1.0;
    }
    const im = new THREE.InstancedMesh(merged, material, placements.length);
    im.castShadow = castShadow;
    im.receiveShadow = receiveShadow;
    im.frustumCulled = true;

    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const pos = new THREE.Vector3();
    const scl = new THREE.Vector3();
    placements.forEach((p, i) => {
      pos.set(p.x, p.y || 0, p.z);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.rot || 0);
      const s = p.scale || 1;
      scl.set(s * (p.sx || 1), s * (p.sy || 1), s);
      m.compose(pos, q, scl);
      im.setMatrixAt(i, m);
    });
    im.instanceMatrix.needsUpdate = true;
    group.add(im);
  }

  return group;
}

/**
 * 构建整条风景。
 * @param {THREE.Scene} scene
 * @param {object} weather
 */
export async function buildScenery(scene, weather) {
  const root = new THREE.Group();
  root.name = 'scenery';
  scene.add(root);

  const { roadHalf } = CONFIG;
  const rnd = rngFactory(20241127);
  const W = weather;
  const isSnow = W.snow > 0;

  /* ══════════════════════════════════════════════════════
     树木分布
     ══════════════════════════════════════════════════════ */
  const pineP = [], broadP = [], bushP = [], rockP = [], rockBigP = [];

  // 沿路 1600 米，每 9m 一组 → 约 178 组
  const SPACING = 9.0;
  const groups = Math.floor(ROAD_LEN / SPACING);
  for (let gi = 0; gi < groups; gi++) {
    const z = Z_NEAR - gi * SPACING - rnd() * SPACING * 0.42;

    for (const side of [-1, 1]) {
      // 左侧靠湖：树更稀疏、更小
      const isLakeSide = side < 0;
      const density = isLakeSide ? 0.42 : 0.88;
      if (rnd() > density) continue;

      // 距路远近分三档：近景 / 中景 / 远景
      const tier = rnd();
      let dist, scale;
      if (tier < 0.30) {
        dist = roadHalf + 3.4 + rnd() * 3.0;
        scale = 0.78 + rnd() * 0.30;
      } else if (tier < 0.72) {
        dist = roadHalf + 8 + rnd() * 14;
        scale = 0.86 + rnd() * 0.42;
      } else {
        dist = roadHalf + 24 + rnd() * 46;
        scale = 0.92 + rnd() * 0.55;
      }
      const x = side * dist;
      const p = { x, z, scale, rot: rnd() * Math.PI * 2 };

      // 树种：阔叶为主，针叶成片
      // （成片靠 z 的低频函数，做出「林块」而不是均匀撒）
      const band = Math.sin(z * 0.021 + side * 2.1) + Math.cos(z * 0.009 - 1.3) * 0.8;
      const isPineBand = band > 0.55;

      if (rnd() < (isPineBand ? 0.78 : 0.22)) {
        pineP.push(p);
      } else {
        broadP.push(p);
      }

      // 灌木：贴近路边
      if (rnd() < 0.55) {
        bushP.push({
          x: side * (roadHalf + 2.6 + rnd() * 2.2),
          z: z + (rnd() - 0.5) * SPACING * 0.7,
          scale: 0.60 + rnd() * 0.50,
          rot: rnd() * Math.PI * 2,
        });
      }

      // 岩石：少量，主要在中远景
      if (rnd() < 0.14) {
        (rnd() < 0.7 ? rockP : rockBigP).push({
          x: side * (roadHalf + 5 + rnd() * 22),
          z: z + (rnd() - 0.5) * SPACING,
          scale: 0.55 + rnd() * 1.15,
          rot: rnd() * Math.PI * 2,
        });
      }
    }
  }

  // 湖对岸的树林（远景带，密度高、尺寸大，只做剪影）
  for (let i = 0; i < 260; i++) {
    const x = -(roadHalf + 150 + rnd() * 120);
    const z = Z_NEAR - rnd() * ROAD_LEN;
    (rnd() < 0.62 ? pineP : broadP).push({
      x, z, scale: 1.0 + rnd() * 0.9, rot: rnd() * Math.PI * 2,
    });
  }

  const sceneryGroup = new THREE.Group();
  root.add(sceneryGroup);

  // 分组：近处树带阴影，远处树只投影自身（不 cast，省 shadow pass）
  const NEAR_Z = -120;
  const nearPine = pineP.filter(p => p.z > NEAR_Z);
  const farPine = pineP.filter(p => p.z <= NEAR_Z);
  const nearBroad = broadP.filter(p => p.z > NEAR_Z);
  const farBroad = broadP.filter(p => p.z <= NEAR_Z);

  const sets = await Promise.all([
    buildInstancedSet('models/tree_pine.glb', farPine, { castShadow: false }),
    buildInstancedSet('models/tree_broad.glb', farBroad, { castShadow: false }),
    buildInstancedSet('models/tree_pine.glb', nearPine, { castShadow: true }),
    buildInstancedSet('models/tree_broad.glb', nearBroad, { castShadow: true }),
    buildInstancedSet('models/tree_small.glb', bushP, { castShadow: false }),
    buildInstancedSet('models/rock_a.glb', rockP),
    buildInstancedSet('models/rock_b.glb', rockBigP),
  ]);
  for (const s of sets) {
    if (s) sceneryGroup.add(s);
  }


  /* ══════════════════════════════════════════════════════
     路灯（两侧交错，间距 34m）
     ══════════════════════════════════════════════════════ */
  const lampP = [];
  for (let i = 0; i < 46; i++) {
    const z = 30 - i * 34;
    const side = i % 2 === 0 ? -1 : 1;
    // 模型本身朝 -X 挑臂，绕 Y 转 180° 就朝 +X
    lampP.push({
      x: side * (roadHalf + 1.9),
      z,
      rot: side < 0 ? 0 : Math.PI,
      scale: 1.0,
    });
  }
  const lampGroup = await buildInstancedSet('models/lamp.glb', lampP);
  root.add(lampGroup);

  // 灯发光面：单独找出来，夜间点亮
  const lampGlowMeshes = [];
  lampGroup.traverse(o => {
    if (o.isInstancedMesh && o.material?.name === 'LampGlass') {
      lampGlowMeshes.push(o);
    }
  });

  /* ══════════════════════════════════════════════════════
     护栏（右侧临湖段与山路弯道）
     ══════════════════════════════════════════════════════ */
  const guardP = [];
  // 右侧全程护栏（模型沿 X 展开 4m，转向 90° 后沿 Z）
  for (let i = 0; i < Math.floor(ROAD_LEN / 4); i++) {
    guardP.push({
      x: roadHalf + 2.6,
      z: Z_NEAR - i * 4 - 2,
      rot: Math.PI / 2,
    });
  }
  const guardGroup = await buildInstancedSet('models/guardrail.glb', guardP, {
    castShadow: false,
  });
  root.add(guardGroup);

  /* ── 轮廓柱（路边，16m 一根） ──────────────────────── */
  const bollardP = [];
  for (let i = 0; i < Math.floor(ROAD_LEN / 16); i++) {
    const z = Z_NEAR - i * 16;
    bollardP.push({ x: -(roadHalf + 1.5), z });
    bollardP.push({ x: roadHalf + 1.5, z: z - 8 });
  }
  const bollardGroup = await buildInstancedSet('models/bollard.glb', bollardP, {
    castShadow: false,
  });
  root.add(bollardGroup);

  /* ── 里程牌（每 220m） ─────────────────────────────── */
  const signP = [];
  for (let i = 0; i < 7; i++) {
    signP.push({ x: -(roadHalf + 4.5), z: 20 - i * 220, rot: Math.PI / 2 });
  }
  const signGroup = await buildInstancedSet('models/signpost.glb', signP, {
    castShadow: false,
  });
  root.add(signGroup);

  /* ══════════════════════════════════════════════════════
     远山（三层，带空气透视）
     ══════════════════════════════════════════════════════ */
  const mountainLayers = [];
  const mtnDefs = [
    // 远山必须又远又矮（山脚在地平线附近），否则会像贴在天上的纸片
    // 山脚沉到地平线以下，只露出山体；越远越蓝灰（空气透视）
    { z: -1320, xs: [-1300, 1300], n: 8, scale: [1.50, 2.10], y: -128, tint: 0x6f8aab },
    { z: -880, xs: [-1000, 1050], n: 6, scale: [1.05, 1.55], y: -108, tint: 0x5d7a9c },
  ];

  for (const def of mtnDefs) {
    const placements = [];
    for (let i = 0; i < def.n; i++) {
      const t = (i + 0.5) / def.n;
      const x = def.xs[0] + (def.xs[1] - def.xs[0]) * t + (rnd() - 0.5) * 200;
      placements.push({
        x,
        z: def.z + (rnd() - 0.5) * 160,
        y: def.y,
        scale: def.scale[0] + rnd() * (def.scale[1] - def.scale[0]),
        rot: rnd() * Math.PI * 2,
      });
    }
    const g = await buildInstancedSet('models/mountain.glb', placements, {
      castShadow: false, receiveShadow: false,
    });
    // 空气透视：远的更亮更蓝
    g.traverse(o => {
      if (!o.isInstancedMesh) return;
      o.material = o.material.clone();
      o.material.color.lerp(new THREE.Color(def.tint), 0.78);
      o.material.envMapIntensity = 0.25;
      o.material.roughness = 0.97;
      o.material.metalness = 0.0;
      o.material.fog = true;
    });
    root.add(g);
    mountainLayers.push(g);
  }

  /* ── 风车（远景，右侧田野） ────────────────────────── */
  const windP = [
    { x: 340, z: -620, scale: 1.0, rot: 0.5 },
    { x: 520, z: -880, scale: 0.85, rot: 1.4 },
    { x: 760, z: -520, scale: 1.15, rot: 2.6 },
    { x: 980, z: -1150, scale: 0.95, rot: 0.2 },
  ];
  const windGroup = await buildInstancedSet('models/windmill.glb', windP, {
    castShadow: false, receiveShadow: false,
  });
  root.add(windGroup);

  /* ══════════════════════════════════════════════════════
     天气响应：夜间压暗、雪天加白
     ══════════════════════════════════════════════════════ */
  const originalColors = new Map();

  function applyWeather(next) {
    const night = next.id === 'night';
    const snow = next.snow > 0;

    root.traverse(o => {
      if (!o.isInstancedMesh || !o.material) return;
      const mat = o.material;
      if (!originalColors.has(mat.uuid)) {
        originalColors.set(mat.uuid, mat.color.clone());
      }
      const base = originalColors.get(mat.uuid);

      if (mat.name === 'LampGlass') {
        // 只在夜间 / 雨天 / 雪天亮灯
        mat.emissiveIntensity = next.lampOn ? (night ? 4.2 : 1.0) : 0;
        mat.emissive.setRGB(1.0, 0.93, 0.78);
        return;
      }

      mat.color.copy(base);
      if (snow) {
        // 雪：压暗 + 向冷白偏移（雪覆盖的视觉）
        mat.color.lerp(new THREE.Color(0.86, 0.91, 0.96), 0.38);
        mat.color.multiplyScalar(0.90);
      } else if (night) {
        mat.color.multiplyScalar(0.52);
        mat.color.lerp(new THREE.Color(0.10, 0.15, 0.26), 0.30);
      }
      mat.needsUpdate = true;
    });
  }

  function update(dt, speed, time) {
    // 风车桨叶转动
    const spin = (time * 0.35) % (Math.PI * 2);
    windGroup.rotation.y = spin * 0;   // 整组不能转（会带动位置），这里留空
  }

  applyWeather(weather);

  function dispose() {
    root.traverse(o => {
      if (o.geometry) o.geometry.dispose();
    });
    if (root.parent) root.parent.remove(root);
  }

  return { root, update, applyWeather, dispose, lampGlowMeshes, mountainLayers };
}
