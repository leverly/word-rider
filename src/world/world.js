// 世界装配：渲染器 / 环境 / 道路 / 景物 / 载具 / 门架 / 天气 / 相机
//
// 这一层是唯一知道「谁在场景里」的地方。游戏逻辑只读 world 的公开字段。
import * as THREE from 'three';
import { CONFIG } from '../core/config.js';
import {
  createRenderer, createComposer, createLights, loadHDR,
} from './renderer.js';
import { buildEnvironment } from './road-pbr.js';
import { buildScenery } from './scenery.js';
import { buildVehicle } from './vehicle-pbr.js';
import { Gate, buildGhostGate } from './gate.js';
import { WEATHERS, DEFAULT_WEATHER } from './weather-themes.js';
import { createRain, createSnow, createStars, createHeadlight } from './atmosphere.js';
import { clamp, damp } from '../core/utils.js';

export class World {
  constructor(canvas, width, height, quality = 'high', opts = {}) {
    this.width = width;
    this.height = height;
    this.quality = quality;

    this.themeId = opts.weather || DEFAULT_WEATHER;
    this.vehicleKind = opts.vehicle || 'bike';
    this.paletteId = opts.palette || null;
    this.theme = WEATHERS[this.themeId] || WEATHERS[DEFAULT_WEATHER];

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(
      this.theme.fog.color, this.theme.fog.near, this.theme.fog.far,
    );

    this.camera = new THREE.PerspectiveCamera(50, width / height, 0.12, 1600);
    this.camera.position.set(CONFIG.laneX[1], CONFIG.camFollowY, CONFIG.camFollowZ);
    this.camera.lookAt(CONFIG.laneX[1], 1.6, -26);

    this.renderer = createRenderer(canvas, width, height, quality);
    const { composer, gradePass, bloomPass, gtaoPass } = createComposer(
      this.renderer, this.scene, this.camera, width, height, quality,
    );
    this.composer = composer;
    this.gradePass = gradePass;
    this.bloomPass = bloomPass;
    this.gtaoPass = gtaoPass;

    this.lights = createLights(this.scene, this.theme);
    // sunDir 是「太阳相对场景的方向」；阴影从太阳射向 -dir。
    // 取水平分量拉开角度，让阴影有明显方向（不是缩在正下方）
    const sd = new THREE.Vector3(...this.theme.sunDir).normalize();
    this.lights.sun.userData.dir = sd;

    this.ready = false;
    this.bike = null;
    this.env = null;
    this.scenery = null;

    this.gatePool = [];
    this.ghostGate = buildGhostGate();
    this.ghostGate.visible = false;
    this.scene.add(this.ghostGate);

    this.particles = this._makeParticles();
    this.scene.add(this.particles.points);
    this.streaks = this._makeSpeedStreaks();
    this.scene.add(this.streaks.object);

    this.rain = createRain();
    this.snow = createSnow();
    this.stars = createStars();
    this.headlight = createHeadlight();
    this.scene.add(this.rain.object, this.snow.object, this.stars, this.headlight.object);

    this.camShake = 0;
    this.camLane = 1;
    this.camRoll = 0;
    this.steer = 0;
    this._nitroV = 0;
    this.hdrCache = {};

    this.loading = this._asyncInit();
  }

  async _asyncInit() {
    // 1. HDRI：背景 + IBL
    const hdr = await loadHDR(this.renderer, `assets/hdri/${this.theme.hdr}.hdr`);
    this.hdrCache[this.theme.hdr] = hdr;
    this.scene.environment = hdr;
    this.scene.environmentIntensity = this.theme.skyIntensity;
    this.scene.background = hdr;
    this.scene.backgroundIntensity = this.theme.bgIntensity;
    this.scene.backgroundRotation = new THREE.Euler(0, this.theme.skyRot, 0);

    // 2. 道路与地形
    this.env = await buildEnvironment(this.scene, this.theme, this.quality);

    // 3. 景物
    this.scenery = await buildScenery(this.scene, this.theme);

    // 4. 载具 + 骑手
    this.bike = await buildVehicle(this.vehicleKind, this.paletteId);
    this.bike.group.position.set(CONFIG.laneX[1], 0, CONFIG.bikeZ);
    this.scene.add(this.bike.group);

    // 5. 车灯 + 氮气
    this.headlight.attach(this.bike.group);
    this.nitro = this._makeNitro();
    this.bike.group.add(this.nitro.object);

    // 6. 天气
    await this._applyWeather(this.theme);
    this._syncShadow();
    this.ready = true;
    return this;
  }

