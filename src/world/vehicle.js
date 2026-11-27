// 座驾：自行车 / 滑板车，各三种配色；统一挂着鹈鹕骑手
import * as THREE from 'three';
import { toon, mesh, tube, outline, roundedBox } from './materials.js';
import { buildPelican } from './pelican.js';
import { PALETTES } from './themes.js';

const TIRE = 0x1a1f2b;
const METAL = 0x9fb0c4;

/**
 * 构建座驾 + 骑手
 * @param {'bike'|'scooter'} kind
 * @param {string} paletteId
 */
export function buildVehicle(kind = 'bike', paletteId = null) {
  const palettes = PALETTES[kind] || PALETTES.bike;
  const pal = palettes.find(p => p.id === paletteId) || palettes[0];

  const g = new THREE.Group();
  const spinGroups = [];
  const wheelSpins = [];
  const fpHidden = [];   // 第一人称下需要隐藏的部件（会挡视野）

  const frameMat = toon(pal.frame);
  const frameDarkMat = toon(pal.frameDark);
  const metalMat = toon(pal.metal || METAL);
  const rimMat = toon(pal.rim || 0xc8d4e2);
  const seatMat = toon(pal.seat || 0x141c2b);

  let pelican;
  let crank = null;
  const pedalArms = [];

  /* ══════════════ 车轮工厂 ══════════════ */
  function makeWheel(z, radius = 0.34, fat = 0.038) {
    const holder = new THREE.Group();
    holder.position.set(0, radius, z);

    const spin = new THREE.Group();
    holder.add(spin);

    const tire = new THREE.Mesh(new THREE.TorusGeometry(radius, fat, 10, 26), toon(TIRE));
    tire.castShadow = true;
    spin.add(tire);

    const rim = new THREE.Mesh(
      new THREE.TorusGeometry(radius - fat - 0.008, 0.014, 6, 24),
      rimMat
    );
    spin.add(rim);

    const hub = new THREE.Mesh(
      new THREE.CylinderGeometry(0.03, 0.03, 0.085, 10),
      metalMat
    );
    hub.rotation.z = Math.PI / 2;
    spin.add(hub);

    // 辐条
    const spokeGeo = new THREE.CylinderGeometry(0.0032, 0.0032, (radius - 0.05) * 2, 3);
    const n = radius > 0.25 ? 8 : 5;
    for (let i = 0; i < n; i++) {
      const s = new THREE.Mesh(spokeGeo, rimMat);
      s.rotation.z = (i * Math.PI) / n;
      spin.add(s);
    }

    // 反光片
    const refl = new THREE.Mesh(new THREE.CircleGeometry(0.024, 8), toon(0xff6a1f));
    refl.position.set(radius * 0.7, 0, 0);
    spin.add(refl);

    holder.rotation.y = Math.PI / 2;
    spinGroups.push(spin);
    return holder;
  }

  /* ══════════════ 自行车 ══════════════ */
  function buildBike() {
    const R = 0.34;
    const WB = 0.54;
    const BB = [0, 0.27, 0.02];
    const SEAT_TOP = [0, 0.86, 0.20];
    const HEAD_TOP = [0, 0.94, -0.30];
    const HEAD_BOT = [0, 0.72, -0.34];
    const BAR = [0, 1.00, -0.40];

    g.add(makeWheel(WB, R));
    g.add(makeWheel(-WB, R));

    const axRear = [0, R, WB];
    const axFront = [0, R, -WB];

    const addTube = (a, b, r, mat = frameMat, ol = 1.06) => {
      const t = tube(a, b, r, mat);
      if (ol) outline(t, ol);
      g.add(t);
      return t;
    };

    addTube(axRear, SEAT_TOP, 0.022);
    addTube(axRear, BB, 0.020);
    addTube(BB, SEAT_TOP, 0.026);
    addTube(BB, HEAD_BOT, 0.028);
    addTube(SEAT_TOP, HEAD_TOP, 0.024);
    addTube(HEAD_BOT, HEAD_TOP, 0.028, frameDarkMat);
    addTube(HEAD_BOT, axFront, 0.020);

    // 座杆 + 座垫
    addTube(SEAT_TOP, [0, 0.93, 0.21], 0.014, metalMat, 1.08);
    g.add(roundedBox(0.09, 0.035, 0.22, 0.018, seatMat, {
      pos: [0, 0.95, 0.21], outlineScale: 1.08,
    }));

    // 车把
    addTube(HEAD_TOP, BAR, 0.016, metalMat, 1.1);
    const bar = mesh(new THREE.CylinderGeometry(0.013, 0.013, 0.34, 8), seatMat, {
      outlineScale: 1.16,
    });
    bar.rotation.z = Math.PI / 2;
    bar.position.set(0, BAR[1], BAR[2]);
    g.add(bar);

    for (const s of [-1, 1]) {
      const grip = mesh(new THREE.CylinderGeometry(0.017, 0.017, 0.075, 8), toon(pal.accent), {
        outlineScale: 1.14,
      });
      grip.rotation.z = Math.PI / 2;
      grip.position.set(s * 0.135, BAR[1], BAR[2]);
      g.add(grip);
      fpHidden.push(grip);
    }

    // 车筐
    const basket = roundedBox(0.22, 0.13, 0.15, 0.025, toon(pal.accent), {
      pos: [0, 0.79, -0.50], outlineScale: 1.08,
    });
    g.add(basket);
    addTube([0, 0.855, -0.50], [0, BAR[1] - 0.02, BAR[2] - 0.02], 0.010, metalMat, 1.15);
    fpHidden.push(basket);

    // 曲柄 + 脚踏
    crank = new THREE.Group();
    crank.position.set(...BB);
    const chainring = new THREE.Mesh(
      new THREE.CylinderGeometry(0.088, 0.088, 0.012, 16), metalMat
    );
    chainring.rotation.z = Math.PI / 2;
    crank.add(chainring);

    for (const s of [-1, 1]) {
      const armGroup = new THREE.Group();
      const arm = mesh(new THREE.BoxGeometry(0.022, 0.15, 0.022), metalMat, {});
      arm.position.set(0, s * 0.075, 0);
      armGroup.add(arm);
      const pedal = roundedBox(0.055, 0.016, 0.085, 0.008, seatMat, {});
      pedal.position.set(0, s * 0.15, 0);
      armGroup.add(pedal);
      armGroup.userData.side = s;
      pedalArms.push(armGroup);
      crank.add(armGroup);
    }
    g.add(crank);

    const chain = mesh(new THREE.BoxGeometry(0.012, 0.014, 0.46), frameDarkMat, {});
    chain.position.set(0.05, BB[1] + 0.02, WB * 0.42);
    g.add(chain);

    // 鹈鹕
    pelican = buildPelican({
      seat: { x: 0, y: 0.98, z: 0.16 },
      pedals: {
        left: { x: -0.085, y: 0.15, z: 0.02 },
        right: { x: 0.085, y: 0.42, z: 0.02 },
      },
      bar: { x: 0, y: BAR[1], z: BAR[2] },
      stand: false,
      palette: pal,
    });
    g.add(pelican.group);

    return { wheelSpin: 5, crankSpin: 2.4 };
  }

  /* ══════════════ 滑板车 ══════════════ */
  function buildScooter() {
    const R_FRONT = 0.145;   // 前轮小
    const R_REAR = 0.115;
    const DECK_Y = 0.20;
    const DECK_Z0 = -0.30;   // 甲板前端
    const DECK_Z1 = 0.34;    // 甲板后端

    // 前轮（在车把立管下方）
    const frontZ = -0.46;
    g.add(makeWheel(frontZ, R_FRONT, 0.032));
    // 后轮
    const rearZ = 0.40;
    g.add(makeWheel(rearZ, R_REAR, 0.030));

    // 甲板
    const deck = roundedBox(0.20, 0.045, DECK_Z1 - DECK_Z0, 0.020, frameMat, {
      pos: [0, DECK_Y, (DECK_Z0 + DECK_Z1) / 2], outlineScale: 1.06,
    });
    g.add(deck);

    // 甲板防滑贴
    const grip = mesh(new THREE.BoxGeometry(0.155, 0.006, DECK_Z1 - DECK_Z0 - 0.10),
      toon(0x252d3d), {});
    grip.position.set(0, DECK_Y + 0.026, (DECK_Z0 + DECK_Z1) / 2);
    g.add(grip);

    // 后轮罩 + 刹车
    const rearFender = mesh(
      new THREE.TorusGeometry(R_REAR + 0.026, 0.020, 6, 14, Math.PI * 1.05),
      frameDarkMat, { outlineScale: 1.07 }
    );
    rearFender.rotation.set(0, Math.PI / 2, 0.28);
    rearFender.position.set(0, DECK_Y - 0.02, rearZ);
    g.add(rearFender);

    // 立管（斜向前）
    const STEM_BOT = [0, DECK_Y + 0.02, frontZ + 0.02];
    const STEM_TOP = [0, 1.06, frontZ + 0.06];
    const stem = tube(STEM_BOT, STEM_TOP, 0.021, frameMat);
    outline(stem, 1.08);
    g.add(stem);

    // 立管与甲板之间的连接块
    const clamp = roundedBox(0.075, 0.075, 0.12, 0.02, frameDarkMat, {
      pos: [0, DECK_Y + 0.005, frontZ + 0.03], outlineScale: 1.08,
    });
    g.add(clamp);

    // 车把
    const BAR = [0, 1.08, frontZ + 0.06];
    const bar = mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.40, 8), seatMat, {
      outlineScale: 1.16,
    });
    bar.rotation.z = Math.PI / 2;
    bar.position.set(...BAR);
    g.add(bar);

    for (const s of [-1, 1]) {
      const grip = mesh(new THREE.CylinderGeometry(0.019, 0.019, 0.09, 8), toon(pal.accent), {
        outlineScale: 1.14,
      });
      grip.rotation.z = Math.PI / 2;
      grip.position.set(s * 0.155, BAR[1], BAR[2]);
      g.add(grip);
      fpHidden.push(grip);
    }

    // 把端小旗（辨识度）
    const flagPole = tube(
      [0.19, BAR[1], BAR[2]],
      [0.19, BAR[1] + 0.30, BAR[2]],
      0.006, metalMat, 1.2
    );
    g.add(flagPole);
    const flag = mesh(new THREE.PlaneGeometry(0.12, 0.07), toon(pal.frame), {
      cast: true, receive: false,
    });
    flag.position.set(0.19 + 0.06, BAR[1] + 0.26, BAR[2]);
    flag.material.side = THREE.DoubleSide;
    g.add(flag);
    fpHidden.push(flagPole, flag);

    // 前灯
    const lamp = mesh(new THREE.SphereGeometry(0.032, 12, 10), toon(0xfff3cc), {});
    lamp.position.set(0, 0.78, frontZ - 0.03);
    g.add(lamp);

    // 鹈鹕：站立在甲板上
    pelican = buildPelican({
      seat: { x: 0, y: DECK_Y + 0.10, z: 0.10 },
      pedals: {
        left: { x: -0.07, y: DECK_Y + 0.02, z: 0.06 },
        right: { x: 0.07, y: DECK_Y + 0.02, z: 0.20 },
      },
      bar: { x: 0, y: BAR[1], z: BAR[2] },
      stand: true,
      palette: pal,
    });
    g.add(pelican.group);

    return { wheelSpin: 4, crankSpin: 0 };
  }

  /* ── 装配 ── */
  const params = kind === 'scooter' ? buildScooter() : buildBike();
  // 游戏视角下略放大，让座驾与鹈鹕更醒目
  g.scale.setScalar(kind === 'scooter' ? 1.18 : 1.10);

  /* ── 动画 ── */
  const state = { wheelAngle: 0, crankAngle: 0, flagPhase: 0 };

  function update(dt, speedRatio, lean = 0, time = 0) {
    const sp = Math.max(0, Math.min(1.2, speedRatio));

    // 车轮
    state.wheelAngle = (state.wheelAngle - (params.wheelSpin + sp * 24) * dt) % (Math.PI * 2);
    for (const s of spinGroups) s.rotation.z = state.wheelAngle;

    // 曲柄（仅自行车）
    if (crank) {
      state.crankAngle = (state.crankAngle - (params.crankSpin + sp * 6.4) * dt) % (Math.PI * 2);
      crank.rotation.x = state.crankAngle;
      for (const arm of pedalArms) arm.rotation.x = -state.crankAngle;
    }

    // 鹈鹕
    pelican.update(dt, speedRatio, time);

    // 侧倾
    g.rotation.z = lean;
    g.rotation.y = lean * 0.5;
  }

  /** 第一人称模式：隐藏会挡住视野的部件 */
  function setFirstPerson(on) {
    // 座驾上挡视野的部件（旗子、车筐）
    for (const obj of fpHidden) obj.visible = !on;

    if (!pelican?.torso) return;
    for (const child of pelican.torso.children) {
      // 保留腿（低头能看到踩踏，增强代入感）
      const isLeg = pelican.legs?.includes(child);
      child.visible = on ? isLeg : true;
    }
  }

  function dispose() {
    g.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
      for (const m of mats) {
        for (const k of Object.keys(m)) if (m[k]?.isTexture) m[k].dispose();
        m.dispose();
      }
    });
  }

  return {
    group: g,
    update,
    setFirstPerson,
    dispose,
    kind,
    paletteId: pal.id,
    paletteName: pal.name,
    pelican,
    crank,
  };
}
