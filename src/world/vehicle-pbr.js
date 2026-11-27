// 载具 + 骑手：加载 Blender 模型，按节点驱动动画
//
// 模型节点（来自 assets_src/blender/pelican.py 与 bike.py）
//   bike:    wheelRear / wheelFront / drivetrain / frame / seat / handlebar / basket / lamp
//   scooter: wheelFront / wheelRear / deck / stem / fork
//   pelican: body / beak / eyes / cap / crest / wingL / wingR / legL / legR / tail / scarf / bag
import * as THREE from 'three';
import { loadModel, findNode, indexMaterials, recolor, setEmissive } from './assets.js';
import { PALETTES, BIKE_MATERIAL_MAP, SCOOTER_MATERIAL_MAP } from './weather-themes.js';

/* 骑手在座垫上的高度（与 Blender 里 SADDLE_Z 对齐） */
const RIDER_LIFT = 0.0;

export async function buildVehicle(kind = 'bike', paletteId = null) {
  const [vehicleGltf, riderGltf] = await Promise.all([
    loadModel(kind === 'scooter' ? 'models/scooter.glb' : 'models/bike.glb'),
    loadModel('models/pelican.glb'),
  ]);

  const group = new THREE.Group();
  group.name = `vehicle_${kind}`;

  // ── 接触阴影：车下的柔和暗影（AO 贴花）
  // 没有它，车会像贴纸一样浮在路面上。
  const aoCanvas = document.createElement('canvas');
  aoCanvas.width = aoCanvas.height = 256;
  {
    const g2 = aoCanvas.getContext('2d');
    const rg = g2.createRadialGradient(128, 128, 8, 128, 128, 126);
    rg.addColorStop(0, 'rgba(0,0,0,0.52)');
    rg.addColorStop(0.45, 'rgba(0,0,0,0.26)');
    rg.addColorStop(1, 'rgba(0,0,0,0)');
    g2.fillStyle = rg;
    g2.fillRect(0, 0, 256, 256);
  }
  const aoTex = new THREE.CanvasTexture(aoCanvas);
  aoTex.colorSpace = THREE.SRGBColorSpace;
  const contactShadow = new THREE.Mesh(
    new THREE.PlaneGeometry(1.35, 2.4),
    new THREE.MeshBasicMaterial({
      map: aoTex, transparent: true, opacity: 1,
      depthWrite: false, blending: THREE.NormalBlending,
      polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6,
    }),
  );
  contactShadow.rotation.x = -Math.PI / 2;
  contactShadow.position.set(0, 0.012, 0);
  contactShadow.renderOrder = 2;
  group.add(contactShadow);

  // ── 载具 ─────────────────────────────────────────────
  const vehicle = vehicleGltf.scene.clone(true);
  vehicle.traverse(o => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
      // 轮辐很细，开启双面避免背面缺失
      if (o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) {
          m.envMapIntensity = 1.0;
        }
      }
    }
  });
  group.add(vehicle);

  const nodes = {
    wheelRear: findNode(vehicle, 'wheelRear'),
    wheelFront: findNode(vehicle, 'wheelFront'),
    drivetrain: findNode(vehicle, 'drivetrain'),
    lamp: findNode(vehicle, 'lamp'),
    stem: findNode(vehicle, 'stem'),
    frame: findNode(vehicle, 'frame'),
  };

  // ── 骑手 ─────────────────────────────────────────────
  const rider = riderGltf.scene.clone(true);
  rider.traverse(o => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
      if (o.material?.isMeshStandardMaterial) {
        // 白羽 + 强 IBL 会过曝：压低环境反射，并让白羽略带冷灰
        o.material.envMapIntensity = 0.40;
        if (o.material.name === 'PelicanBody' || o.material.name === 'PelicanBodyShade') {
          o.material.color.multiplyScalar(0.88);
        }
      }
    }
  });

  // 鹈鹕 glb 内部的 body 节点已经站在座垫高度上（Blender 里按坐姿建模），
  // 所以这里只能做「横向/纵深」的微调，绝不能把座高写进 Z。
  // 踏板车骑手站着，需要略微前移贴近车把。
  if (kind === 'scooter') {
    // 滑板车：骑手站在甲板上（甲板顶 y≈0.13），
    // 模型是坐姿（臀高 0.865），所以整体下沉到「站立」的观感高度
    rider.position.set(0, -0.36, -0.02);
    rider.rotation.x = 0.10;
  } else {
    rider.position.set(0, -0.015, 0);
    rider.rotation.x = -0.03;
  }
  group.add(rider);

  const rnodes = {
    body: findNode(rider, 'body'),
    beak: findNode(rider, 'beak'),
    eyes: findNode(rider, 'eyes'),
    cap: findNode(rider, 'cap'),
    crest: findNode(rider, 'crest'),
    wingL: findNode(rider, 'wingL'),
    wingR: findNode(rider, 'wingR'),
    legL: findNode(rider, 'legL'),
    legR: findNode(rider, 'legR'),
    tail: findNode(rider, 'tail'),
    scarf: findNode(rider, 'scarf'),
    bag: findNode(rider, 'bag'),
  };

  // 记录静止姿态（动画都是在这个基准上加偏移）
  const rest = {};
  for (const [k, o] of Object.entries(rnodes)) {
    if (!o) continue;
    rest[k] = {
      pos: o.position.clone(),
      rot: o.rotation.clone(),
      quat: o.quaternion.clone(),
    };
  }

  // ── 配色 ─────────────────────────────────────────────
  const palettes = PALETTES[kind] || PALETTES.bike;
  const pal = palettes.find(p => p.id === paletteId) || palettes[0];

  function applyPalette(p) {
    const map = kind === 'scooter' ? SCOOTER_MATERIAL_MAP : BIKE_MATERIAL_MAP;
    const mats = indexMaterials(vehicle);
    for (const [matName, key] of Object.entries(map)) {
      const m = mats.get(matName);
      if (m && p[key]) recolor(m, p[key]);
    }
    // 鹈鹕的头巾 / 围巾跟主色走
    const rmats = indexMaterials(rider);
    const capM = rmats.get('PelicanCap');
    const accM = rmats.get('PelicanAccent');
    if (capM) recolor(capM, p.frame);
    if (accM) recolor(accM, p.accent);
  }
  applyPalette(pal);

  /* ══════════════════════════════════════════════════════
     动画状态
     ══════════════════════════════════════════════════════ */
  const state = {
    wheelAngle: 0,
    crankAngle: 0,
    emote: null,          // { kind, t, dur }
    mood: 'idle',
    blinkT: 0,
    blinkNext: 2.0 + Math.random() * 3,
    wingLift: 0,
    headTilt: 0,
    bodyBounce: 0,
    leanSmooth: 0,
  };

  const R_WHEEL = kind === 'scooter' ? 0.155 : 0.340;
  const CRANK_RATIO = kind === 'scooter' ? 0 : 0.44;

  function setMood(kind, intensity = 1) {
    state.mood = kind;
    state.emote = {
      kind,
      t: 0,
      dur: kind === 'cheer' ? 1.0
        : kind === 'superCheer' ? 1.5
          : kind === 'oops' ? 1.25 : 0.9,
      intensity: Math.max(0.4, Math.min(1.6, intensity)),
    };
  }

  /**
   * @param {number} dt
   * @param {number} speedRatio 0..1.2
   * @param {number} lean 横向压弯（弧度）
   * @param {number} time
   * @param {number} speed 实际米/秒（用于轮速）
   */
  function update(dt, speedRatio, lean = 0, time = 0, speed = 10) {
    const sp = Math.max(0, Math.min(1.2, speedRatio));

    /* ── 车轮：按真实速度转（半径已知，滚动不打滑） ──── */
    const wheelOmega = speed / R_WHEEL;
    state.wheelAngle = (state.wheelAngle - wheelOmega * dt);
    if (nodes.wheelRear) nodes.wheelRear.rotation.x = state.wheelAngle;
    if (nodes.wheelFront) nodes.wheelFront.rotation.x = state.wheelAngle;

    /* ── 曲柄（自行车）：与轮速按齿比耦合 ──────────── */
    if (nodes.drivetrain) {
      state.crankAngle = state.wheelAngle * CRANK_RATIO;
      nodes.drivetrain.rotation.x = state.crankAngle;
    }

    /* ── 整车姿态：换道压弯 + 高速轻微下沉 ─────────── */
    state.leanSmooth += (lean - state.leanSmooth) * Math.min(1, dt * 9);
    group.rotation.z = state.leanSmooth;
    group.rotation.y = state.leanSmooth * 0.55;

    /* ══ 骑手 ══════════════════════════════════════════ */
    const b = rest.body;
    if (b && rnodes.body) {
      // 呼吸 + 踩踏起伏
      const bob = Math.sin(time * (kind === 'scooter' ? 4.0 : 6.2)) * 0.0055 * (0.4 + sp);
      rnodes.body.position.y = b.pos.y + bob + state.bodyBounce;
      // 高速前倾
      rnodes.body.rotation.x = b.rot.x + sp * 0.035;
    }

    // 头：随速度点头 + 情绪俯仰
    if (rnodes.cap && rest.cap) {
      const nod = Math.sin(time * 2.9) * 0.022 * (0.3 + sp);
      // 帽子、眼、冠羽跟着身体（它们是独立节点，一起动才自然）
      rnodes.cap.rotation.x = rest.cap.rot.x + nod * 0.55 + state.headTilt * 0.7;
      if (rnodes.eyes) {
        rnodes.eyes.rotation.x = rest.eyes.rot.x + nod * 0.55 + state.headTilt * 0.7;
      }
      if (rnodes.crest) {
        rnodes.crest.rotation.x = rest.crest.rot.x + nod * 0.8 + state.headTilt * 0.6;
      }
      if (rnodes.beak) {
        rnodes.beak.rotation.x = rest.beak.rot.x + nod * 0.40 + state.headTilt * 0.45;
      }
    }

    // 眨眼：眼睛整体压扁一瞬
    state.blinkT -= dt;
    if (state.blinkT <= 0) {
      state.blinkT = state.blinkNext;
      state.blinkNext = 2.2 + Math.random() * 3.8;
      state.blinkPhase = 0.11;
    }
    if (state.blinkPhase > 0) {
      state.blinkPhase -= dt;
      const k = 0.12;
      if (rnodes.eyes) rnodes.eyes.scale.y = k;
    } else if (rnodes.eyes) {
      rnodes.eyes.scale.y = 1;
    }

    // 腿：踩踏（自行车）
    if (kind === 'bike') {
      const phase = state.crankAngle;
      if (rnodes.legL && rest.legL) {
        rnodes.legL.rotation.x = rest.legL.rot.x + Math.sin(phase) * 0.17;
        rnodes.legL.position.z = rest.legL.pos.z + Math.cos(phase) * 0.012;
      }
      if (rnodes.legR && rest.legR) {
        rnodes.legR.rotation.x = rest.legR.rot.x + Math.sin(phase + Math.PI) * 0.17;
        rnodes.legR.position.z = rest.legR.pos.z + Math.cos(phase + Math.PI) * 0.012;
      }
    }

    // 围巾飘动
    if (rnodes.scarf && rest.scarf) {
      const amp = 0.10 + sp * 0.24;
      rnodes.scarf.rotation.x = rest.scarf.rot.x
        + Math.sin(time * (4.2 + sp * 5)) * amp * 0.55;
      rnodes.scarf.rotation.z = rest.scarf.rot.z
        + Math.sin(time * (3.1 + sp * 3.4)) * amp * 0.7;
    }

    // 尾羽轻摆
    if (rnodes.tail && rest.tail) {
      rnodes.tail.rotation.x = rest.tail.rot.x + Math.sin(time * 3.4) * 0.02 * (0.4 + sp);
    }

    /* ══ 情绪 ══════════════════════════════════════════ */
    if (state.emote) {
      state.emote.t += dt;
      const p = Math.min(1, state.emote.t / state.emote.dur);
      // 快速冲起 + 缓慢回落
      const rise = p < 0.20 ? p / 0.20 : Math.max(0, 1 - (p - 0.20) / 0.80);
      const k = state.emote.kind === 'superCheer' ? 1.0 : 0.74;
      let lift = 0, tilt = 0, bounce = 0;

      if (state.mood === 'cheer' || state.mood === 'superCheer') {
        lift = (0.9 + 0.3 * Math.sin(p * Math.PI * 3)) * k * rise;
        tilt = -0.26 * k * rise;
        bounce = Math.sin(p * Math.PI * 4) * 0.032 * k * rise;
      } else if (state.mood === 'oops') {
        lift = -0.10 * rise;
        tilt = 0.34 * rise;
        bounce = -0.022 * rise;
      } else if (state.mood === 'powerup') {
        lift = 1.0 * rise;
        tilt = -0.32 * rise;
        bounce = Math.sin(p * Math.PI * 6) * 0.036 * rise;
      }

      const lam = Math.min(1, dt * 11);
      state.wingLift += (lift - state.wingLift) * lam;
      state.headTilt += (tilt - state.headTilt) * lam;
      state.bodyBounce += (bounce - state.bodyBounce) * lam;

      if (p >= 1) {
        state.emote = null;
        state.mood = 'idle';
      }
    } else {
      const lam = Math.min(1, dt * 6);
      state.wingLift += (0 - state.wingLift) * lam;
      state.headTilt += (0 - state.headTilt) * lam;
      state.bodyBounce += (0 - state.bodyBounce) * lam;
    }

    // 翅膀：抬翅时向外上方张开
    for (const [tag, sign] of [['wingL', -1], ['wingR', 1]]) {
      const o = rnodes[tag];
      const r = rest[tag];
      if (!o || !r) continue;
      const idle = Math.sin(time * 1.7 + (sign > 0 ? 0 : 1)) * 0.010;
      o.rotation.z = r.rot.z + sign * -state.wingLift * 1.15;
      o.rotation.x = r.rot.x - state.wingLift * 0.50 + idle;
      o.rotation.y = r.rot.y + sign * state.wingLift * 0.28;
      o.position.y = r.pos.y + state.wingLift * 0.14;
    }

    /* ── 车灯 ───────────────────────────────────────── */
    if (nodes.lamp) {
      // 灯本体不发光，靠场景里的 Spotlight（见 world.js）
    }
  }

  function dispose() {
    group.traverse(o => {
      if (o.geometry) o.geometry.dispose();
    });
  }

  return {
    group,
    update,
    setMood,
    applyPalette,
    dispose,
    kind,
    paletteId: pal.id,
    paletteName: pal.name,
    nodes,
    riderNodes: rnodes,
    budget: kind === 'scooter' ? R_WHEEL : R_WHEEL,
  };
}
