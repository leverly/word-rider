// 大气效果：雨、雪、星空、车灯
//
// 做法要点
// - 雨用「面向相机的细长面片」而非线段：有宽度、能进 bloom、随速度倾斜
// - 雪用柔边 sprite：真实雪花不是方块
// - 星空用 shader 点：有大小差、有闪烁、有银河带
// - 车灯是真 SpotLight，能照亮路面与地面雾
import * as THREE from 'three';

/* ══════════════════════════════════════════════════════════
   雨：InstancedMesh 的细长面片（真正的 3D 雨丝）
   Points 只能画方形/贴图点，做不到「长条雨丝」，
   而且 gl_PointSize 有上限（通常 63px），远处就成了点。
   用 instanced 薄片才能得到正确的雨丝形态。
   ══════════════════════════════════════════════════════════ */
export function createRain(count = 1400) {
  const AREA = 44;
  const H = 24;

  // 单位雨丝：沿 Y 轴长 1、宽 0.012 的薄片
  const geo = new THREE.PlaneGeometry(0.016, 1, 1, 1);
  geo.translate(0, 0.5, 0);

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uOpacity: { value: 0 },
      uTime: { value: 0 },
      uTilt: { value: 0 },
      uHeight: { value: H },
    },
    vertexShader: /* glsl */`
      attribute vec3 iOffset;   // 基础位置
      attribute vec3 iData;     // x: 速度, y: 长度, z: 相位
      uniform float uTime;
      uniform float uTilt;
      uniform float uHeight;
      varying vec2 vUv;
      varying float vAlpha;
      void main(){
        vUv = uv;
        vec3 p = position;
        // 沿 Y 拉长，并按速度下落
        float fall = mod(iOffset.y - uTime * iData.x, uHeight);
        p.y *= iData.y;
        p.y += fall;
        // 随车速向后倾斜（雨丝被风吹斜）
        p.z += (fall / uHeight) * uTilt * 5.0;
        // 水平微摆
        p.x += sin(uTime * 2.0 + iData.z) * 0.10;
        vec3 world = vec3(iOffset.x, 0.0, iOffset.z) + p;
        vec4 mv = modelViewMatrix * vec4(world, 1.0);
        gl_Position = projectionMatrix * mv;
        float d = -mv.z;
        vAlpha = smoothstep(64.0, 5.0, d) * smoothstep(0.5, 2.0, d);
      }
    `,
    fragmentShader: /* glsl */`
      uniform float uOpacity;
      varying vec2 vUv;
      varying float vAlpha;
      void main(){
        // 竖向拉出渐变（头亮尾淡），横向收边
        float edge = smoothstep(0.0, 0.35, vUv.x) * smoothstep(1.0, 0.65, vUv.x);
        float tail = smoothstep(0.0, 0.25, vUv.y) * smoothstep(1.0, 0.55, vUv.y);
        float a = edge * tail * vAlpha * uOpacity;
        if (a < 0.004) discard;
        gl_FragColor = vec4(0.82, 0.89, 0.96, a);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.NormalBlending,
    side: THREE.DoubleSide,
  });

  const mesh = new THREE.InstancedMesh(geo, mat, count);
  mesh.frustumCulled = false;

  const offset = new Float32Array(count * 3);
  const data = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    offset[i * 3] = (Math.random() - 0.5) * AREA;
    offset[i * 3 + 1] = Math.random() * H;
    offset[i * 3 + 2] = (Math.random() - 0.5) * AREA - 8;
    data[i * 3] = 30 + Math.random() * 24;        // 下落速度
    data[i * 3 + 1] = 0.45 + Math.random() * 0.75; // 雨丝长度
    data[i * 3 + 2] = Math.random() * Math.PI * 2;
  }
  geo.setAttribute('iOffset', new THREE.InstancedBufferAttribute(offset, 3));
  geo.setAttribute('iData', new THREE.InstancedBufferAttribute(data, 3));

  return {
    object: mesh,
    setOpacity(v) { mat.uniforms.uOpacity.value = v; },
    update(dt, speed, time, camera) {
      mat.uniforms.uTime.value = time;
      mat.uniforms.uTilt.value = THREE.MathUtils.clamp(speed / 22, 0, 1);
      mesh.position.set(camera.position.x, 0, camera.position.z - 8);
    },
  };
}

/* ══════════════════════════════════════════════════════════
   雪
   ══════════════════════════════════════════════════════════ */
export function createSnow(count = 1600) {
  const AREA = 56;
  const H = 26;

  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(count * 3);
  const speed = new Float32Array(count);
  const phase = new Float32Array(count);
  const size = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    pos[i * 3] = (Math.random() - 0.5) * AREA;
    pos[i * 3 + 1] = Math.random() * H;
    pos[i * 3 + 2] = (Math.random() - 0.5) * AREA - 10;
    speed[i] = 1.2 + Math.random() * 2.4;
    phase[i] = Math.random() * Math.PI * 2;
    size[i] = 0.10 + Math.random() * 0.22;
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aSpeed', new THREE.BufferAttribute(speed, 1));
  geo.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
  geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));

  // 柔边雪花（六角形太脆，用圆形 + 内核）
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const g = cv.getContext('2d');
  const rg = g.createRadialGradient(32, 32, 0, 32, 32, 30);
  rg.addColorStop(0, 'rgba(255,255,255,1)');
  rg.addColorStop(0.35, 'rgba(248,252,255,0.85)');
  rg.addColorStop(0.72, 'rgba(230,242,255,0.35)');
  rg.addColorStop(1, 'rgba(220,236,255,0)');
  g.fillStyle = rg;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTex: { value: tex },
      uOpacity: { value: 0 },
      uTime: { value: 0 },
      uPixelRatio: { value: Math.min(devicePixelRatio, 2) },
    },
    vertexShader: /* glsl */`
      attribute float aSpeed;
      attribute float aPhase;
      attribute float aSize;
      uniform float uTime;
      uniform float uPixelRatio;
      varying float vAlpha;
      void main(){
        vec3 p = position;
        p.y = mod(p.y - uTime * aSpeed, ${H.toFixed(1)});
        // 侧向飘摆（每片相位不同）
        p.x += sin(uTime * 0.9 + aPhase) * 0.55;
        p.z += cos(uTime * 0.7 + aPhase * 1.7) * 0.42;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        float d = -mv.z;
        vAlpha = smoothstep(62.0, 8.0, d) * smoothstep(0.4, 2.5, d);
        gl_PointSize = aSize * 340.0 * uPixelRatio / max(d, 1.0);
      }
    `,
    fragmentShader: /* glsl */`
      uniform sampler2D uTex;
      uniform float uOpacity;
      varying float vAlpha;
      void main(){
        vec4 t = texture2D(uTex, gl_PointCoord);
        if (t.a < 0.02) discard;
        gl_FragColor = vec4(t.rgb, t.a * vAlpha * uOpacity);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.NormalBlending,
  });

  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;

  return {
    object: points,
    setOpacity(v) { mat.uniforms.uOpacity.value = v; },
    update(dt, speed, time, camera) {
      mat.uniforms.uTime.value = time;
      points.position.set(camera.position.x, 0, camera.position.z - 10);
    },
  };
}

