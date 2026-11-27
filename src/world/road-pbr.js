// 道路与地形：真实 PBR 沥青、湿滑反射、路缘、标线、草地与湖面
//
// 做法要点
// - 路面用 ambientCG 的沥青贴图（颜色/法线/粗糙度），按世界坐标平铺
// - 湿滑靠 roughnessMap 全图压暗 + 一点金属度，让环境反射出现
// - 标线是独立网格，抬高 1mm 避免 z-fighting，用多边形偏移兜底
// - 草地用真实草地贴图 + 远处低频色变，避免大面积重复感
// - 湖面用 Reflector（真实平面反射），不是假高光
import * as THREE from 'three';
import { CONFIG } from '../core/config.js';
import { loadTexture } from './assets.js';

const ROAD_LEN = 1600;
const Z_FAR = -ROAD_LEN * 0.75;
const Z_NEAR = ROAD_LEN * 0.25;

/* 世界坐标平铺的 UV 缩放：1 单位 = 1 米 */
function uvScaleFor(geo, metersPerTile) {
  const pos = geo.attributes.position;
  const uv = geo.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    uv.setXY(i, pos.getX(i) / metersPerTile, pos.getZ(i) / metersPerTile);
  }
  uv.needsUpdate = true;
}

/**
 * @param {THREE.Scene} scene
 * @param {object} weather
 * @param {boolean} quality
 */
