// 天气 / 时段：以 HDRI 为环境光和背景，配对的灯光、雾、调色参数
// 每套天气是一份完整「摄影设定」：光比、色温、雾浓度、地面干湿

export const WEATHERS = {
  day: {
    id: 'day', name: '白天', desc: '晴空万里',
    hdr: 'day',
    skyRot: 0.6,
    skyIntensity: 0.62,
    bgIntensity: 1.0,
    light: {
      hemiSky: 0xbcd8f4, hemiGround: 0x4e5c3a, hemiInt: 0.20,
      sunColor: 0xfff4e0, sunInt: 1.85,
      fillColor: 0xa8c6e6, fillInt: 0.08,
    },
    sunDir: [-0.62, 0.66, 0.42],
    fog: { color: 0xa9c6e2, near: 320, far: 1450 },
    exposure: 1.02,
    grade: { saturation: 1.10, contrast: 1.05, vignette: 0.40 },
    roadWet: 0.0,
    lampOn: false,
    stars: 0, moon: 0,
    rain: 0, snow: 0,
    ambientBoost: 0,
  },

  night: {
    id: 'night', name: '黑夜', desc: '星空与路灯',
    hdr: 'night',
    skyRot: 2.1,
    skyIntensity: 0.30,
    bgIntensity: 1.30,
    light: {
      // 夜间主光改「月光」：偏蓝、强度足够照亮路面
      hemiSky: 0x3d5a8c, hemiGround: 0x1a2430, hemiInt: 0.55,
      sunColor: 0xa8c6f0, sunInt: 0.62,
      fillColor: 0x4a6a9c, fillInt: 0.30,
    },
    sunDir: [0.52, 0.62, 0.58],
    fog: { color: 0x0b1524, near: 240, far: 1200 },
    exposure: 1.05,
    grade: { saturation: 1.02, contrast: 1.10, vignette: 0.62 },
    roadWet: 0.15,
    lampOn: true,
    stars: 0.9, moon: 1,
    rain: 0, snow: 0,
    ambientBoost: 0.06,
  },

  rain: {
    id: 'rain', name: '下雨', desc: '湿滑路面',
    hdr: 'rain',
    skyRot: 1.2,
    skyIntensity: 0.30,
    bgIntensity: 0.62,
    light: {
      hemiSky: 0x8ea4ba, hemiGround: 0x38443f, hemiInt: 0.22,
      sunColor: 0xbcc8d4, sunInt: 0.42,
      fillColor: 0x8ea2b6, fillInt: 0.14,
    },
    sunDir: [-0.44, 0.80, 0.40],
    fog: { color: 0x8fa1b2, near: 130, far: 780 },
    exposure: 0.82,
    grade: { saturation: 0.94, contrast: 1.06, vignette: 0.50 },
    roadWet: 0.92,          // 近满湿：镜面反射雨天路面
    lampOn: true,
    stars: 0, moon: 0,
    rain: 1, snow: 0,
    ambientBoost: 0.04,
  },

  snow: {
    id: 'snow', name: '下雪', desc: '雪覆大地',
    hdr: 'snow',
    skyRot: 0.3,
    skyIntensity: 0.42,
    bgIntensity: 0.72,
    light: {
      hemiSky: 0xc8d8e8, hemiGround: 0x8c9ca8, hemiInt: 0.24,
      sunColor: 0xe8f0fa, sunInt: 0.78,
      fillColor: 0xb8cade, fillInt: 0.16,
    },
    sunDir: [-0.50, 0.74, 0.44],
    fog: { color: 0xcfdde9, near: 110, far: 700 },
    exposure: 0.90,
    grade: { saturation: 0.88, contrast: 0.99, vignette: 0.36 },
    roadWet: 0.30,
    lampOn: true,
    stars: 0, moon: 0,
    rain: 0, snow: 1,
    ambientBoost: 0.10,
  },
};

export const WEATHER_ORDER = ['day', 'night', 'rain', 'snow'];
export const DEFAULT_WEATHER = 'day';

/* 配色方案：只保留最能出效果的两种座驾各 2 色 */
export const PALETTES = {
  bike: [
    { id: 'teal', name: '青碧', swatch: '#1fb3ab',
      frame: [0.055, 0.615, 0.596], frameDark: [0.030, 0.430, 0.420],
      accent: [1.000, 0.708, 0.278], rim: [0.760, 0.790, 0.830],
      metal: [0.620, 0.650, 0.700], seat: [0.075, 0.088, 0.115] },
    { id: 'coral', name: '珊瑚', swatch: '#f2705a',
      frame: [0.850, 0.230, 0.180], frameDark: [0.620, 0.140, 0.110],
      accent: [0.145, 0.620, 0.780], rim: [0.900, 0.910, 0.920],
      metal: [0.700, 0.720, 0.750], seat: [0.085, 0.075, 0.085] },
  ],
  scooter: [
    { id: 'midnight', name: '墨夜', swatch: '#2b3550',
      frame: [0.105, 0.155, 0.255], frameDark: [0.070, 0.105, 0.180],
      accent: [1.000, 0.470, 0.230], rim: [0.760, 0.790, 0.830],
      metal: [0.640, 0.670, 0.720], seat: [0.130, 0.150, 0.190] },
    { id: 'mint', name: '薄荷', swatch: '#3cc9a0',
      frame: [0.110, 0.700, 0.520], frameDark: [0.060, 0.480, 0.360],
      accent: [0.115, 0.140, 0.200], rim: [0.800, 0.830, 0.850],
      metal: [0.700, 0.730, 0.760], seat: [0.110, 0.130, 0.150] },
  ],
};

/* 材质名映射：模型里写的名字 → 运行时按配色换色 */
export const BIKE_MATERIAL_MAP = {
  BikeFrame: 'frame',
  BikeFrameDark: 'frameDark',
  BikeAccent: 'accent',
  BikeRim: 'rim',
  BikeMetal: 'metal',
  BikeSeat: 'seat',
};

export const SCOOTER_MATERIAL_MAP = {
  ScootFrame: 'frame',
  ScootFrameDark: 'frameDark',
  ScootAccent: 'accent',
  ScootRim: 'rim',
  ScootMetal: 'metal',
  ScootDeck: 'seat',
};

/* 鹈鹕上跟着配色走的两块 */
export const PELICAN_ACCENT_MATERIALS = ['PelicanCap', 'PelicanAccent'];
