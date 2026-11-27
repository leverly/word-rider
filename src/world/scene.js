// 渲染器 / 场景 / 相机 / 灯光 / 后处理
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

const GRADE_SHADER = {
  uniforms: {
    tDiffuse: { value: null },
    uSaturation: { value: 1.22 },
    uContrast: { value: 1.07 },
    uVignette: { value: 0.55 },
    uTime: { value: 0 },
    uFlash: { value: 0 },
    uFlashColor: { value: new THREE.Color(0xffffff) },
    uSpeedLines: { value: 0 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }
  `,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float uSaturation, uContrast, uVignette, uTime, uFlash, uSpeedLines;
    uniform vec3 uFlashColor;
    varying vec2 vUv;

    float rand(vec2 c){ return fract(sin(dot(c, vec2(12.9898,78.233))) * 43758.5453); }

    void main(){
      vec2 uv = vUv;
      vec2 c = uv - 0.5;
      float r2 = dot(c, c);

      // 速度线：高速时向边缘拉出径向模糊感（极轻，避免糊）
      vec3 col;
      if (uSpeedLines > 0.001) {
        float amt = uSpeedLines * 0.012 * r2 * 4.0;
        vec3 acc = vec3(0.0);
        for (int i = 0; i < 4; i++) {
          float k = 1.0 - float(i) * amt;
          acc += texture2D(tDiffuse, 0.5 + c * k).rgb;
        }
        col = acc * 0.25;
      } else {
        col = texture2D(tDiffuse, uv).rgb;
      }

      // 饱和度
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(l), col, uSaturation);

      // 对比
      col = (col - 0.5) * uContrast + 0.5;

      // 晕影
      float v = smoothstep(0.85, 0.25, r2 * uVignette * 2.2);
      col *= mix(1.0, v, 0.55);

      // 闪白/闪红
      col = mix(col, uFlashColor, uFlash);

      // 轻微颗粒，压住色带
      col += (rand(vUv * 1024.0 + uTime) - 0.5) * 0.012;

      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

export function createRenderer(canvas, width, height, quality = 'high') {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false,
    powerPreference: 'high-performance',
    alpha: false,
  });
  renderer.setPixelRatio(Math.min(devicePixelRatio, quality === 'high' ? 2 : 1.25));
  renderer.setSize(width, height, false);
  renderer.shadowMap.enabled = quality !== 'low';
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.92;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  return renderer;
}

export function createComposer(renderer, scene, camera, width, height, quality = 'high') {
  const composer = new EffectComposer(renderer);
  composer.setSize(width, height);

  const renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);

  if (quality !== 'low') {
    const bloom = new UnrealBloomPass(
      new THREE.Vector2(width, height),
      0.30,   // strength
      0.55,   // radius
      0.90    // threshold：只让高光溢出
    );
    composer.addPass(bloom);
  }

  const grade = new ShaderPass(GRADE_SHADER);
  composer.addPass(grade);

  composer.addPass(new OutputPass());

  if (quality === 'high') {
    const smaa = new SMAAPass(width, height);
    composer.addPass(smaa);
  }

  return { composer, gradePass: grade };
}

/** 天空穹顶：渐变 + 太阳光晕，避免纯色平板感 */
export function createSky(scene, theme = null) {
  const t = theme || {
    sky: {
      top: 0x2f7fd0, mid: 0x9ed3f6, bottom: 0xd2eaf9,
      sunDir: [-0.35, 0.42, -0.83],
    },
  };
  const geo = new THREE.SphereGeometry(400, 32, 20);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uTop: { value: new THREE.Color(t.sky.top) },
      uMid: { value: new THREE.Color(t.sky.mid) },
      uBottom: { value: new THREE.Color(t.sky.bottom) },
      uSunDir: { value: new THREE.Vector3(...(t.sky.sunDir || [-0.35, 0.42, -0.83])).normalize() },
    },
    vertexShader: /* glsl */`
      varying vec3 vWorld;
      void main(){
        vWorld = (modelMatrix * vec4(position,1.0)).xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);
      }
    `,
    fragmentShader: /* glsl */`
      uniform vec3 uTop, uMid, uBottom, uSunDir;
      varying vec3 vWorld;
      void main(){
        vec3 dir = normalize(vWorld);
        float h = clamp(dir.y * 1.4 + 0.12, 0.0, 1.0);
        vec3 col = mix(uBottom, uMid, smoothstep(0.0, 0.42, h));
        col = mix(col, uTop, smoothstep(0.35, 1.0, h));

        float sun = max(dot(dir, normalize(uSunDir)), 0.0);
        col += vec3(1.0, 0.94, 0.76) * pow(sun, 220.0) * 1.6;
        col += vec3(1.0, 0.92, 0.70) * pow(sun, 12.0) * 0.16;

        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  const sky = new THREE.Mesh(geo, mat);
  sky.frustumCulled = false;
  scene.add(sky);

  sky.applyTheme = (next) => {
    mat.uniforms.uTop.value.set(next.sky.top);
    mat.uniforms.uMid.value.set(next.sky.mid);
    mat.uniforms.uBottom.value.set(next.sky.bottom);
    if (next.sky.sunDir) {
      mat.uniforms.uSunDir.value.set(...next.sky.sunDir).normalize();
    }
  };
  return sky;
}

/** 灯光 */
export function createLights(scene, theme = null) {
  const amb0 = theme?.ambient || { hemiSky: 0xdff2ff, hemiGround: 0x6fae5f, hemiInt: 1.05 };
  const sun0 = theme?.sun || { color: 0xfff4d6, int: 2.1 };

  const hemi = new THREE.HemisphereLight(amb0.hemiSky, amb0.hemiGround, amb0.hemiInt);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(sun0.color, sun0.int);
  sun.position.set(-26, 38, 18);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const d = 34;
  Object.assign(sun.shadow.camera, {
    left: -d, right: d, top: d * 0.9, bottom: -d * 0.9, near: 1, far: 160,
  });
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  scene.add(sun);
  scene.add(sun.target);

  const rim = new THREE.DirectionalLight(0xbde6ff, 0.42);
  rim.position.set(20, 12, -30);
  scene.add(rim);

  const amb = new THREE.AmbientLight(0xffffff, 0.22);
  scene.add(amb);

  function applyTheme(t) {
    const a = t.ambient || {};
    if (a.hemiSky != null) hemi.color.set(a.hemiSky);
    if (a.hemiGround != null) hemi.groundColor.set(a.hemiGround);
    if (a.hemiInt != null) hemi.intensity = a.hemiInt;
    if (t.sun) {
      sun.color.set(t.sun.color);
      sun.intensity = t.sun.int;
    }
  }

  return { sun, hemi, rim, amb, applyTheme };
}
