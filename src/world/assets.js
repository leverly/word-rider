// 资产加载：glb 模型 + 贴图，带缓存与进度
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const loader = new GLTFLoader();

const gltfCache = new Map();
const texCache = new Map();

/** 载入一个 glb，返回 { scene, animations }（带缓存，重复调用复用同一份） */
export function loadModel(url) {
  if (gltfCache.has(url)) return gltfCache.get(url);
  const p = new Promise((res, rej) => {
    loader.load(url, (gltf) => res(gltf), undefined, err => rej(new Error(`${url}: ${err.message || err}`)));
  });
  gltfCache.set(url, p);
  return p;
}

/** 载入 glb 并返回一个可安全实例化的「原型」——深拷贝节点但共享几何与材质 */
export async function loadInstance(url) {
  const gltf = await loadModel(url);
  return cloneWithSharedMaterials(gltf.scene);
}

/**
 * 克隆节点树：几何 / 材质共享，只有变换独立。
 * 这正是游戏里画同一棵树上百次所需要的行为。
 */
export function cloneWithSharedMaterials(root) {
  const clone = root.clone(true);
  // clone() 已共享 geometry 与 material 引用，无需额外处理
  clone.traverse(o => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  return clone;
}

/** 载入 PBR 贴图（颜色 / 法线 / 粗糙度） */
export function loadTexture(url, { srgb = false, repeat = [1, 1], aniso = 8 } = {}) {
  const key = `${url}|${repeat.join('x')}|${srgb}`;
  if (texCache.has(key)) return texCache.get(key);
  const p = new Promise((res, rej) => {
    new THREE.TextureLoader().load(url, (tex) => {
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(repeat[0], repeat[1]);
      tex.anisotropy = aniso;
      tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      tex.needsUpdate = true;
      res(tex);
    }, undefined, rej);
  });
  texCache.set(key, p);
  return p;
}

/**
 * 从 glb 场景里按名字找节点（Blender 节点名，大小写敏感）
 */
export function findNode(root, name) {
  let found = null;
  root.traverse(o => {
    if (!found && o.name === name) found = o;
  });
  return found;
}

/** 收集模型里所有材质，按名字索引（用于运行时换色） */
export function indexMaterials(root) {
  const map = new Map();
  root.traverse(o => {
    if (!o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (m && !map.has(m.name)) map.set(m.name, m);
    }
  });
  return map;
}

/** 给材质换基础色（保留其它 PBR 参数） */
export function recolor(mat, rgb) {
  if (!mat) return;
  mat.color.setRGB(rgb[0], rgb[1], rgb[2], THREE.SRGBColorSpace);
  mat.needsUpdate = true;
}

/** 让材质发光（夜间灯、火花） */
export function setEmissive(mat, rgb, intensity = 1) {
  if (!mat) return;
  if (!mat.emissive) return;
  mat.emissive.setRGB(rgb[0], rgb[1], rgb[2], THREE.SRGBColorSpace);
  mat.emissiveIntensity = intensity;
  mat.needsUpdate = true;
}

/** 模型包围盒（校准放置高度用） */
export function bbox(root) {
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  return { box, size, center, min: box.min.clone(), max: box.max.clone() };
}
