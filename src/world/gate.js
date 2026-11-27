// 选项牌 + 门架
import * as THREE from 'three';
import { CONFIG } from '../core/config.js';
import {
  toon, mesh, outline, roundBox, makeCanvasTexture, rrPath, starPath,
  FONT_NUM, FONT_CN,
} from './materials.js';

const DARK = 0x1b2537;
const BOARD_W = 3.62;
const BOARD_H = BOARD_W * (232 / 640);

/* ── 选项牌牌面纹理 ── */
function boardTexture(label, colorHex, opts) {
  const { num, state = 'idle', star = false, letters = false } = opts;
  const cw = 640, ch = 232;
  const dark = state === 'correct' || state === 'wrong' || state === 'disabled';

  return makeCanvasTexture(cw, ch, (g) => {
    const hex = '#' + colorHex.toString(16).padStart(6, '0');
    const r = 34;

    g.fillStyle = 'rgba(8,16,28,0.42)';
    rrPath(g, 6, 16, cw - 12, ch - 22, r);
    g.fill();

    if (state === 'correct') {
      g.fillStyle = '#22c55e';
    } else if (state === 'wrong') {
      g.fillStyle = '#ef4444';
    } else if (state === 'disabled') {
      g.fillStyle = '#5b6779';
    } else {
      g.fillStyle = hex;
    }
    rrPath(g, 6, 6, cw - 12, ch - 28, r);
    g.fill();

    // 顶部高光
    g.save();
    rrPath(g, 6, 6, cw - 12, ch - 28, r);
    g.clip();
    g.fillStyle = 'rgba(255,255,255,0.20)';
    g.fillRect(6, 6, cw - 12, (ch - 28) * 0.44);
    g.restore();

    // 边框
    if (state === 'selected') {
      g.strokeStyle = '#ffffff';
      g.lineWidth = 14;
    } else if (star) {
      g.strokeStyle = '#ffd166';
      g.lineWidth = 10;
    } else {
      g.strokeStyle = 'rgba(16,26,42,0.34)';
      g.lineWidth = 8;
    }
    rrPath(g, 6, 6, cw - 12, ch - 28, r);
    g.stroke();

    // 序号圆
    const cx = 78, cy = 104;
    g.fillStyle = state === 'selected' ? '#14213d' : 'rgba(8,16,28,0.36)';
    g.beginPath(); g.arc(cx, cy, 40, 0, Math.PI * 2); g.fill();
    g.fillStyle = state === 'selected' ? hex : '#ffffff';
    g.font = `800 46px ${FONT_NUM}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(String(num), cx, cy + 2);

    // 选项文字：长文本自动缩字号；拼写题只有一个字母组，放大居中
    g.fillStyle = (state === 'idle' || state === 'selected') && colorHex === 0xffc233 ? '#14213d' : '#ffffff';
    let fs = letters ? 132 : 92;
    const maxW = cw - 150 - (star ? 130 : 34);
    do {
      g.font = `800 ${fs}px ${FONT_CN}`;
      if (g.measureText(label).width <= maxW) break;
      fs -= 4;
    } while (fs > 40);
    g.textAlign = 'left';
    if (letters) {
      // 缺字母选项：放大居中即可。牌面本来就小，加下划线会和字形糊在一起
      g.font = `800 ${fs}px ${FONT_NUM}`;
      g.fillText(label, 142, 122);
    } else {
      g.fillText(label, 142, 106);
    }

    // 星标
    if (star) {
      const sx = cw - 76, sy = 72, R = 40;
      g.fillStyle = '#ffd166';
      g.strokeStyle = '#7a4d00';
      g.lineWidth = 5;
      g.beginPath(); g.arc(sx, sy, R, 0, Math.PI * 2); g.fill(); g.stroke();
      g.fillStyle = '#7a4d00';
      starPath(g, sx, sy, 24, 10.5);
      g.fill();
    }

    // 状态图标
    if (state === 'correct') {
      g.strokeStyle = '#ffffff';
      g.lineWidth = 13;
      g.lineCap = 'round';
      g.lineJoin = 'round';
      g.beginPath();
      g.moveTo(34, 168); g.lineTo(54, 190); g.lineTo(92, 142);
      g.stroke();
    } else if (state === 'wrong') {
      g.strokeStyle = '#ffffff';
      g.lineWidth = 13;
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(36, 146); g.lineTo(88, 194);
      g.moveTo(88, 146); g.lineTo(36, 194);
      g.stroke();
    }
  });
}

/* ── 题干牌纹理 ── */
function stemTexture(stem, star) {
  const cw = 1120, ch = 210;
  return makeCanvasTexture(cw, ch, (g) => {
    g.fillStyle = 'rgba(8,16,28,0.45)';
    rrPath(g, 8, 18, cw - 16, ch - 24, 30);
    g.fill();
    g.fillStyle = '#16233a';
    rrPath(g, 8, 8, cw - 16, ch - 24, 30);
    g.fill();
    g.strokeStyle = star ? '#ffd166' : 'rgba(255,255,255,0.30)';
    g.lineWidth = star ? 11 : 7;
    rrPath(g, 8, 8, cw - 16, ch - 24, 30);
    g.stroke();

    // 喇叭
    const spkX = 92, spkY = 97;
    g.fillStyle = '#ffd166';
    g.beginPath(); g.arc(spkX, spkY, 40, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#16233a';
    g.beginPath();
    g.moveTo(spkX - 14, spkY - 9);
    g.lineTo(spkX - 4, spkY - 9);
    g.lineTo(spkX + 9, spkY - 22);
    g.lineTo(spkX + 9, spkY + 22);
    g.lineTo(spkX - 4, spkY + 9);
    g.lineTo(spkX - 14, spkY + 9);
    g.closePath(); g.fill();
    g.strokeStyle = '#16233a';
    g.lineWidth = 5;
    g.lineCap = 'round';
    g.beginPath(); g.arc(spkX + 8, spkY, 13, -0.9, 0.9); g.stroke();

    let text = stem.text;
    if (stem.audioOnly) text = '听读音 · 选含义';

    // 自适应字号（拼写题按「词形 + 空格槽」的总宽度算）
    let fs = stem.audioOnly ? 62 : 84;
    const avail = cw - 165 - (star ? 300 : 40);
    const holeWFor = (f) => stem.blank.len * f * 0.5;    // 每个缺字母约半个字宽，比下划线字符紧凑
    const measure = () => {
      g.font = `800 ${fs}px ${FONT_NUM}`;
      if (!stem.blank) return g.measureText(text).width;
      const { pre, post } = stem.blank;
      return g.measureText(pre).width + holeWFor(fs) + g.measureText(post).width;
    };
    while (measure() > avail && fs > 34) fs -= 4;

    g.fillStyle = '#ffffff';
    g.textAlign = 'left';
    g.textBaseline = 'alphabetic';

    let w;
    if (stem.blank) {
      // 拼写题：前段白字 + 金色空格槽 + 后段白字
      const { pre, len, post } = stem.blank;
      g.font = `800 ${fs}px ${FONT_NUM}`;
      const x0 = 158, baseY = 128;
      const preW = g.measureText(pre).width;
      const holeW = holeWFor(fs);
      const postW = g.measureText(post).width;

      // 空格槽：占满缺口宽度，贴在基线上，像填空题的空位
      const barX0 = x0 + preW + 2;
      const barX1 = x0 + preW + holeW - 2;
      const barH = Math.max(12, fs * 0.14);
      g.fillStyle = '#ffd166';
      rrPath(g, barX0, baseY + fs * 0.04, barX1 - barX0, barH, barH / 2);
      g.fill();

      g.fillStyle = '#ffffff';
      g.fillText(pre, x0, baseY);
      g.fillText(post, x0 + preW + holeW, baseY);

      w = preW + holeW + postW;
    } else {
      g.fillText(text, 158, 128);
      w = g.measureText(text).width;
    }

    let x = 158 + w + 26;

    // 拼写题把音标/词性挪到第二行（和释义一起），右侧只留星标，避免长词挤压重叠
    if (stem.sub) {
      const bits = [];
      if (stem.phonetic) bits.push(stem.phonetic);
      if (stem.pos) bits.push(stem.pos);
      bits.push(stem.sub);
      const line = bits.join('  ');
      let sfs = 40;
      const sAvail = cw - 165 - (star ? 300 : 40);
      do {
        g.font = `700 ${sfs}px ${FONT_CN}`;
        if (g.measureText(line).width <= sAvail) break;
        sfs -= 3;
      } while (sfs > 24);
      g.fillStyle = '#ffd166';
      g.fillText(line, 158, 178);
      x = cw;   // 右侧不再放东西
    }

    if (stem.phonetic && !stem.audioOnly && !stem.sub) {
      g.fillStyle = '#9fb0c4';
      g.font = '600 44px "Helvetica Neue", Arial';
      g.fillText(stem.phonetic, x, 126);
      x += g.measureText(stem.phonetic).width + 22;
    }
    if (stem.pos && !stem.sub) {
      g.fillStyle = '#5ee6ff';
      g.font = `800 34px ${FONT_CN}`;
      const pw = Math.max(84, g.measureText(stem.pos).width + 40);
      rrPath(g, x, 76, pw, 56, 14);
      g.fill();
      g.fillStyle = '#16233a';
      g.fillText(stem.pos, x + 20, 117);
      x += pw + 16;
    }

    // 拼写题的释义提示已合并到上面第二行
    void x;

    if (star) {
      const bw = 268, bh = 62, bx = cw - bw - 20, by = 20;
      g.fillStyle = '#ffd166';
      g.strokeStyle = '#7a4d00';
      g.lineWidth = 5;
      rrPath(g, bx, by, bw, bh, 30);
      g.fill(); g.stroke();
      const sx = bx + 40, sy = by + bh / 2;
      g.fillStyle = '#7a4d00';
      starPath(g, sx, sy, 21, 9);
      g.fill();
      g.font = `800 38px ${FONT_CN}`;
      g.textAlign = 'left';
      g.textBaseline = 'middle';
      g.fillText('答对得道具', bx + 68, sy + 2);
    }
  });
}

/* ── 单块选项牌 ── */
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

    // 背板
    this.back = roundBox(BOARD_W * 0.98, BOARD_H * 0.94, 0.16, 0.09, toon(DARK));
    this.back.position.z = -0.07;
    this.group.add(this.back);

    // 牌面
    this.faceMat = new THREE.MeshBasicMaterial({ transparent: true });
    this.face = new THREE.Mesh(new THREE.PlaneGeometry(BOARD_W, BOARD_H), this.faceMat);
    this.face.position.z = 0.03;
    this.group.add(this.face);

    // 选中光环
    this.glowMat = new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0, depthWrite: false,
    });
    this.glow = new THREE.Mesh(
      new THREE.PlaneGeometry(BOARD_W * 1.12, BOARD_H * 1.22),
      this.glowMat
    );
    this.glow.position.z = 0.015;
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
    this.faceMat.needsUpdate = true;
  }

  update(dt) {
    const wantGlow = this.state === 'selected' ? 1 : 0;
    this.glowMat.opacity += (wantGlow * 0.4 - this.glowMat.opacity) * Math.min(1, dt * 10);
    this._pulse += dt;
    if (this.state === 'selected') {
      const s = 1 + Math.sin(this._pulse * 6) * 0.012;
      this.glow.scale.set(s, s, 1);
    }
  }

  dispose() {
    if (this._tex) this._tex.dispose();
    this.faceMat.dispose();
    this.glowMat.dispose();
  }
}

/* ── 门架 ── */
export class Gate {
  constructor() {
    this.group = new THREE.Group();
    this.boards = [];
    this.z = 0;
    this.resolved = false;
    this.answered = false;

    const postMat = toon(DARK);
    const halfW = CONFIG.roadHalf + 0.9;

    // 立柱
    for (const s of [-1, 1]) {
      const p = mesh(new THREE.BoxGeometry(0.48, 7.2, 0.48), postMat, { outlineScale: 1.07 });
      p.position.set(s * halfW, 3.6, 0);
      this.group.add(p);

      const base = mesh(new THREE.CylinderGeometry(0.52, 0.66, 0.34, 10), toon(0x2b3a55), {});
      base.position.set(s * halfW, 0.17, 0);
      this.group.add(base);

      // 立柱反光条
      for (let i = 0; i < 3; i++) {
        const band = mesh(new THREE.BoxGeometry(0.52, 0.16, 0.52), toon(0x5ee6ff), {});
        band.position.set(s * halfW, 1.1 + i * 2.0, 0);
        this.group.add(band);
      }
    }

    // 横梁
    const beam = mesh(new THREE.BoxGeometry(halfW * 2 + 0.4, 0.5, 0.5), postMat, { outlineScale: 1.05 });
    beam.position.set(0, 7.0, 0);
    this.group.add(beam);

    // 题干牌
    this.stemMat = new THREE.MeshBasicMaterial({ transparent: true });
    this.stem = new THREE.Mesh(new THREE.PlaneGeometry(8.4, 8.4 * (210 / 1120)), this.stemMat);
    this.stem.position.set(0, 8.05, 0.04);
    this.group.add(this.stem);
    this.stemBack = roundBox(8.3, 1.52, 0.14, 0.1, toon(DARK));
    this.stemBack.position.set(0, 8.05, -0.06);
    this.group.add(this.stemBack);

    // 选项牌
    for (let i = 0; i < 4; i++) {
      const b = new OptionBoard(i);
      this.boards.push(b);
      this.group.add(b.group);

      // 吊杆
      for (const s of [-1, 1]) {
        const rod = mesh(new THREE.BoxGeometry(0.08, 1.35, 0.08), toon(0x2b3a55), {});
        rod.position.set(CONFIG.laneX[i] + s * 1.12, 6.3, 0);
        this.group.add(rod);
      }
    }

    this._stemTex = null;
    this.group.visible = false;
  }

  configure(q, star) {
    // 题干
    if (this._stemTex) this._stemTex.dispose();
    this._stemTex = stemTexture(q.stem, star);
    this.stemMat.map = this._stemTex;
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
    // 「二选一」道具：封掉两条错误车道
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

/* ── 远景剪影门（预告） ── */
export function buildGhostGate() {
  const g = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({
    color: 0x9fb8d0, transparent: true, opacity: 0.22,
    depthWrite: false, fog: false,
  });
  const halfW = CONFIG.roadHalf + 0.9;
  for (const s of [-1, 1]) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(0.4, 6.8, 0.4), mat);
    p.position.set(s * halfW, 3.4, 0);
    g.add(p);
  }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(halfW * 2 + 0.4, 0.42, 0.42), mat);
  beam.position.set(0, 6.6, 0);
  g.add(beam);
  // 四块模糊的牌
  for (let i = 0; i < 4; i++) {
    const b = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 1.16), mat);
    b.position.set(CONFIG.laneX[i], 4.9, 0);
    g.add(b);
  }
  return g;
}
