// 选项牌 + 门架（PBR 版）
//
// 与旧版差别
// 旧：MeshToonMaterial + MeshBasicMaterial 牌面 → 像贴纸
// 新：金属桁架 + 自发光牌面 + 真实接触阴影。
//     牌面仍然用 Canvas 画（文字必须清晰），但改用 PBR 自发光材质，
//     这样夜间会进 bloom，白天有金属反射。
import * as THREE from 'three';
import { CONFIG } from '../core/config.js';
import { roundBox, makeCanvasTexture, rrPath, starPath, FONT_NUM, FONT_CN } from './materials.js';

const STEEL = 0x2c3442;

/* ── 牌面纹理 ── */
function boardTexture(label, colorHex, opts) {
  const { num, state = 'idle', star = false, letters = false } = opts;
  const cw = 640, ch = 232;
  return makeCanvasTexture(cw, ch, (g) => {
    const hex = '#' + colorHex.toString(16).padStart(6, '0');
    const r = 30;

    // 底色
    if (state === 'correct') g.fillStyle = '#1ea85a';
    else if (state === 'wrong') g.fillStyle = '#d63c3c';
    else if (state === 'disabled') g.fillStyle = '#4a5462';
    else g.fillStyle = hex;
    rrPath(g, 4, 4, cw - 8, ch - 8, r);
    g.fill();

    // 纵向渐变：上亮下暗（塑料牌面感）
    g.save();
    rrPath(g, 4, 4, cw - 8, ch - 8, r);
    g.clip();
    const lg = g.createLinearGradient(0, 4, 0, ch - 4);
    lg.addColorStop(0, 'rgba(255,255,255,0.26)');
    lg.addColorStop(0.46, 'rgba(255,255,255,0.04)');
    lg.addColorStop(1, 'rgba(0,0,0,0.18)');
    g.fillStyle = lg;
    g.fillRect(0, 0, cw, ch);
    g.restore();

    // 内描边
    g.strokeStyle = state === 'selected' ? '#ffffff'
      : star ? '#ffe08a' : 'rgba(10,16,26,0.42)';
    g.lineWidth = state === 'selected' ? 10 : star ? 7 : 5;
    rrPath(g, 4, 4, cw - 8, ch - 8, r);
    g.stroke();

    // 序号徽标：放在左上角，与主文字区分开
    const bx = 34, by = 30, br = 25;
    g.fillStyle = state === 'selected' ? '#0d1626' : 'rgba(8,14,24,0.42)';
    g.beginPath(); g.arc(bx, by, br, 0, Math.PI * 2); g.fill();
    g.fillStyle = state === 'selected' ? hex : '#ffffff';
    g.font = `800 30px ${FONT_NUM}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(String(num), bx, by + 1);

    // 选项文字
    const dark = colorHex === 0xffc233 && (state === 'idle' || state === 'selected');
    g.fillStyle = dark ? '#101a2a' : '#ffffff';
    let fs = letters ? 104 : 78;
    const maxW = cw - 96 - 30 - (star ? 120 : 20);
    do {
      g.font = `800 ${fs}px ${letters ? FONT_NUM : FONT_CN}`;
      if (g.measureText(label).width <= maxW) break;
      fs -= 4;
    } while (fs > 34);
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.fillText(label, 96, 128);

    // 星标
    if (star) {
      const sx = cw - 70, sy = 62, R = 36;
      g.fillStyle = '#ffd166';
      g.beginPath(); g.arc(sx, sy, R, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#7a4d00';
      starPath(g, sx, sy, 21, 9.5);
      g.fill();
    }

    // 对错图标
    if (state === 'correct' || state === 'wrong') {
      g.strokeStyle = '#ffffff';
      g.lineWidth = 12;
      g.lineCap = 'round';
      g.lineJoin = 'round';
      if (state === 'correct') {
        g.beginPath();
        g.moveTo(28, 168); g.lineTo(50, 192); g.lineTo(92, 138);
        g.stroke();
      } else {
        g.beginPath();
        g.moveTo(32, 144); g.lineTo(88, 196);
        g.moveTo(88, 144); g.lineTo(32, 196);
        g.stroke();
      }
    }
  });
}

/* ── 题干牌纹理（沿用旧版排版逻辑，视觉更新） ── */
function stemTexture(stem, star) {
  const cw = 1120, ch = 210;
  return makeCanvasTexture(cw, ch, (g) => {
    // 深色玻璃底
    const lg = g.createLinearGradient(0, 8, 0, ch - 8);
    lg.addColorStop(0, 'rgba(20,32,50,0.96)');
    lg.addColorStop(1, 'rgba(10,18,30,0.96)');
    g.fillStyle = lg;
    rrPath(g, 6, 6, cw - 12, ch - 12, 26);
    g.fill();

    g.strokeStyle = star ? '#ffd166' : 'rgba(150,180,215,0.42)';
    g.lineWidth = star ? 9 : 5;
    rrPath(g, 6, 6, cw - 12, ch - 12, 26);
    g.stroke();

    // 喇叭
    const spkX = 84, spkY = 97;
    g.fillStyle = '#ffd166';
    g.beginPath(); g.arc(spkX, spkY, 36, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#12203a';
    g.beginPath();
    g.moveTo(spkX - 13, spkY - 8);
    g.lineTo(spkX - 4, spkY - 8);
    g.lineTo(spkX + 8, spkY - 20);
    g.lineTo(spkX + 8, spkY + 20);
    g.lineTo(spkX - 4, spkY + 8);
    g.lineTo(spkX - 13, spkY + 8);
    g.closePath(); g.fill();
    g.strokeStyle = '#12203a';
    g.lineWidth = 4.5;
    g.lineCap = 'round';
    g.beginPath(); g.arc(spkX + 7, spkY, 12, -0.9, 0.9); g.stroke();

    let text = stem.text;
    if (stem.audioOnly) text = '听读音 · 选含义';

    let fs = stem.audioOnly ? 58 : 80;
    const avail = cw - 150 - (star ? 290 : 36);
    const holeWFor = f => stem.blank.len * f * 0.5;
    const measure = () => {
      g.font = `800 ${fs}px ${FONT_NUM}`;
      if (!stem.blank) return g.measureText(text).width;
      const { pre, post } = stem.blank;
      return g.measureText(pre).width + holeWFor(fs) + g.measureText(post).width;
    };
    while (measure() > avail && fs > 32) fs -= 4;

    g.textAlign = 'left';
    g.textBaseline = 'alphabetic';

    if (stem.blank) {
      const { pre, len, post } = stem.blank;
      g.font = `800 ${fs}px ${FONT_NUM}`;
      const x0 = 146, baseY = 126;
      const preW = g.measureText(pre).width;
      const holeW = holeWFor(fs);
      const barH = Math.max(11, fs * 0.13);
      g.fillStyle = '#ffd166';
      rrPath(g, x0 + preW + 2, baseY + fs * 0.04, holeW - 4, barH, barH / 2);
      g.fill();
      g.fillStyle = '#ffffff';
      g.fillText(pre, x0, baseY);
      g.fillText(post, x0 + preW + holeW, baseY);
    } else {
      g.fillStyle = '#ffffff';
      g.fillText(text, 146, 126);
    }

    if (stem.sub) {
      const bits = [];
      if (stem.phonetic) bits.push(stem.phonetic);
      if (stem.pos) bits.push(stem.pos);
      bits.push(stem.sub);
      const line = bits.join('   ');
      let sfs = 38;
      do {
        g.font = `700 ${sfs}px ${FONT_CN}`;
        if (g.measureText(line).width <= avail) break;
        sfs -= 2;
      } while (sfs > 22);
      g.fillStyle = '#ffd166';
      g.fillText(line, 146, 176);
    } else {
      let x = 146 + g.measureText(text).width + 24;
      if (stem.phonetic) {
        g.fillStyle = '#9fb0c4';
        g.font = '600 42px "Helvetica Neue", Arial';
        g.fillText(stem.phonetic, x, 124);
        x += g.measureText(stem.phonetic).width + 20;
      }
      if (stem.pos) {
        g.fillStyle = '#5ee6ff';
        g.font = `800 32px ${FONT_CN}`;
        const pw = Math.max(78, g.measureText(stem.pos).width + 36);
        rrPath(g, x, 74, pw, 52, 13);
        g.fill();
        g.fillStyle = '#12203a';
        g.fillText(stem.pos, x + 18, 113);
      }
    }

    if (star) {
      const bw = 258, bh = 58, bx = cw - bw - 18, by = 18;
      g.fillStyle = '#ffd166';
      rrPath(g, bx, by, bw, bh, 28);
      g.fill();
      const sx = bx + 38, sy = by + bh / 2;
      g.fillStyle = '#7a4d00';
      starPath(g, sx, sy, 20, 8.5);
      g.fill();
      g.font = `800 36px ${FONT_CN}`;
      g.textAlign = 'left';
      g.textBaseline = 'middle';
      g.fillText('答对得道具', bx + 64, sy + 2);
    }
  });
}

/* ══════════════════════════════════════════════════════════
   选项牌
   ══════════════════════════════════════════════════════════ */
export class OptionBoard {
  constructor(laneIndex) {
    this.lane = laneIndex;
    this.colorHex = CONFIG.laneColors[laneIndex];
    this.state = 'idle';
    this.star = false;
    this.letters = false;
    this.label = '';

    this.group = new THREE.Group();
    this.group.position.set(CONFIG.laneX[laneIndex], 4.9, 0);

    const BW = 3.5;
    const BH = BW * (232 / 640);

    // 金属框（背板）
    this.back = roundBox(BW * 1.02, BH * 1.06, 0.10, 0.06,
                         new THREE.MeshStandardMaterial({
                           color: STEEL, roughness: 0.38, metalness: 0.85,
                         }));
    this.back.position.z = -0.06;
    this.back.castShadow = true;
    this.group.add(this.back);

    // 牌面：自发光 PBR（夜间进 bloom，白天仍有反射）
    this.faceMat = new THREE.MeshStandardMaterial({
      transparent: true,
      roughness: 0.30,
      metalness: 0.0,
      emissive: new THREE.Color(0xffffff),
      emissiveIntensity: 0.22,
      envMapIntensity: 0.85,
    });
    this.face = new THREE.Mesh(new THREE.PlaneGeometry(BW, BH), this.faceMat);
    this.face.position.z = 0.02;
    this.group.add(this.face);

    // 选中光晕
    this.glowMat = new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0,
      depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.glow = new THREE.Mesh(new THREE.PlaneGeometry(BW * 1.14, BH * 1.26), this.glowMat);
    this.glow.position.z = 0.005;
    this.group.add(this.glow);

    this._tex = null;
    this._pulse = 0;
  }

  setContent(label, star, letters = false) {
    this.label = label;
    this.star = star;
    this.letters = letters;
    this._redraw();
  }

  setState(state) {
    if (this.state === state) return;
    this.state = state;
    this._redraw();
  }

  _redraw() {
    if (this._tex) this._tex.dispose();
    this._tex = boardTexture(this.label, this.colorHex, {
      num: this.lane + 1, state: this.state, star: this.star, letters: this.letters,
    });
    this.faceMat.map = this._tex;
    this.faceMat.emissiveMap = this._tex;
    // 选中 / 答对时更亮，进入 bloom
    this.faceMat.emissiveIntensity =
      this.state === 'correct' ? 0.78
        : this.state === 'wrong' ? 0.68
          : this.state === 'selected' ? 0.46
            : this.state === 'disabled' ? 0.09 : 0.22;
    this.faceMat.needsUpdate = true;
  }

  update(dt) {
    const want = this.state === 'selected' ? 0.34 : 0;
    this.glowMat.opacity += (want - this.glowMat.opacity) * Math.min(1, dt * 11);
    this._pulse += dt;
    if (this.state === 'selected') {
      const s = 1 + Math.sin(this._pulse * 6.2) * 0.013;
      this.glow.scale.set(s, s, 1);
    }
  }

  dispose() {
    if (this._tex) this._tex.dispose();
    this.faceMat.dispose();
    this.glowMat.dispose();
  }
}

/* ══════════════════════════════════════════════════════════
   门架：钢桁架结构
   ══════════════════════════════════════════════════════════ */
const gateMat = new THREE.MeshStandardMaterial({
  color: STEEL, roughness: 0.44, metalness: 0.82,
});
const gateAccentMat = new THREE.MeshStandardMaterial({
  color: 0x14202e, roughness: 0.5, metalness: 0.6,
});
const gateReflectMat = new THREE.MeshStandardMaterial({
  color: 0x8fd8f0, roughness: 0.16, metalness: 0.3,
  emissive: new THREE.Color(0x33a8d0), emissiveIntensity: 0.55,
});

export class Gate {
  constructor() {
    this.group = new THREE.Group();
    this.boards = [];
    this.z = 0;
    this.resolved = false;
    this.answered = false;

    const halfW = CONFIG.roadHalf + 1.0;

    // 立柱：方形钢柱 + 底座 + 反光带
    for (const s of [-1, 1]) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.26, 7.0, 0.26), gateMat);
      p.position.set(s * halfW, 3.5, 0);
      p.castShadow = true;
      p.receiveShadow = true;
      this.group.add(p);

      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.44, 0.26, 12), gateAccentMat);
      base.position.set(s * halfW, 0.15, 0);
      base.castShadow = true;
      this.group.add(base);

      for (let i = 0; i < 3; i++) {
        const band = new THREE.Mesh(new THREE.BoxGeometry(0.30, 0.10, 0.30), gateReflectMat);
        band.position.set(s * halfW, 1.10 + i * 2.0, 0);
        this.group.add(band);
      }
    }

    // 横梁（上下双梁 + 中间斜撑）
    const beam = new THREE.Mesh(new THREE.BoxGeometry(halfW * 2 + 0.5, 0.30, 0.30), gateMat);
    beam.position.set(0, 6.80, 0);
    beam.castShadow = true;
    this.group.add(beam);

    const beam2 = new THREE.Mesh(new THREE.BoxGeometry(halfW * 2 + 0.5, 0.14, 0.18), gateMat);
    beam2.position.set(0, 6.42, 0);
    this.group.add(beam2);

    for (const s of [-1, 1]) {
      const br = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.52, 0.14), gateMat);
      br.position.set(s * halfW * 0.52, 6.61, 0);
      br.rotation.z = s * 0.36;
      this.group.add(br);
    }

    // 题干牌
    this.stemMat = new THREE.MeshStandardMaterial({
      transparent: true, roughness: 0.26, metalness: 0.0,
      emissive: new THREE.Color(0xffffff), emissiveIntensity: 0.42,
    });
    this.stem = new THREE.Mesh(new THREE.PlaneGeometry(7.6, 7.6 * (210 / 1120)), this.stemMat);
    this.stem.position.set(0, 6.95, 0.05);
    this.group.add(this.stem);

    this.stemBack = roundBox(7.5, 1.42, 0.11, 0.07, gateAccentMat);
    this.stemBack.position.set(0, 6.95, -0.05);
    this.stemBack.castShadow = true;
    this.group.add(this.stemBack);

    // 选项牌 + 吊杆
    for (let i = 0; i < 4; i++) {
      const b = new OptionBoard(i);
      this.boards.push(b);
      this.group.add(b.group);

      for (const s of [-1, 1]) {
        const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 1.30, 8), gateMat);
        rod.position.set(CONFIG.laneX[i] + s * 1.16, 6.16, 0);
        this.group.add(rod);
      }
    }

    this._stemTex = null;
    this.group.visible = false;
  }

  configure(q, star) {
    if (this._stemTex) this._stemTex.dispose();
    this._stemTex = stemTexture(q.stem, star);
    this.stemMat.map = this._stemTex;
    this.stemMat.emissiveMap = this._stemTex;
    this.stemMat.needsUpdate = true;

    this.star = star;
    this.question = q;
    this.resolved = false;
    this.answered = false;

    const letters = q.type === 'spell';
    for (let i = 0; i < 4; i++) {
      this.boards[i].setContent(q.options[i], star && i === q.answer, letters);
      this.boards[i].setState('idle');
      this.boards[i].group.visible = true;
    }
  }

  setLaneSelected(lane) {
    for (let i = 0; i < 4; i++) {
      const b = this.boards[i];
      if (b.state === 'correct' || b.state === 'wrong' || b.state === 'disabled') continue;
      b.setState(i === lane ? 'selected' : 'idle');
    }
  }

  revealResult(chosenLane) {
    this.answered = true;
    for (let i = 0; i < 4; i++) {
      const b = this.boards[i];
      if (i === this.question.answer) b.setState('correct');
      else if (i === chosenLane) b.setState('wrong');
      else b.setState('idle');
    }
  }

  disableTwo() {
    const wrongs = [0, 1, 2, 3].filter(i => i !== this.question.answer);
    const shuffled = wrongs.sort(() => Math.random() - 0.5).slice(0, 2);
    for (const i of shuffled) this.boards[i].setState('disabled');
    return shuffled;
  }

  update(dt) {
    for (const b of this.boards) b.update(dt);
  }

  dispose() {
    if (this._stemTex) this._stemTex.dispose();
    this.stemMat.dispose();
    for (const b of this.boards) b.dispose();
  }
}

/* ── 远景预告门（半透明剪影） ── */
export function buildGhostGate() {
  const g = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({
    color: 0x9fb8d0, transparent: true, opacity: 0.18,
    depthWrite: false, fog: true,
  });
  const halfW = CONFIG.roadHalf + 1.0;
  for (const s of [-1, 1]) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(0.38, 7.0, 0.38), mat);
    p.position.set(s * halfW, 3.5, 0);
    g.add(p);
  }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(halfW * 2 + 0.5, 0.38, 0.38), mat);
  beam.position.set(0, 6.9, 0);
  g.add(beam);
  for (let i = 0; i < 4; i++) {
    const b = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 1.16), mat);
    b.position.set(CONFIG.laneX[i], 4.9, 0);
    g.add(b);
  }
  return g;
}
