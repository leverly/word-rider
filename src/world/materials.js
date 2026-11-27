// 材质与建模工具：卡通着色、反向外壳描边、常用几何
import * as THREE from 'three';

/* ── 卡通色阶 ── */
let _grad = null;
export function toonGradient() {
  if (_grad) return _grad;
  const steps = [0.34, 0.62, 0.86, 1.0];
  const data = new Uint8Array(steps.map(v => Math.round(v * 255)));
  const t = new THREE.DataTexture(data, steps.length, 1, THREE.RedFormat);
  t.minFilter = THREE.NearestFilter;
  t.magFilter = THREE.NearestFilter;
  t.needsUpdate = true;
  _grad = t;
  return t;
}

const _matCache = new Map();
export function toon(color, opts = {}) {
  const key = color + JSON.stringify(opts);
  if (_matCache.has(key)) return _matCache.get(key);
  const m = new THREE.MeshToonMaterial({ color, gradientMap: toonGradient(), ...opts });
  _matCache.set(key, m);
  return m;
}

export function basic(color, opts = {}) {
  return new THREE.MeshBasicMaterial({ color, ...opts });
}

export function standard(color, opts = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0.0, ...opts });
}

/* ── 描边：反向外壳 ── */
const OUTLINE_COLOR = 0x151d2e;
export function outline(mesh, scale = 1.055, color = OUTLINE_COLOR) {
  const o = new THREE.Mesh(mesh.geometry, new THREE.MeshBasicMaterial({
    color, side: THREE.BackSide, fog: true,
  }));
  o.scale.multiplyScalar(scale);
  o.castShadow = false;
  o.receiveShadow = false;
  o.userData.isOutline = true;
  mesh.add(o);
  return mesh;
}

export function mesh(geo, mat, { cast = true, receive = true, outlineScale = 0, pos = null } = {}) {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = cast;
  m.receiveShadow = receive;
  if (pos) m.position.set(...pos);
  if (outlineScale) outline(m, outlineScale);
  return m;
}

/** 圆柱管（两点之间） */
export function tube(a, b, radius, mat, seg = 8) {
  const A = new THREE.Vector3(...a);
  const B = new THREE.Vector3(...b);
  const len = A.distanceTo(B);
  const m = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, len, seg), mat);
  m.position.copy(A).add(B).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize());
  m.castShadow = true;
  return m;
}

/** 圆角盒（用 Capsule/Box 近似，保持低多边形） */
export function roundBox(w, h, d, r, mat) {
  const geo = new THREE.BoxGeometry(w, h, d, 2, 2, 2);
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  const hw = w / 2 - r, hh = h / 2 - r, hd = d / 2 - r;
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const x = Math.max(-hw, Math.min(hw, v.x));
    const y = Math.max(-hh, Math.min(hh, v.y));
    const z = Math.max(-hd, Math.min(hd, v.z));
    const dir = new THREE.Vector3(v.x - x, v.y - y, v.z - z);
    if (dir.lengthSq() > 1e-8) {
      dir.normalize().multiplyScalar(r);
      v.set(x + dir.x, y + dir.y, z + dir.z);
      pos.setXYZ(i, v.x, v.y, v.z);
    }
  }
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, mat);
}

/** 圆角盒 + 描边 + 位置，一步到位 */
export function roundedBox(w, h, d, r, mat, opts = {}) {
  const m = roundBox(w, h, d, r, mat);
  m.castShadow = opts.cast !== false;
  m.receiveShadow = opts.receive !== false;
  if (opts.pos) m.position.set(...opts.pos);
  if (opts.rotation) m.rotation.set(...opts.rotation);
  if (opts.outlineScale) outline(m, opts.outlineScale);
  return m;
}

/* ── Canvas 纹理工具 ── */
export function makeCanvasTexture(w, h, draw, { anisotropy = 8 } = {}) {
  const S = 2;
  const cv = document.createElement('canvas');
  cv.width = w * S;
  cv.height = h * S;
  const g = cv.getContext('2d');
  g.scale(S, S);
  draw(g, w, h);
  const tex = new THREE.CanvasTexture(cv);
  tex.anisotropy = anisotropy;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function rrPath(g, x, y, w, h, rad) {
  const r = Math.min(rad, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

export function starPath(g, cx, cy, outer, inner, points = 5, rot = -Math.PI / 2) {
  g.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const ang = rot + (i * Math.PI) / points;
    const rad = i % 2 === 0 ? outer : inner;
    const x = cx + Math.cos(ang) * rad;
    const y = cy + Math.sin(ang) * rad;
    i ? g.lineTo(x, y) : g.moveTo(x, y);
  }
  g.closePath();
}

export const FONT_NUM = 'ui-rounded, "SF Pro Rounded", "Helvetica Neue", Arial, sans-serif';
export const FONT_CN = '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif';

/* ── 释放工具（切换场景时） ── */
export function disposeTree(root) {
  root.traverse(o => {
    if (o.geometry) o.geometry.dispose();
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of mats) {
      for (const k of Object.keys(m)) {
        const v = m[k];
        if (v && v.isTexture) v.dispose();
      }
      m.dispose();
    }
  });
}
