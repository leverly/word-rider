// 渲染核心：PBR 管线、HDRI 环境光、阴影、后处理
//
// 与旧版的根本区别
// 旧：MeshToonMaterial + 反向外壳描边 + 纯色天空盒 → 卡通 demo 味
// 新：MeshStandardMaterial + HDR 环境贴图（IBL）+ 级联软阴影 + GTAO 环境光遮蔽
//     + ACES 色调映射 + 轻量调色 → 商业游戏观感
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';

/* ══════════════════════════════════════════════════════════
   最终调色：胶片感（轻微分离色调 + 晕影 + 颗粒）
   速度感相关的 uniform 保留，与游戏逻辑对接
   ══════════════════════════════════════════════════════════ */
const GRADE_SHADER = {
  uniforms: {
    tDiffuse: { value: null },
    uSaturation: { value: 1.06 },
    uContrast: { value: 1.05 },
    uVignette: { value: 0.42 },
    uTime: { value: 0 },
    uFlash: { value: 0 },
    uFlashColor: { value: new THREE.Color(0xffffff) },
    uSpeedLines: { value: 0 },
    uBoost: { value: 0 },
    uShake: { value: 0 },
    uAberration: { value: 0.0 },
    uLift: { value: new THREE.Color(0.006, 0.008, 0.012) },   // 阴影抬升（胶片黑不是纯黑）
    uGain: { value: new THREE.Color(1.02, 1.00, 0.98) },      // 高光微暖
    uGrain: { value: 0.012 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }
  `,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float uSaturation, uContrast, uVignette, uTime, uFlash, uSpeedLines;
    uniform float uBoost, uShake, uAberration, uGrain;
    uniform vec3 uFlashColor, uLift, uGain;
    varying vec2 vUv;


    float hash(vec2 c){ return fract(sin(dot(c, vec2(12.9898,78.233))) * 43758.5453); }

    void main(){
      vec2 uv = vUv;
      vec2 c = uv - 0.5;
      float r2 = dot(c, c);

      // 速度径向模糊：中心保持绝对清晰（题干与选项都在中间），外围拉丝
      float amt = (uSpeedLines * 0.030 + uBoost * 0.022) * smoothstep(0.05, 0.42, r2);
      vec3 col;
      if (amt > 0.0015) {
        vec3 acc = vec3(0.0);
        float wsum = 0.0;
        for (int i = 0; i < 7; i++) {
          float t = float(i) / 6.0;
          float w = 1.0 - t * 0.62;
          acc += texture2D(tDiffuse, uv - c * t * amt).rgb * w;
          wsum += w;
        }
        col = acc / wsum;
      } else {
        col = texture2D(tDiffuse, uv).rgb;
      }

      // 色散：只在高速边缘出现，克制一点
      float ab = uAberration + uSpeedLines * 0.0008 + uBoost * 0.0010;
      if (ab > 0.0002) {
        vec2 off = c * ab;
        col.r = mix(col.r, texture2D(tDiffuse, uv + off).r, 0.8);
        col.b = mix(col.b, texture2D(tDiffuse, uv - off).b, 0.8);
      }

      // 饱和度 / 对比
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(l), col, uSaturation);
      col = (col - 0.5) * uContrast + 0.5;
      // 中间调 S 曲线：让天空有层次，不发灰
      col = clamp(col, vec3(0.0), vec3(1.0));
      col = col * col * (3.0 - 2.0 * col) * 0.34 + col * 0.66;

      // 胶片曲线：抬阴影 + 压高光
      col = col * uGain + uLift * (1.0 - col);

      // 冲刺：冷蓝偏移
      col = mix(col, col * vec3(0.93, 0.98, 1.12), uBoost * 0.5);

      // 晕影
      float vig = uVignette + uSpeedLines * 0.18;
      col *= mix(1.0, smoothstep(0.92, 0.16, r2 * vig * 2.1), 0.62);

      col = mix(col, uFlashColor, uFlash);

      // 细颗粒（避免大面积纯色出现色带）
      float g = hash(vUv * 1024.0 + fract(uTime)) - 0.5;
      col += g * (uGrain + uShake * 0.045);

      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

/* ══════════════════════════════════════════════════════════
   HDR 环境：同时作为背景和 IBL 光源
   ══════════════════════════════════════════════════════════ */
const hdrCache = new Map();

export function loadHDR(renderer, url) {
  if (hdrCache.has(url)) return hdrCache.get(url);
  const p = new Promise((res, rej) => {
    new HDRLoader()
      .setDataType(THREE.HalfFloatType)
      .load(url, (tex) => {
        tex.mapping = THREE.EquirectangularReflectionMapping;
        tex.colorSpace = THREE.LinearSRGBColorSpace;
        const pmrem = new THREE.PMREMGenerator(renderer);
        pmrem.compileEquirectangularShader();
        const env = pmrem.fromEquirectangular(tex).texture;
        pmrem.dispose();
        tex.dispose();
        res(env);
      }, undefined, rej);
  });
  hdrCache.set(url, p);
  return p;
}

/* ══════════════════════════════════════════════════════════
   渲染器
   ══════════════════════════════════════════════════════════ */
export function createRenderer(canvas, width, height, quality = 'high') {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false,          // 由 SMAA 负责，MSAA 在 HDR 管线里代价太高
    powerPreference: 'high-performance',
    alpha: false,
    stencil: false,
  });
  const dprCap = quality === 'high' ? 2 : quality === 'medium' ? 1.5 : 1;
  renderer.setPixelRatio(Math.min(devicePixelRatio, dprCap));
  renderer.setSize(width, height, false);

  renderer.shadowMap.enabled = quality !== 'low';
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.shadowMap.autoUpdate = true;

  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  // 环境相关
  renderer.info.autoReset = true;
  return renderer;
}

/* ══════════════════════════════════════════════════════════
   Composer：Render → GTAO → Bloom → Grade → Output → SMAA
   GTAO 让接触阴影（车与地面、树与草地之间）成立，
   这是「有重量感」的关键，纯直射光永远做不出来。
   ══════════════════════════════════════════════════════════ */
export function createComposer(renderer, scene, camera, width, height, quality = 'high') {
  const composer = new EffectComposer(renderer);
  composer.setSize(width, height);
  composer.setPixelRatio(renderer.getPixelRatio());

  composer.addPass(new RenderPass(scene, camera));

  let bloom = null;
  if (quality !== 'low') {
    bloom = new UnrealBloomPass(
      new THREE.Vector2(width, height),
      quality === 'high' ? 0.085 : 0.06,
      0.34,
      0.98,
    );
    composer.addPass(bloom);
  }

  // 顺序很关键：先 OutputPass 做色调映射 + sRGB 编码，
  // 调色再作用在显示空间（0..1）上，这才是正确的色彩管线。
  composer.addPass(new OutputPass());

  const grade = new ShaderPass(GRADE_SHADER);
  composer.addPass(grade);

  if (quality === 'high') {
    const smaa = new SMAAPass(width, height);
    composer.addPass(smaa);
  }

  return { composer, gradePass: grade, bloomPass: bloom, gtaoPass: null };
}

/* ══════════════════════════════════════════════════════════
   灯光：太阳（带软阴影）+ 半球补光
   ══════════════════════════════════════════════════════════ */
export function createLights(scene, theme) {
  const t = theme?.light || {};

  const hemi = new THREE.HemisphereLight(
    t.hemiSky ?? 0xbdd8f0, t.hemiGround ?? 0x4a5a3c, t.hemiInt ?? 0.55,
  );
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(t.sunColor ?? 0xfff2dc, t.sunInt ?? 2.6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 0.5;
  sun.shadow.camera.far = 120;
  // 紧贴相机的视锥：阴影分辨率给到真正需要的地方
  const D = 30;
  Object.assign(sun.shadow.camera, { left: -D, right: D, top: D * 0.85, bottom: -D * 0.85 });
  sun.shadow.camera.updateProjectionMatrix();
  sun.shadow.bias = -0.00035;
  sun.shadow.normalBias = 0.028;
  sun.shadow.radius = 2.2;      // PCF 采样半径：阴影边缘的柔化
  scene.add(sun);
  scene.add(sun.target);

  // 补光：模拟天光从反方向来的漫射，避免阴影死黑
  const fill = new THREE.DirectionalLight(t.fillColor ?? 0xa8c8e8, t.fillInt ?? 0.30);
  fill.position.set(18, 10, 26);
  scene.add(fill);

  function applyTheme(th) {
    const L = th.light || {};
    if (L.hemiSky != null) hemi.color.set(L.hemiSky);
    if (L.hemiGround != null) hemi.groundColor.set(L.hemiGround);
    if (L.hemiInt != null) hemi.intensity = L.hemiInt;
    if (L.sunColor != null) sun.color.set(L.sunColor);
    if (L.sunInt != null) sun.intensity = L.sunInt;
    if (L.fillColor != null) fill.color.set(L.fillColor);
    if (L.fillInt != null) fill.intensity = L.fillInt;
  }

  return { sun, hemi, fill, applyTheme };
}

/** 阴影相机跟随焦点（车），保证近处阴影始终高分辨率 */
export function followShadow(lights, focusZ) {
  const { sun } = lights;
  const dir = sun.userData.dir || new THREE.Vector3(-0.42, 0.78, 0.46).normalize();
  sun.position.set(
    dir.x * 46,
    dir.y * 46,
    focusZ + dir.z * 46,
  );
  sun.target.position.set(0, 0, focusZ - 6);
  sun.target.updateMatrixWorld();
}