/* ══════════════════════════════════════════════════════════
   星空
   ══════════════════════════════════════════════════════════ */
export function createStars(count = 2200) {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(count * 3);
  const mag = new Float32Array(count);
  const phase = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    // 上半球
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(Math.random() * 0.96 + 0.04);
    const r = 900;
    pos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    pos[i * 3 + 1] = r * Math.cos(phi) + 40;
    pos[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);

    // 星等：多数暗、少数亮（幂律分布才自然）
    mag[i] = 0.35 + Math.pow(Math.random(), 3.2) * 2.6;
    phase[i] = Math.random() * Math.PI * 2;
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aMag', new THREE.BufferAttribute(mag, 1));
  geo.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uOpacity: { value: 1 },
      uTime: { value: 0 },
      uPixelRatio: { value: Math.min(devicePixelRatio, 2) },
    },
    vertexShader: /* glsl */`
      attribute float aMag;
      attribute float aPhase;
      uniform float uTime;
      uniform float uPixelRatio;
      varying float vBright;
      void main(){
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        // 闪烁
        float tw = 0.75 + 0.25 * sin(uTime * 1.6 + aPhase * 4.0);
        vBright = aMag * tw;
        gl_PointSize = (1.4 + aMag * 1.9) * uPixelRatio;
      }
    `,
    fragmentShader: /* glsl */`
      uniform float uOpacity;
      varying float vBright;
      void main(){
        vec2 c = gl_PointCoord - 0.5;
        float d = length(c);
        if (d > 0.5) discard;
        // 核心亮 + 外圈柔光
        float core = smoothstep(0.5, 0.0, d * 2.2);
        vec3 col = mix(vec3(0.80, 0.86, 1.0), vec3(1.0, 0.96, 0.88), vBright * 0.3);
        gl_FragColor = vec4(col, core * vBright * 0.9 * uOpacity);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
  });

  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  points.renderOrder = -10;

  // 让星星跟着相机（天空球行为）
  points.userData.follow = true;
  return points;
}

/* ══════════════════════════════════════════════════════════
   车灯：真实 SpotLight + 体积光锥
   ══════════════════════════════════════════════════════════ */
export function createHeadlight() {
  const group = new THREE.Group();

  // 主光：照亮前方路面
  const spot = new THREE.SpotLight(0xfff0d0, 0, 42, 0.52, 0.55, 1.4);
  spot.position.set(0, 0.70, -0.45);
  spot.target.position.set(0, 0, -14);
  group.add(spot, spot.target);

  // 近处地面补光（让车头附近也亮）
  const near = new THREE.PointLight(0xffeec8, 0, 7, 2.0);
  near.position.set(0, 0.55, -1.0);
  group.add(near);

  // 体积光锥（加法混合的锥面，夜里能看见光柱）
  const coneGeo = new THREE.ConeGeometry(2.6, 11, 20, 1, true);
  const coneMat = new THREE.ShaderMaterial({
    uniforms: { uOpacity: { value: 0 } },
    vertexShader: /* glsl */`
      varying float vZ;
      void main(){
        vZ = uv.y;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);
      }
    `,
    fragmentShader: /* glsl */`
      uniform float uOpacity;
      varying float vZ;
      void main(){
        // 从灯口到远端淡出
        float a = smoothstep(0.0, 0.30, vZ) * (1.0 - smoothstep(0.55, 1.0, vZ));
        gl_FragColor = vec4(1.0, 0.94, 0.78, a * uOpacity * 0.028);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    fog: false,
  });
  const cone = new THREE.Mesh(coneGeo, coneMat);
  cone.rotation.x = Math.PI / 2 + 0.10;
  cone.position.set(0, 0.62, -7.2);
  group.add(cone);

  return {
    object: group,
    spot,
    attach(parent) {
      if (group.parent) group.parent.remove(group);
      parent.add(group);
      group.position.set(0, 0, 0);
    },
    setIntensity(v) {
      spot.intensity = v * 34;
      near.intensity = v * 2.2;
      coneMat.uniforms.uOpacity.value = v;
      group.visible = v > 0.01;
    },
  };
}
