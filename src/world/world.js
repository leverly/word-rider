// 3D 世界聚合：场景、相机、道路、自行车、门架池
import * as THREE from 'three';
import { CONFIG } from '../core/config.js';
import { createRenderer, createComposer, createSky, createLights } from './scene.js';
import { buildRoad } from './road.js';
import { buildVehicle } from './vehicle.js';
import { THEMES } from './themes.js';
import { Gate, buildGhostGate } from './gate.js';
import { clamp, damp, easeInOutCubic } from '../core/utils.js';

export class World {
  constructor(canvas, width, height, quality = 'high', opts = {}) {
    this.width = width;
    this.height = height;

    this.themeId = opts.theme || 'coast';
    this.vehicleKind = opts.vehicle || 'bike';
    this.paletteId = opts.palette || null;
    this.theme = THEMES[this.themeId] || THEMES.coast;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(
      this.theme.fog.color, this.theme.fog.near, this.theme.fog.far
    );

    this.camera = new THREE.PerspectiveCamera(52, width / height, 0.08, 700);
    this.camera.position.set(CONFIG.laneX[1], 1.60, CONFIG.bikeZ - 0.55);
    this.camera.lookAt(CONFIG.laneX[1], 1.0, -26);

    this.renderer = createRenderer(canvas, width, height, quality);
    const { composer, gradePass } = createComposer(
      this.renderer, this.scene, this.camera, width, height, quality
    );
    this.composer = composer;
    this.gradePass = gradePass;
    this.quality = quality;

    this.sky = createSky(this.scene, this.theme);
    this.lights = createLights(this.scene, this.theme);
    this.road = buildRoad(this.scene, this.theme);

    // 座驾 + 骑手
    this.bike = buildVehicle(this.vehicleKind, this.paletteId);
    this.bike.group.position.set(CONFIG.laneX[1], 0, CONFIG.bikeZ);
    this.bike.setFirstPerson?.(true);   // 骑行中始终第一人称
    this.scene.add(this.bike.group);

    // 车灯 / 地面投影
    this.bikeShadow = this._makeBikeShadow();
    this.scene.add(this.bikeShadow);

    // 门架池
    this.gatePool = [];
    this.ghostGate = buildGhostGate();
    this.ghostGate.visible = false;   // 未开局时不要出现在相机前
    this.scene.add(this.ghostGate);

    // 粒子系统（答对的金色粒子）
    this.particles = this._makeParticles();
    this.scene.add(this.particles.points);

    // 相机状态
    this.camShake = 0;
    this.camLane = 1;
    this.fovBase = 52;
    this.camRoll = 0;
  }