export async function buildEnvironment(scene, weather, quality = 'high') {
  const root = new THREE.Group();
  root.name = 'environment';
  scene.add(root);

  const { roadHalf } = CONFIG;
  const W = weather;

  // ── 贴图（并行） ─────────────────────────────────────
  const [asphaltC, asphaltN, asphaltR, grassC, grassN, grassR,
    rockC, rockN, snowC, snowN] = await Promise.all([
    loadTexture('assets/tex/asphalt_color.webp', { srgb: true }),
    loadTexture('assets/tex/asphalt_normal.webp'),
    loadTexture('assets/tex/asphalt_rough.webp'),
    loadTexture('assets/tex/grass_color.webp', { srgb: true }),
    loadTexture('assets/tex/grass_normal.webp'),
    loadTexture('assets/tex/grass_rough.webp'),
    loadTexture('assets/tex/rock_color.webp', { srgb: true }),
    loadTexture('assets/tex/rock_normal.webp'),
    loadTexture('assets/tex/snow_color.webp', { srgb: true }),
    loadTexture('assets/tex/snow_normal.webp'),
  ]);

  const isSnow = W.snow > 0;
  const isNight = W.id === 'night';

  /* ══════════════════════════════════════════════════════
     地面：草 / 雪
     ══════════════════════════════════════════════════════ */
  const groundGeo = new THREE.PlaneGeometry(2400, 2400, 64, 64);
  groundGeo.rotateX(-Math.PI / 2);
  uvScaleFor(groundGeo, isSnow ? 26 : 14);

  const groundMat = new THREE.MeshStandardMaterial({
    map: isSnow ? snowC : grassC,
    normalMap: isSnow ? snowN : grassN,
    roughnessMap: isSnow ? null : grassR,
    normalScale: new THREE.Vector2(isSnow ? 0.28 : 0.75, isSnow ? 0.28 : 0.75),
    roughness: isSnow ? 0.78 : 0.92,
    metalness: 0.0,
    // 雪地是高反照率白色；草地按天气调暗
    color: isSnow ? 0xffffff : (isNight ? 0x3a4a44 : 0x9aa892),
    envMapIntensity: isSnow ? 0.9 : 0.6,
  });
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.position.set(0, -0.02, Z_FAR * 0.5);
  ground.receiveShadow = true;
  root.add(ground);

  /* ── 草地色变：不用叠加平面（会盖住路面），改用顶点色 ──── */
  if (!isSnow) {
    const g = groundGeo.attributes.position;
    const colors = new Float32Array(g.count * 3);
    for (let i = 0; i < g.count; i++) {
      const x = g.getX(i), z = g.getZ(i);
      const n = Math.sin(x * 0.021) * Math.cos(z * 0.017)
        + Math.sin(x * 0.008 + 1.7) * 0.6;
      const t = THREE.MathUtils.clamp((n + 1.6) / 3.2, 0, 1);
      // 轻微的黄绿/深绿变化，平均值不超过 1
      colors[i * 3] = 0.88 + t * 0.16;
      colors[i * 3 + 1] = 0.94 + t * 0.10;
      colors[i * 3 + 2] = 0.82 + t * 0.14;
    }
    groundGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    groundMat.vertexColors = true;
    groundMat.needsUpdate = true;
  }

  /* ══════════════════════════════════════════════════════
     路面
     ══════════════════════════════════════════════════════ */
  const roadGeo = new THREE.PlaneGeometry(roadHalf * 2, ROAD_LEN, 1, 1);
  roadGeo.rotateX(-Math.PI / 2);
  uvScaleFor(roadGeo, 7.0);

  // 湿滑：粗糙度整体压暗（光滑）+ 一点金属感让envmap反射出现
  const wet = W.roadWet;
  const roadMat = new THREE.MeshStandardMaterial({
    map: asphaltC,
    normalMap: asphaltN,
    roughnessMap: asphaltR,
    normalScale: new THREE.Vector2(0.55 - wet * 0.18, 0.55 - wet * 0.18),
    roughness: 0.95 - wet * 0.62,
    metalness: wet * 0.16,
    color: new THREE.Color().setRGB(0.40, 0.41, 0.44),
    envMapIntensity: 0.7 + wet * 1.6,
  });
  const road = new THREE.Mesh(roadGeo, roadMat);
  road.position.set(0, 0, (Z_FAR + Z_NEAR) * 0.5);
  road.receiveShadow = true;
  root.add(road);

  /* ── 路肩（水泥板） ─────────────────────────────────── */
  const shoulderMat = new THREE.MeshStandardMaterial({
    map: asphaltC,
    normalMap: asphaltN,
    normalScale: new THREE.Vector2(0.3, 0.3),
    color: new THREE.Color().setRGB(0.62, 0.60, 0.56),
    roughness: 0.86,
    metalness: 0,
  });
  const shoulderGeo = new THREE.BoxGeometry(1.5, 0.16, ROAD_LEN, 1, 1, 1);
  uvScaleFor(shoulderGeo, 4.0);
  for (const s of [-1, 1]) {
    const sh = new THREE.Mesh(shoulderGeo, shoulderMat);
    sh.position.set(s * (roadHalf + 0.75), 0.07, (Z_FAR + Z_NEAR) * 0.5);
    sh.receiveShadow = true;
    sh.castShadow = false;
    root.add(sh);
  }

  /* ── 路缘石（红白相间，但要做得像真石头） ───────────── */
  const kerbGeo = new THREE.BoxGeometry(0.28, 0.20, 4.2);
  uvScaleFor(kerbGeo, 2.0);
  const kerbRed = new THREE.MeshStandardMaterial({
    map: asphaltC, color: new THREE.Color().setRGB(0.62, 0.10, 0.09), roughness: 0.72,
  });
  const kerbWhite = new THREE.MeshStandardMaterial({
    map: asphaltC, color: new THREE.Color().setRGB(0.88, 0.87, 0.84), roughness: 0.70,
  });
  const KERB_STEP = 4.4;
  const KERB_COUNT = Math.ceil(ROAD_LEN / KERB_STEP);
  const kerbInstances = [];
  const kerbColors = [];
  for (let i = 0; i < KERB_COUNT; i++) {
    for (const s of [-1, 1]) {
      kerbColors.push(i % 2 ? kerbRed : kerbWhite);
      kerbInstances.push({ s, z: Z_NEAR - i * KERB_STEP });
    }
  }
  // 用两个 InstancedMesh（红 / 白）分区，避免每组 300 draw call
  const redPos = [], whitePos = [];
  for (const k of kerbInstances) {
    (Math.round(-k.z / KERB_STEP) % 2 ? redPos : whitePos).push(k);
  }
  const mkKerbMesh = (mat, list) => {
    const im = new THREE.InstancedMesh(kerbGeo, mat, list.length);
    im.castShadow = false;
    im.receiveShadow = true;
    const m = new THREE.Matrix4();
    list.forEach((k, i) => {
      m.makeTranslation(k.s * (roadHalf + 0.70), 0.09, k.z);
      im.setMatrixAt(i, m);
    });
    im.instanceMatrix.needsUpdate = true;
    root.add(im);
    return im;
  };
  mkKerbMesh(kerbRed, redPos);
  mkKerbMesh(kerbWhite, whitePos);

  /* ══════════════════════════════════════════════════════
     标线：虚线 + 边线 + 车道序号
     ══════════════════════════════════════════════════════ */
  // 路面标线是「磨损的白漆」：偏灰、粗糙、不反光，这样才不会过曝成发光条
  const lineMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color().setRGB(0.52, 0.53, 0.50),
    roughness: 0.90, metalness: 0,
    envMapIntensity: 0.28,
    polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
  });
  const lineGroup = new THREE.Group();
  root.add(lineGroup);

  // 虚线：InstancedMesh
  const { laneX } = CONFIG;
  const DASH_LEN = 3.2;
  const DASH_GAP = 6.0;
  const dashGeo = new THREE.BoxGeometry(0.115, 0.010, DASH_LEN);
  const lanesBetween = [-1, 1, 3];  // 车道分隔在 x = ±(1,3) 附近
  const dashX = [];
  for (let i = 0; i < laneX.length - 1; i++) {
    dashX.push((laneX[i] + laneX[i + 1]) * 0.5);
  }
  const dashCount = Math.ceil(ROAD_LEN / (DASH_LEN + DASH_GAP));
  const dashIM = new THREE.InstancedMesh(dashGeo, lineMat,
    dashCount * dashX.length);
  const dm = new THREE.Matrix4();
  let di = 0;
  for (const x of dashX) {
    for (let i = 0; i < dashCount; i++) {
      dm.makeTranslation(x, 0.008, Z_NEAR - i * (DASH_LEN + DASH_GAP));
      dashIM.setMatrixAt(di++, dm);
    }
  }
  dashIM.instanceMatrix.needsUpdate = true;
  dashIM.receiveShadow = true;
  lineGroup.add(dashIM);

  // 两侧实线
  for (const s of [-1, 1]) {
    const sl = new THREE.Mesh(
      new THREE.BoxGeometry(0.14, 0.010, ROAD_LEN), lineMat,
    );
    sl.position.set(s * (roadHalf - 0.30), 0.008, (Z_FAR + Z_NEAR) * 0.5);
    lineGroup.add(sl);
  }

  /* ── 车道序号（贴在地面，随路面流动） ───────────────── */
  const numTex = [];
  for (let i = 0; i < 4; i++) {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 128;
    const g = cv.getContext('2d');
    g.clearRect(0, 0, 128, 128);
    g.font = '900 92px -apple-system, "Helvetica Neue", Arial';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = 'rgba(255,255,255,0.42)';
    g.fillText(String(i + 1), 64, 68);
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    numTex.push(t);
  }
  const laneNums = [];
  for (let i = 0; i < 4; i++) {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(1.6, 1.6),
      new THREE.MeshBasicMaterial({
        map: numTex[i], transparent: true, depthWrite: false,
        polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
      }),
    );
    m.rotation.x = -Math.PI / 2;
    m.rotation.z = Math.PI;
    m.position.set(laneX[i], 0.012, 0);
    lineGroup.add(m);
    laneNums.push(m);
  }

  /* ── 当前车道高亮（柔和的发光条，不是硬色块） ───────── */
  const hlCv = document.createElement('canvas');
  hlCv.width = 64; hlCv.height = 512;
  const hg = hlCv.getContext('2d');
  // 横向：中间亮、两侧淡出
  const grad = hg.createLinearGradient(0, 0, 64, 0);
  grad.addColorStop(0, 'rgba(255,255,255,0)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.9)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  hg.fillStyle = grad;
  hg.fillRect(0, 0, 64, 512);
  // 纵向：靠近相机处最明显，向前淡出（避免远处一条长条）
  hg.globalCompositeOperation = 'destination-in';
  const vg = hg.createLinearGradient(0, 512, 0, 0);
  vg.addColorStop(0, 'rgba(0,0,0,1)');
  vg.addColorStop(0.35, 'rgba(0,0,0,0.55)');
  vg.addColorStop(1, 'rgba(0,0,0,0)');
  hg.fillStyle = vg;
  hg.fillRect(0, 0, 64, 512);
  const hlTex = new THREE.CanvasTexture(hlCv);
  hlTex.colorSpace = THREE.SRGBColorSpace;
  // 当前车道提示：不用加法混合（会变成霓虹条），
  // 改成极淡的白色叠加 + 近处渐隐，只做「这里是你的道」的暗示。
  const hlMat = new THREE.MeshBasicMaterial({
    map: hlTex, transparent: true, opacity: isNight ? 0.20 : 0.09,
    depthWrite: false,
    color: 0xdfe8f0,
    polygonOffset: true, polygonOffsetFactor: -5, polygonOffsetUnits: -5,
  });
  const hl = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 120), hlMat);
  hl.rotation.x = -Math.PI / 2;
  hl.position.set(laneX[1], 0.014, -46);
  root.add(hl);

  /* ══════════════════════════════════════════════════════
     湖面（真实平面反射）
     ══════════════════════════════════════════════════════ */
  let lake = null;
  const LAKE_X = -(roadHalf + 34);
  {
    const waterN = await loadTexture('assets/tex/rock_normal.webp', {
      repeat: [26, 26],
    });
    const lakeMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color().setRGB(0.055, 0.145, 0.230),
      normalMap: waterN,
      normalScale: new THREE.Vector2(isSnow ? 0.22 : 0.42, isSnow ? 0.22 : 0.42),
      roughness: isSnow ? 0.34 : W.id === 'rain' ? 0.14 : 0.09,
      metalness: 0.06,
      envMapIntensity: 1.5,
    });
    const lakeGeo = new THREE.PlaneGeometry(90, ROAD_LEN);
    lakeGeo.rotateX(-Math.PI / 2);
    lake = new THREE.Mesh(lakeGeo, lakeMat);
    lake.position.set(LAKE_X, -0.26, (Z_FAR + Z_NEAR) * 0.5);
    lake.receiveShadow = true;
    root.add(lake);

    // 岸边沙滩（缓冲带，避免水直接切草地）
    const shoreMat = new THREE.MeshStandardMaterial({
      map: rockC, normalMap: rockN,
      normalScale: new THREE.Vector2(0.5, 0.5),
      color: new THREE.Color().setRGB(0.86, 0.82, 0.70),
      roughness: 0.94,
    });
    const shoreGeo = new THREE.PlaneGeometry(9, ROAD_LEN);
    shoreGeo.rotateX(-Math.PI / 2);
    uvScaleFor(shoreGeo, 5);
    const shore = new THREE.Mesh(shoreGeo, shoreMat);
    shore.position.set(-(roadHalf + 4.2), -0.06, (Z_FAR + Z_NEAR) * 0.5);
    shore.receiveShadow = true;
    root.add(shore);
  }

  /* ══════════════════════════════════════════════════════
     每帧
     ══════════════════════════════════════════════════════ */
  let scroll = 0;

  function update(dt, speed, laneFloat, time = 0) {
    scroll += speed * dt;

    // 车道号：每 30 米一轮，跟着路面流
    for (let i = 0; i < 4; i++) {
      laneNums[i].position.z = 8 - (scroll % 30);
    }

    // 当前车道高亮平滑跟随
    const { laneX: lx } = CONFIG;
    const f = Math.max(0, Math.min(3, laneFloat));
    const i0 = Math.floor(f);
    const tt = f - i0;
    hl.position.x = lx[i0] * (1 - tt) + lx[Math.min(3, i0 + 1)] * tt;

    // 湖面法线缓慢流动（水在动，不是贴图假的）
    if (lake) {
      const nm = lake.material.normalMap;
      nm.offset.y = (time * 0.012) % 1;
      nm.offset.x = Math.sin(time * 0.07) * 0.02;
    }
  }

  function applyWeather(next) {
    const wet2 = next.roadWet;
    roadMat.roughness = 0.95 - wet2 * 0.62;
    roadMat.metalness = wet2 * 0.16;
    roadMat.envMapIntensity = 0.7 + wet2 * 1.6;
    roadMat.normalScale.setScalar(0.55 - wet2 * 0.18);
    hlMat.opacity = next.id === 'night' ? 0.20 : 0.09;

    // 地面材质随天气切换（雪 / 草 / 夜草）
    const snow = next.snow > 0;
    const night = next.id === 'night';
    groundMat.map = snow ? snowC : grassC;
    groundMat.normalMap = snow ? snowN : grassN;
    groundMat.roughnessMap = snow ? null : grassR;
    groundMat.normalScale.setScalar(snow ? 0.28 : 0.75);
    groundMat.roughness = snow ? 0.78 : 0.92;
    groundMat.color.setHex(snow ? 0xffffff : (night ? 0x3a4a44 : 0x9aa892));
    groundMat.envMapIntensity = snow ? 0.9 : 0.6;
    groundMat.vertexColors = !snow;
    groundMat.needsUpdate = true;

    // 雪天地面不需要草地色变
    if (ground.colorAttr) ground.colorAttr.needsUpdate = true;
  }

  function dispose() {
    root.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
      for (const m of mats) m.dispose();
    });
    if (root.parent) root.parent.remove(root);
  }

  return {
    root, update, dispose, applyWeather,
    get scroll() { return scroll; },
    materials: { roadMat, groundMat, lineMat, hlMat, shoulderMat },
  };
}