  /* ══════════════════════════════════════════════════════
     粒子
     ══════════════════════════════════════════════════════ */
  _makeParticles() {
    const COUNT = 260;
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

    const cv = document.createElement('canvas');
    cv.width = cv.height = 64;
    const g = cv.getContext('2d');
    const rg = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    rg.addColorStop(0, 'rgba(255,255,255,1)');
    rg.addColorStop(0.45, 'rgba(255,240,190,0.85)');
    rg.addColorStop(1, 'rgba(255,220,140,0)');
    g.fillStyle = rg;
    g.fillRect(0, 0, 64, 64);
    const spriteTex = new THREE.CanvasTexture(cv);
    spriteTex.colorSpace = THREE.SRGBColorSpace;

    const mat = new THREE.PointsMaterial({
      size: 0.34,
      map: spriteTex,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    });

    const points = new THREE.Points(geo, mat);
    points.frustumCulled = false;

    return {
      points, geo, mat, pos, col, life, vel, count: COUNT, cursor: 0,
      burst(x, y, z, color = [1, 0.82, 0.36], n = 40) {
        for (let k = 0; k < n; k++) {
          const i = this.cursor % this.count;
          this.cursor++;
          const a = Math.random() * Math.PI * 2;
          const sp = 2.5 + Math.random() * 6;
          this.pos[i * 3] = x + (Math.random() - 0.5) * 0.55;
          this.pos[i * 3 + 1] = y + (Math.random() - 0.5) * 0.55;
          this.pos[i * 3 + 2] = z + (Math.random() - 0.5) * 0.55;
          this.vel[i * 3] = Math.cos(a) * sp * 0.55;
          this.vel[i * 3 + 1] = 3.0 + Math.random() * 5.0;
          this.vel[i * 3 + 2] = Math.sin(a) * sp * 0.55 - 2;
          this.col[i * 3] = color[0];
          this.col[i * 3 + 1] = color[1];
          this.col[i * 3 + 2] = color[2];
          this.life[i] = 0.9 + Math.random() * 0.7;
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
          this.vel[i * 3 + 1] -= 13 * dt;
          this.pos[i * 3] += this.vel[i * 3] * dt;
          this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
          this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
        }
        this.geo.attributes.position.needsUpdate = true;
        this.points.visible = any;
      },
    };
  }

  /* ── 3D 速度线 ─────────────────────────────────────── */
  _makeSpeedStreaks() {
    const COUNT = 110;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(COUNT * 6);
    const seed = new Float32Array(COUNT * 2);
    const XR = 17, ZFAR = -220, ZNEAR = 10;

    for (let i = 0; i < COUNT; i++) {
      seed[i * 2] = (Math.random() - 0.5) * XR * 2;
      seed[i * 2 + 1] = ZFAR + Math.random() * (ZNEAR - ZFAR);
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));

    const mat = new THREE.LineBasicMaterial({
      color: 0xdff2ff, transparent: true, opacity: 0,
      depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    });
    const lines = new THREE.LineSegments(geo, mat);
    lines.frustumCulled = false;