  _makeBikeShadow() {
    const geo = new THREE.PlaneGeometry(1.7, 3.0);
    const tex = (() => {
      const cv = document.createElement('canvas');
      cv.width = cv.height = 128;
      const g = cv.getContext('2d');
      const grad = g.createRadialGradient(64, 64, 4, 64, 64, 62);
      grad.addColorStop(0, 'rgba(8,14,26,0.55)');
      grad.addColorStop(0.6, 'rgba(8,14,26,0.26)');
      grad.addColorStop(1, 'rgba(8,14,26,0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, 128, 128);
      const t = new THREE.CanvasTexture(cv);
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    })();
    const m = new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false })
    );
    m.rotation.x = -Math.PI / 2;
    m.position.set(CONFIG.laneX[1], 0.03, CONFIG.bikeZ);
    return m;
  }

  _makeParticles() {
    const COUNT = 220;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(COUNT * 3);
    const col = new Float32Array(COUNT * 3);
    const life = new Float32Array(COUNT);
    const vel = new Float32Array(COUNT * 3);
    for (let i = 0; i < COUNT; i++) {
      pos[i * 3 + 1] = -999;
      life[i] = 0;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));

    const mat = new THREE.PointsMaterial({
      size: 0.24,
      vertexColors: true,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    });

    const points = new THREE.Points(geo, mat);
    points.frustumCulled = false;

    return {
      points, geo, mat, pos, col, life, vel, count: COUNT, cursor: 0,
      burst(x, y, z, color = [1, 0.82, 0.36], n = 34) {
        for (let k = 0; k < n; k++) {
          const i = this.cursor % this.count;
          this.cursor++;
          const a = Math.random() * Math.PI * 2;
          const sp = 2 + Math.random() * 5;
          this.pos[i * 3] = x + (Math.random() - 0.5) * 0.5;
          this.pos[i * 3 + 1] = y + (Math.random() - 0.5) * 0.5;
          this.pos[i * 3 + 2] = z + (Math.random() - 0.5) * 0.5;
          this.vel[i * 3] = Math.cos(a) * sp * 0.5;
          this.vel[i * 3 + 1] = 2.5 + Math.random() * 4.5;
          this.vel[i * 3 + 2] = Math.sin(a) * sp * 0.5 - 2;
          this.col[i * 3] = color[0];
          this.col[i * 3 + 1] = color[1];
          this.col[i * 3 + 2] = color[2];
          this.life[i] = 0.8 + Math.random() * 0.6;
        }
        this.geo.attributes.position.needsUpdate = true;
        this.geo.attributes.color.needsUpdate = true;
        this.points.visible = true;
      },
      update(dt) {
        let any = false;
        for (let i = 0; i < this.count; i++) {
          if (this.life[i] <= 0) continue;
          any = true;
          this.life[i] -= dt;
          if (this.life[i] <= 0) {
            this.pos[i * 3 + 1] = -999;
            continue;
          }
          this.vel[i * 3 + 1] -= 12 * dt;
          this.pos[i * 3] += this.vel[i * 3] * dt;
          this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
          this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
        }
        this.geo.attributes.position.needsUpdate = true;
        this.points.visible = any;
      },
    };
  }

  createGate() {
    let g = this.gatePool.pop();
    if (!g) g = new Gate();
    g.group.visible = true;
    return g;
  }

  recycleGate(g) {
    if (!g) return;
    if (g.group.parent) g.group.parent.remove(g.group);
    g.group.visible = false;
    this.gatePool.push(g);
    if (this.gatePool.length > 8) {
      const old = this.gatePool.pop();
      old.dispose();
    }
  }

  resetGatePool() {
    for (const g of this.gatePool) {
      if (g.group.parent) g.group.parent.remove(g.group);
    }
  }

  /** 每帧更新视觉 */
  update(dt, game, time) {
    const hud = game.hud;

    // 自行车：横向平滑移动到目标车道
    const targetBikeX = CONFIG.laneX[game.lane];
    const bx = damp(this.bike.group.position.x, targetBikeX, 12, dt);
    this.bike.group.position.x = bx;
    // 轮子半径 0.5 + 胎厚，模型原点在轮轴高度附近，抬到地面
    this.bike.group.position.y = 0;
    this.bike.update(dt, hud.speedRatio, game.lean, time);

    this.bikeShadow.position.x = bx;
    this.bikeShadow.material.opacity = 1;

    // 道路滚动
    // 把车实际 x 反算成连续的 lane 索引，高亮与车永远对齐
    const carLane = this._xToLaneFloat(bx);
    this.road.update(dt, game.speed, carLane, time);

    // ── 第一人称相机：位于鹈鹕眼位 ──
    if (this.__freeze) return;   // 调试用：冻结相机

    // 镜头挂在车身上：随车横向移动、带一点延迟形成惯性感
    const eyeX = bx + 0.02;
    this.camera.position.x = damp(this.camera.position.x, eyeX, 14, dt);

    // 眼高：自行车坐姿约 1.62m，滑板车站姿约 1.72m
    const eyeY = this.vehicleKind === 'scooter' ? 1.74 : 1.60;
    const shakeAmt = game.fx.shake * 0.16;
    // 踩踏起伏 + 撞击抖动
    const bob = Math.sin(time * 6.2) * 0.012 * (0.3 + hud.speedRatio);
    this.camera.position.y = damp(
      this.camera.position.y,
      eyeY + bob + (Math.random() - 0.5) * shakeAmt,
      12, dt
    );

    // 镜头略微前移到把手之后，避免看到自己的后脑
    // 镜头放在车把前方，避免把套/车筐在近处被放成巨大剪影
    this.camera.position.z = damp(this.camera.position.z, CONFIG.bikeZ - 0.55, 14, dt);

    // 高速提升 FOV 制造速度感
    const fovTarget = this.fovBase + 8 + hud.speedRatio * 10 + (game.active.boost > 0 ? 5 : 0);
    this.camera.fov = damp(this.camera.fov, fovTarget, 3, dt);
    this.camera.updateProjectionMatrix();

    // 视线：看向前方路面，换道时视线略微跟随（倾斜感）
    const lookX = bx * 0.55 + (game.lane - bx / 3.6) * 0.15;
    this.camera.lookAt(lookX, eyeY - 0.48, -26);

    // 转向时的镜头侧倾（第一人称的沉浸感关键）
    const targetRoll = -game.lean * 0.55;
    this.camRoll = damp(this.camRoll || 0, targetRoll, 7, dt);
    this.camera.rotation.z = this.camRoll;

    // 太阳跟随相机（阴影范围）
    this.lights.sun.position.set(
      this.camera.position.x - 26, 38, this.camera.position.z + 18
    );
    this.lights.sun.target.position.set(0, 0, -20);
    this.lights.sun.target.updateMatrixWorld();

    // 粒子
    this.particles.update(dt);

    // 后处理 uniform
    const g = this.gradePass.uniforms;
    g.uTime.value = time;
    g.uFlash.value = game.fx.flash;
    g.uFlashColor.value.setRGB(...game.fx.flashColor);
    g.uSpeedLines.value = game.fx.speedLines;
  }

  burstAtBike(color, n = 34) {
    const x = this.bike?.group?.position?.x ?? CONFIG.laneX[1];
    this.particles.burst(x, 1.5, CONFIG.bikeZ - 1.0, color, n);
  }

  /** 轮次切换时把相机与座驾视觉归位 */
  resetView() {
    const eyeY = this.vehicleKind === 'scooter' ? 1.74 : 1.60;
    this.camera.position.set(CONFIG.laneX[1], eyeY, CONFIG.bikeZ - 0.55);
    this.camera.lookAt(CONFIG.laneX[1], eyeY - 0.48, -26);
    this.camera.rotation.z = 0;
    this.camRoll = 0;
    if (this.bike) {
      this.bike.group.position.set(CONFIG.laneX[1], 0, CONFIG.bikeZ);
      this.bike.group.rotation.set(0, 0, 0);
    }
  }

  /** x 坐标 → 连续车道索引（0..3） */
  _xToLaneFloat(x) {
    const lx = CONFIG.laneX;
    if (x <= lx[0]) return 0;
    if (x >= lx[3]) return 3;
    for (let i = 0; i < 3; i++) {
      if (x >= lx[i] && x <= lx[i + 1]) {
        return i + (x - lx[i]) / (lx[i + 1] - lx[i]);
      }
    }
    return 1;
  }

  /** 运行时切换场景主题 */
  setTheme(themeId) {
    const next = THEMES[themeId];
    if (!next || themeId === this.themeId) return;
    this.themeId = themeId;
    this.theme = next;

    // 重建道路与环境
    if (this.road) {
      this.scene.remove(this.road.root);
      this.road.dispose?.();
    }
    this.road = buildRoad(this.scene, next);
    this.scene.fog.color.set(next.fog.color);
    this.scene.fog.near = next.fog.near;
    this.scene.fog.far = next.fog.far;
    this.sky.applyTheme?.(next);
    this.lights.applyTheme?.(next);
  }

  /** 运行时切换座驾与配色 */
  setVehicle(kind, paletteId = null) {
    if (kind === this.vehicleKind && paletteId === this.paletteId) return;
    if (this.bike) {
      this.scene.remove(this.bike.group);
      this.bike.dispose?.();
    }
    this.vehicleKind = kind;
    this.paletteId = paletteId;
    this.bike = buildVehicle(kind, paletteId);
    // 重置到中间车道（换座驾后位置必须归一，否则跟随逻辑会漂移）
    this.bike.group.position.set(CONFIG.laneX[1], 0, CONFIG.bikeZ);
    this.bike.setFirstPerson?.(true);
    this.scene.add(this.bike.group);
  }

  resize(w, h) {
    this.width = w;
    this.height = h;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  render() {
    this.composer.render();
  }
}
