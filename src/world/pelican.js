// 程序化建模：鹈鹕骑手
// 特征：大白身、超长橙色喙 + 大喉囊、短橙腿踩踏板、双翼前伸握把
import * as THREE from 'three';
import { toon, mesh, roundedBox, outline } from './materials.js';

const SKIN = {
  body: 0xf7f8fa,
  bodyShade: 0xe4e8ee,
  wing: 0xe8ecf2,
  wingTip: 0xc9d2dd,
  beak: 0xffb03a,
  beakDark: 0xe08a1c,
  pouch: 0xffcf7a,
  pouchDark: 0xf5b955,
  leg: 0xf0a040,
  legDark: 0xd78728,
  eye: 0x1b2230,
  eyeWhite: 0xffffff,
  crest: 0xfff4d6,
};

/**
 * @param {object} opts
 *   seat      { x,y,z }  臀部基准点（座垫位置）
 *   pedals    { left:{x,y,z}, right:{x,y,z} }  踏板世界坐标（相对本组）
 *   bar       { x,y,z }  车把/把手位置
 *   stand     boolean    是否站立姿态（滑板车）
 *   palette   { frame, accent }  用于头盔/围巾配色
 */
export function buildPelican(opts = {}) {
  const {
    seat = { x: 0, y: 0.98, z: 0.16 },
    pedals = {
      left: { x: -0.085, y: 0.15, z: 0.02 },
      right: { x: 0.085, y: 0.42, z: 0.02 },
    },
    bar = { x: 0, y: 1.02, z: -0.40 },
    stand = false,
    palette = { frame: 0x1fb3ab, accent: 0xffb648 },
  } = opts;

  const g = new THREE.Group();
  const body = toon(SKIN.body);
  const shade = toon(SKIN.bodyShade);
  const wingMat = toon(SKIN.wing);
  const beakMat = toon(SKIN.beak);
  const pouchMat = toon(SKIN.pouch);
  const legMat = toon(SKIN.leg);

  /* ── 身体：水滴形（椭圆球 + 后半抬高） ── */
  const torso = new THREE.Group();
  torso.position.set(seat.x, seat.y + (stand ? 0.18 : 0.12), seat.z - 0.02);
  // 前倾角度：坐着前倾 30°，站着前倾 12°
  const lean = stand ? -0.2 : -0.52;
  torso.rotation.x = lean;

  const belly = mesh(new THREE.SphereGeometry(0.20, 20, 16), body, { outlineScale: 1.05 });
  belly.scale.set(1.0, 1.18, 1.32);
  torso.add(belly);

  // 背部收窄（用另一颗球叠加，形成水滴）
  const back = mesh(new THREE.SphereGeometry(0.155, 18, 14), shade, {});
  back.position.set(0, 0.055, 0.17);
  back.scale.set(0.92, 0.95, 1.1);
  torso.add(back);

  // 胸口白色高光
  const chest = mesh(new THREE.SphereGeometry(0.125, 16, 12), toon(0xfdfeff), {});
  chest.position.set(0, -0.03, -0.13);
  chest.scale.set(0.95, 1.05, 0.72);
  torso.add(chest);

  g.add(torso);

  /* ── 尾羽 ── */
  const tail = new THREE.Group();
  tail.position.set(0, 0.02, 0.235);
  tail.rotation.x = 0.35;
  for (const [rot, len] of [[-0.26, 0.13], [0, 0.17], [0.26, 0.13]]) {
    const f = mesh(new THREE.ConeGeometry(0.038, len, 6), wingMat, { outlineScale: 1.08 });
    f.rotation.set(Math.PI / 2 + 0.28, rot, 0);
    f.position.set(rot * 0.09, 0, len * 0.45);
    tail.add(f);
  }
  torso.add(tail);

  /* ── 脖子（S 形，用几段球串成） ── */
  const neckBase = new THREE.Vector3(0, 0.16, -0.16);
  const headPos = new THREE.Vector3(0, stand ? 0.42 : 0.36, stand ? -0.16 : -0.20);
  const neckSegs = 4;
  const neckGroup = new THREE.Group();
  for (let i = 0; i < neckSegs; i++) {
    const t = i / (neckSegs - 1);
    const r = 0.082 - t * 0.024;
    const seg = mesh(new THREE.SphereGeometry(r, 14, 10), i % 2 ? shade : body, {});
    // S 形：先向后上，再向前
    const bend = Math.sin(t * Math.PI) * 0.055;
    seg.position.set(
      0,
      neckBase.y + (headPos.y - neckBase.y) * t,
      neckBase.z + (headPos.z - neckBase.z) * t + bend
    );
    neckGroup.add(seg);
  }
  torso.add(neckGroup);

  /* ── 头 + 喙 + 喉囊 ── */
  const head = new THREE.Group();
  head.position.copy(headPos);
  head.rotation.x = -lean * 0.55;   // 头部回正，略朝前

  const skull = mesh(new THREE.SphereGeometry(0.105, 18, 14), body, { outlineScale: 1.06 });
  skull.scale.set(1, 0.94, 1.06);
  head.add(skull);

  // 头顶冠羽
  const crest = new THREE.Group();
  for (const [dx, len] of [[-0.03, 0.075], [0.015, 0.09], [0.055, 0.068]]) {
    const c = mesh(new THREE.ConeGeometry(0.017, len, 5), toon(SKIN.crest), {});
    c.position.set(dx, 0.095, 0.035);
    c.rotation.set(-0.5, 0, dx * 2.2);
    crest.add(c);
  }
  head.add(crest);

  /* 喙：上喙细长带钩，下喙挂大喉囊 */
  const beak = new THREE.Group();
  beak.position.set(0, -0.015, -0.085);
  beak.rotation.x = 0.12;

  // 上喙
  const upperBeak = mesh(
    new THREE.CylinderGeometry(0.019, 0.032, 0.30, 10),
    beakMat,
    { outlineScale: 1.09 }
  );
  upperBeak.rotation.x = Math.PI / 2;
  upperBeak.position.set(0, 0.006, -0.145);
  upperBeak.scale.set(1, 1, 0.62);
  beak.add(upperBeak);

  // 上喙尖端小钩
  const hook = mesh(new THREE.ConeGeometry(0.019, 0.045, 8), toon(SKIN.beakDark), {});
  hook.rotation.x = -Math.PI / 2 - 0.3;
  hook.position.set(0, -0.004, -0.295);
  beak.add(hook);

  // 下喙（细，藏在喉囊上方）
  const lowerBeak = mesh(
    new THREE.CylinderGeometry(0.013, 0.022, 0.26, 8),
    toon(SKIN.beakDark),
    {}
  );
  lowerBeak.rotation.x = Math.PI / 2;
  lowerBeak.position.set(0, -0.028, -0.135);
  beak.add(lowerBeak);

  // 喉囊：大袋子，垂在下面
  const pouch = mesh(new THREE.SphereGeometry(0.085, 18, 14), pouchMat, { outlineScale: 1.04 });
  pouch.scale.set(0.92, 0.82, 1.62);
  pouch.position.set(0, -0.072, -0.15);
  beak.add(pouch);

  // 喉囊底部颜色加深
  const pouchShade = mesh(new THREE.SphereGeometry(0.062, 14, 10), toon(SKIN.pouchDark), {});
  pouchShade.scale.set(0.9, 0.55, 1.45);
  pouchShade.position.set(0, -0.098, -0.16);
  beak.add(pouchShade);

  head.add(beak);

  // 眼睛
  for (const s of [-1, 1]) {
    const eyeWhite = mesh(new THREE.SphereGeometry(0.026, 12, 10), toon(SKIN.eyeWhite), {});
    eyeWhite.position.set(s * 0.062, 0.022, -0.058);
    head.add(eyeWhite);

    const pupil = mesh(new THREE.SphereGeometry(0.016, 10, 8), toon(SKIN.eye), {});
    pupil.position.set(s * 0.070, 0.024, -0.070);
    head.add(pupil);

    const glint = mesh(new THREE.SphereGeometry(0.006, 6, 5), toon(0xffffff), {});
    glint.position.set(s * 0.076, 0.033, -0.079);
    head.add(glint);
  }

  // 头巾/小帽（用座驾主色的补色，增加辨识度）
  const cap = mesh(
    new THREE.SphereGeometry(0.108, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.44),
    toon(palette.frame),
    { outlineScale: 1.06 }
  );
  cap.position.set(0, 0.035, 0.008);
  head.add(cap);

  const capBand = mesh(new THREE.TorusGeometry(0.104, 0.011, 5, 18), toon(palette.accent), {});
  capBand.rotation.x = Math.PI / 2;
  capBand.position.set(0, 0.032, 0.008);
  head.add(capBand);

  torso.add(head);

  // 围巾（随风飘）
  const scarf = new THREE.Group();
  const scarfMat = toon(palette.accent);
  const knot = mesh(new THREE.SphereGeometry(0.038, 10, 8), scarfMat, {});
  knot.position.set(0, 0.115, -0.10);
  scarf.add(knot);

  const scarfTails = [];
  for (const [dx, len, ph] of [[-0.02, 0.20, 0], [0.025, 0.16, 1.2]]) {
    const t = mesh(new THREE.BoxGeometry(0.05, 0.012, len), scarfMat, {});
    t.position.set(dx, 0.108, -0.10 + len * 0.5);
    t.userData = { len, ph, dx };
    scarf.add(t);
    scarfTails.push(t);
  }
  torso.add(scarf);

  /* ── 翅膀：前伸到把手 ── */
  const wings = [];
  for (const s of [-1, 1]) {
    const wing = new THREE.Group();
    const shoulder = new THREE.Vector3(s * 0.15, 0.10, -0.10);
    const grip = new THREE.Vector3(bar.x + s * 0.135, bar.y - seat.y - (stand ? 0.18 : 0.12), bar.z);

    // 上臂
    const upper = mesh(new THREE.CapsuleGeometry(0.036, 0.13, 5, 10), body, {
      outlineScale: 1.05,
    });
    const midA = shoulder.clone().lerp(grip, 0.34);
    upper.position.copy(midA);
    upper.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0),
      grip.clone().sub(shoulder).normalize());
    upper.scale.set(1, 0.62 / 0.202, 0.86);
    wing.add(upper);

    // 前臂/翼面
    const fore = mesh(new THREE.CapsuleGeometry(0.030, 0.15, 5, 10), wingMat, {
      outlineScale: 1.05,
    });
    const midB = shoulder.clone().lerp(grip, 0.72);
    fore.position.copy(midB);
    fore.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0),
      grip.clone().sub(shoulder).normalize());
    fore.scale.set(1.25, 0.78 / 0.21, 0.55);
    wing.add(fore);

    // 翼尖羽毛
    for (let i = 0; i < 3; i++) {
      const f = mesh(new THREE.ConeGeometry(0.020, 0.075, 5), toon(SKIN.wingTip), {});
      f.position.copy(grip).add(new THREE.Vector3(s * (0.02 + i * 0.016), 0.015, 0.035 + i * 0.02));
      f.rotation.set(1.5, 0, s * (0.4 + i * 0.2));
      wing.add(f);
    }

    // 翼爪（握住把手）
    const claw = mesh(new THREE.IcosahedronGeometry(0.030, 1), toon(SKIN.beak), { outlineScale: 1.1 });
    claw.position.copy(grip);
    wing.add(claw);

    wings.push(wing);
    torso.add(wing);
  }

  /* ── 腿：从身体下方到踏板 ── */
  const legs = [];
  for (const [key, s] of [['left', -1], ['right', 1]]) {
    const target = pedals[key];
    const leg = new THREE.Group();
    const hip = new THREE.Vector3(s * 0.062, -0.10, 0.02);
    leg.position.copy(hip);

    // 大腿（白色羽毛）
    const thighLen = 0.13;
    const thigh = mesh(new THREE.CapsuleGeometry(0.032, thighLen, 5, 9), body, {
      outlineScale: 1.06,
    });
    thigh.position.set(0, -thighLen * 0.5 - 0.01, 0.01);
    leg.add(thigh);

    // 小腿（橙色细杆）
    const shinTarget = new THREE.Vector3(
      target.x - hip.x, target.y - hip.y, target.z - hip.z
    );
    const shinLen = shinTarget.length() * 0.52;
    const shin = mesh(new THREE.CylinderGeometry(0.0105, 0.012, shinLen, 7), legMat, {
      outlineScale: 1.12,
    });
    const shinMid = new THREE.Vector3(0, -thighLen - 0.01, 0.01)
      .lerp(shinTarget, 0.55);
    shin.position.copy(shinMid);
    shin.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0),
      shinTarget.clone().normalize());
    leg.add(shin);

    // 蹼足
    const foot = new THREE.Group();
    foot.position.set(shinTarget.x - s * 0.006, shinTarget.y, shinTarget.z);
    for (const [rot, len] of [[-0.42, 0.055], [0, 0.062], [0.42, 0.055]]) {
      const toe = mesh(new THREE.ConeGeometry(0.014, len, 5), legMat, { outlineScale: 1.12 });
      toe.rotation.set(Math.PI / 2, rot, 0);
      toe.position.set(Math.sin(rot) * len * 0.4, 0.004, -len * 0.42);
      foot.add(toe);
    }
    leg.add(foot);

    leg.userData = { side: s, key };
    legs.push(leg);
    torso.add(leg);
  }

  /* ── 侧挂小书包（学习感） ── */
  const bag = roundedBox(0.13, 0.14, 0.075, 0.022, toon(palette.accent), {
    outlineScale: 1.08,
  });
  bag.position.set(0.02, -0.02, 0.20);
  bag.rotation.x = -0.2;
  torso.add(bag);
  const bagStrap = mesh(new THREE.BoxGeometry(0.135, 0.014, 0.012), toon(0x2a3244), {});
  bagStrap.position.set(0.02, 0.045, 0.205);
  bagStrap.rotation.x = -0.2;
  torso.add(bagStrap);

  g.add(torso);

  /* ── 动画 ── */
  const state = { blink: 0, blinkTimer: 2 + Math.random() * 3, flap: 0 };

  function update(dt, speedRatio, time = 0) {
    const sp = Math.max(0, Math.min(1.2, speedRatio));

    // 呼吸 / 踩踏起伏
    torso.position.y = seat.y + (stand ? 0.18 : 0.12) + Math.sin(time * 3.4) * 0.006 * (0.4 + sp);

    // 摇脖（随速度轻微点头）
    head.rotation.x = -lean * 0.55 + Math.sin(time * 2.6) * 0.035 * (0.3 + sp);

    // 围巾飘动
    for (const t of scarfTails) {
      const { len, ph, dx } = t.userData;
      t.rotation.x = Math.sin(time * (5 + sp * 6) + ph) * 0.20 * (0.35 + sp);
      t.rotation.y = Math.sin(time * (3.4 + sp * 4) + ph) * 0.22 * (0.35 + sp);
      t.position.y = 0.108 + Math.sin(time * 6 + ph) * 0.006;
    }

    // 眨眼
    state.blinkTimer -= dt;
    if (state.blinkTimer <= 0) {
      state.blinkTimer = 2.4 + Math.random() * 3.6;
      state.blink = 0.13;
    }
    if (state.blink > 0) {
      state.blink -= dt;
      const k = state.blink > 0 ? 0.1 : 1;
      for (const child of head.children) {
        if (child.geometry?.type === 'SphereGeometry' && child.material === toon(SKIN.eyeWhite)) {
          child.scale.y = k;
        }
      }
    }

    // 腿踩踏（坐姿才有）
    if (!stand) {
      for (const leg of legs) {
        const phase = time * (3.2 + sp * 5.2) + (leg.userData.side > 0 ? 0 : Math.PI);
        leg.rotation.x = Math.sin(phase) * 0.12;
      }
    }

    // 翅膀轻微调整
    for (let i = 0; i < wings.length; i++) {
      wings[i].rotation.z = Math.sin(time * 1.8 + i) * 0.012;
    }
    state.flap += dt;
  }

  return { group: g, update, torso, head, legs };
}