    return {
      object: lines,
      setIntensity(v) { mat.opacity = v; },
      update(dt, speed) {
        if (mat.opacity <= 0.01) return;
        const len = 1.6 + speed * 0.20;
        for (let i = 0; i < COUNT; i++) {
          let z = seed[i * 2 + 1] + speed * dt * 1.2;
          if (z > ZNEAR) z = ZFAR - Math.random() * 34;
          seed[i * 2 + 1] = z;
          const x = seed[i * 2];
          const y = 0.5 + Math.abs(x) * 0.05;
          const b = i * 6;
          pos[b] = x; pos[b + 1] = y; pos[b + 2] = z;
          pos[b + 3] = x; pos[b + 4] = y; pos[b + 5] = z + len;
        }
        geo.attributes.position.needsUpdate = true;
      },
    };
  }

  /* ── 氮气尾焰 ──────────────────────────────────────── */
  _makeNitro() {
    const g = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({
      color: 0x7fd8ff, transparent: true, opacity: 0,
      depthWrite: false, blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide, fog: false,
    });
    const coreMat = mat.clone();
    coreMat.color.set(0xffffff);

    const cones = [];
    for (const s of [-1, 1]) {
      const cone = new THREE.Mesh(new THREE.ConeGeometry(0.06, 1.05, 12, 1, true), mat);
      cone.rotation.x = -Math.PI / 2;
      cone.position.set(s * 0.10, 0.30, 1.10);
      g.add(cone);
      const core = new THREE.Mesh(new THREE.ConeGeometry(0.026, 0.60, 10, 1, true), coreMat);
      core.rotation.x = -Math.PI / 2;
      core.position.set(s * 0.10, 0.30, 0.95);
      g.add(core);
      cones.push(cone, core);
    }
    const light = new THREE.PointLight(0x8fdcff, 0, 6, 2.4);
    light.position.set(0, 0.20, 1.6);
    g.add(light);
    g.visible = false;

    return {
      object: g,
      setIntensity(v) {
        g.visible = v > 0.01;
        mat.opacity = v * 0.42;
        coreMat.opacity = v * 0.62;
        light.intensity = v * 0.65;
      },
      update(time, v) {
        if (!g.visible) return;
        const flick = 0.85 + Math.sin(time * 48) * 0.15;
        for (const c of cones) c.scale.set(1, flick, 1);
      },
    };
  }

  /* ── 门架池 ────────────────────────────────────────── */
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
    if (this.gatePool.length > 6) {
      const old = this.gatePool.pop();
      old.dispose();
    }
  }

  resetGatePool() {
    for (const g of this.gatePool) {
      if (g.group.parent) g.group.parent.remove(g.group);
    }
  }

  /* ══════════════════════════════════════════════════════
     每帧
     ══════════════════════════════════════════════════════ */
  update(dt, game, time) {
    const hud = game.hud;

    let bx = 0;
    if (this.bike) {
      const targetBikeX = CONFIG.laneX[game.lane];
      const prevBx = this.bike.group.position.x;
      bx = damp(prevBx, targetBikeX, 13, dt);
      this.bike.group.position.x = bx;

      const lateralVel = dt > 1e-5 ? (bx - prevBx) / dt : 0;
      const steer = clamp(lateralVel * 0.15, -1, 1);
      this.steer = damp(this.steer, steer, 10, dt);

      this.bike.update(dt, hud.speedRatio, this.steer * 0.15, time, game.speed);
    }

    const carLane = this._xToLaneFloat(bx);
    this.env?.update(dt, game.speed, carLane, time);
    this.scenery?.update(dt, game.speed, time);

    if (this.__freeze) return;
    const C = CONFIG.cam;

    this.camera.position.x = damp(this.camera.position.x, bx * C.followX, C.lagLambda, dt);

    if (game.lane !== this.camLane) {
      const dir = Math.sign(game.lane - this.camLane) || 1;
      this.camKick = (this.camKick || 0) + dir * 0.52;
      this.camLane = game.lane;
      this.fovKickT = 1;
    }
    this.camKick = damp(this.camKick || 0, 0, 6, dt);

    const bob = Math.sin(time * C.bobFreq) * C.bobAmp * hud.speedRatio;
    const shakeAmt = game.fx.shake * 0.24;

    this.camera.position.x += Math.sin(time * 41) * shakeAmt * 0.5;
    this.camera.position.y = damp(
      this.camera.position.y, CONFIG.camFollowY + bob, 6, dt,
    ) + Math.sin(time * 37 + 1.7) * shakeAmt * 0.6;
    this.camera.position.z = damp(
      this.camera.position.z, CONFIG.camFollowZ + hud.speedRatio * 0.9, 5, dt,
    );

    this.fovKickT = Math.max(0, (this.fovKickT || 0) - dt * 3.4);
    const fovTarget = C.fovBase
      + hud.speedRatio * C.fovSpeed
      + (game.active.boost > 0 ? C.fovBoost : 0)
      + Math.sin(this.fovKickT * Math.PI) * C.fovKick;
    this.camera.fov = damp(this.camera.fov, fovTarget, 4.5, dt);
    this.camera.updateProjectionMatrix();

    const lookX = bx * 0.34 + this.camKick * 1.1;
    this.camera.lookAt(lookX, 1.30 + hud.speedRatio * 0.28, -C.lookAhead);

    const targetRoll = -this.steer * C.rollAmount - this.camKick * 0.05;
    this.camRoll = damp(this.camRoll, targetRoll, 8, dt);
    this.camera.rotation.z = this.camRoll;

    const accel = (hud.speed - (this.lastSpeed ?? hud.speed)) / Math.max(dt, 1e-4);
    this.lastSpeed = hud.speed;
    this.pitchVel = damp(this.pitchVel || 0,
      clamp(accel * C.pitchAmount * 0.05, -0.05, 0.05), 8, dt);
    this.camera.rotateX(this.pitchVel);

    this._syncShadow();

    this.particles.update(dt);
    const sInt = Math.max(0, (hud.speedRatio - 0.38) / 0.62) * 0.42;
    this.streaks.setIntensity(sInt);
    this.streaks.update(dt, game.speed);

    const boostV = game.active.boost > 0 ? 1 : 0;
    this._nitroV = damp(this._nitroV, boostV, 6, dt);
    this.nitro?.setIntensity(this._nitroV);
    this.nitro?.update(time, this._nitroV);

    this.rain.update(dt, game.speed, time, this.camera);
    this.snow.update(dt, game.speed, time, this.camera);
    this.headlight.object.position.set(0, 0.62, -0.5);

    const u = this.gradePass.uniforms;
    u.uTime.value = time;
    u.uFlash.value = game.fx.flash;
    u.uFlashColor.value.setRGB(...game.fx.flashColor);
    u.uSpeedLines.value = game.fx.speedLines;
    u.uBoost.value = this._nitroV;
    u.uShake.value = game.fx.shake;

    if (this.bloomPass) {
      const target = this.theme.id === 'night' ? 0.62
        : this.theme.id === 'rain' ? 0.34
          : this.theme.snow > 0 ? 0.28 : 0.26;
      this.bloomPass.strength = damp(this.bloomPass.strength, target, 1.4, dt);
    }
  }

  _syncShadow() {
    // 阴影相机跟住骑手：范围小才能有高分辨率阴影，
    // 但要覆盖骑手 + 前方 20m 的路面与树。
    const focusZ = CONFIG.bikeZ - 10;
    const dir = this.lights.sun.userData.dir;
    this.lights.sun.position.set(dir.x * 34, dir.y * 34, focusZ + dir.z * 34);
    this.lights.sun.target.position.set(0, 0, focusZ);
    this.lights.sun.target.updateMatrixWorld();
  }

  pelicanMood(kind, intensity = 1) {
    this.bike?.setMood?.(kind, intensity);
  }

  burstAtBike(color, n = 40) {
    const x = this.bike?.group?.position?.x ?? CONFIG.laneX[1];
    this.particles.burst(x, 1.5, CONFIG.bikeZ - 1.0, color, n);
  }

  resetView() {
    this.camera.position.set(CONFIG.laneX[1], CONFIG.camFollowY, CONFIG.camFollowZ);
    this.camera.lookAt(CONFIG.laneX[1], 1.6, -26);
    this.camera.rotation.z = 0;
    this.camRoll = 0;
    if (this.bike) {
      this.bike.group.position.set(CONFIG.laneX[1], 0, CONFIG.bikeZ);
      this.bike.group.rotation.set(0, 0, 0);
    }
  }

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

  /* ══════════════════════════════════════════════════════
     天气
     ══════════════════════════════════════════════════════ */
  async _applyWeather(w) {
    this.theme = w;

    let hdr = this.hdrCache[w.hdr];
    if (!hdr) {
      try {
        hdr = await loadHDR(this.renderer, `assets/hdri/${w.hdr}.hdr`);
        this.hdrCache[w.hdr] = hdr;
      } catch (e) {
        console.warn('HDRI 载入失败，沿用当前环境', e);
        hdr = this.scene.environment;
      }
    }
    if (hdr) this.scene.environment = hdr;
    this.scene.environmentIntensity = w.skyIntensity;
    this.scene.backgroundRotation = new THREE.Euler(0, w.skyRot, 0);

    // 背景策略：
    //  白天 / 雨 / 雪 → 直接用 HDRI 当天空（云层是真实照片）
    //  夜晚 → 纯深色背景（HDRI 的暗部经 ACES 仍会抬成灰白，且星星用独立粒子更可控）
    if (w.id === 'night') {
      this.scene.background = new THREE.Color(0x05080f);
      this.scene.backgroundIntensity = 1;
    } else {
      this.scene.background = hdr || this.scene.background;
      this.scene.backgroundIntensity = w.bgIntensity;
    }

    this.lights.applyTheme(w);
    this.lights.sun.userData.dir.set(...w.sunDir).normalize();

    this.scene.fog.color.set(w.fog.color);
    this.scene.fog.near = w.fog.near;
    this.scene.fog.far = w.fog.far;

    this.renderer.toneMappingExposure = w.exposure;
    const u = this.gradePass.uniforms;
    u.uSaturation.value = w.grade.saturation;
    u.uContrast.value = w.grade.contrast;
    u.uVignette.value = w.grade.vignette;

    this.rain?.setOpacity(w.rain ? 0.55 : 0);
    this.snow?.setOpacity(w.snow ? 0.95 : 0);
    if (this.stars) {
      this.stars.visible = w.stars > 0;
      if (w.stars > 0) this.stars.material.opacity = w.stars;
    }
    // 白天不开灯。夜间/雨雪才需要，且强度按天气分档
    this.headlight?.setIntensity(
      w.id === 'night' ? 1.0 : w.rain > 0 ? 0.7 : w.snow > 0 ? 0.55 : 0,
    );

    this.env?.applyWeather(w);
    this.scenery?.applyWeather(w);

    this._syncShadow();
  }

  async setWeather(id) {
    const next = WEATHERS[id];
    if (!next || id === this.themeId) return;
    this.themeId = id;
    await this._applyWeather(next);
  }

  async setVehicle(kind, paletteId = null) {
    if (kind === this.vehicleKind && paletteId === this.paletteId) return;
    if (this.bike) {
      this.scene.remove(this.bike.group);
      this.bike.dispose();
    }
    this.vehicleKind = kind;
    this.paletteId = paletteId;
    this.bike = await buildVehicle(kind, paletteId);
    this.bike.group.position.set(CONFIG.laneX[1], 0, CONFIG.bikeZ);
    this.scene.add(this.bike.group);
    this.headlight.attach(this.bike.group);
    if (this.nitro) this.bike.group.add(this.nitro.object);
    await this._applyWeather(this.theme);
  }

  setTheme(id) { return this.setWeather(id); }

  resize(w, h) {
    this.width = w;
    this.height = h;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.gtaoPass?.setSize(w, h);
  }

  render() {
    this.composer.render();
  }
}
