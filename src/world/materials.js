// Canvas 纹理与 2D 绘制工具
//
// 历史说明：这个文件原本还有 toon() / outline() / mesh() 等卡通渲染工具，
// 但渲染管线已改为 PBR + HDRI IBL，卡通着色与反向外壳描边全部弃用。
// 现在只保留「把 2D 内容画到 Canvas 再变成纹理」这类与渲染风格无关的工具。
import * as THREE from 'three';

/* ── Canvas 纹理：默认 2x 超采样，避免文字发虚 ── */
export function makeCanvasTexture(w, h, draw, { anisotropy = 8, superSample = 2 } = {}) {
  const S = superSample;
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

/* ── 圆角矩形路径 ── */
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

/* ── 星形路径 ── */
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

/* ── 圆角盒：把 BoxGeometry 的顶点夹到内盒再外推，得到真实圆角 ── */
export function roundBox(w, h, d, r, mat) {
  const geo = new THREE.BoxGeometry(w, h, d, 3, 3, 3);
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
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}
