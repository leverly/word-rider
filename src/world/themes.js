// 场景主题：三条赛道 × 天空/地面/雾/景物

export const THEMES = {
  coast: {
    id: 'coast',
    name: '海边',
    tag: '蔚蓝海岸',
    desc: '海风、椰树、远处的灯塔',
    sky: {
      top: 0x2a6fc4,
      mid: 0x74bce8,
      bottom: 0xdff0fb,
      sunDir: [-0.28, 0.30, -0.91],
      sunTint: [1.0, 0.96, 0.86],
    },
    fog: { color: 0xd9eefb, near: 80, far: 260 },
    ground: {
      base: 0xe8dcbc,       // 沙滩
      stripe: 0xdfd0a8,
      stripeAlt: 0xd6c79e,
    },
    road: { surface: 0x4a5670, shoulder: 0xefe6cf },
    water: { enabled: true, color: 0x2179b8, deep: 0x14538a, foam: 0xeaf6ff },
    props: ['palm', 'palm', 'umbrella', 'rock', 'bush'],
    propFar: ['lighthouse'],
    ambient: { hemiSky: 0xe4f4ff, hemiGround: 0xd8c9a0, hemiInt: 1.15 },
    sun: { color: 0xfff3d8, int: 2.2 },
    accent: '#2fa8dd',
  },

  country: {
    id: 'country',
    name: '乡村',
    tag: '乡间小路',
    desc: '麦田、木栅栏、红顶农舍',
    sky: {
      top: 0x3f86cf,
      mid: 0x83c2ec,
      bottom: 0xe6f3fc,
      sunDir: [-0.36, 0.40, -0.84],
      sunTint: [1.0, 0.95, 0.82],
    },
    fog: { color: 0xdfeef9, near: 80, far: 250 },
    ground: {
      base: 0x6cba5c,       // 草地
      stripe: 0x63b054,
      stripeAlt: 0x74c463,
    },
    road: { surface: 0x4c5266, shoulder: 0xd9cfb6 },
    water: { enabled: false },
    props: ['roundTree', 'pine', 'haystack', 'fence', 'bush', 'roundTree'],
    propFar: ['barn', 'windmill'],
    ambient: { hemiSky: 0xdcf0ff, hemiGround: 0x7cae5c, hemiInt: 1.08 },
    sun: { color: 0xfff0c8, int: 2.15 },
    accent: '#6cba5c',
  },

  prairie: {
    id: 'prairie',
    name: '草原',
    tag: '无垠草原',
    desc: '金色草浪、孤独的树、远山',
    sky: {
      top: 0x4a8ed8,
      mid: 0x9cccee,
      bottom: 0xf0f7fc,
      sunDir: [-0.42, 0.34, -0.84],
      sunTint: [1.0, 0.93, 0.74],
    },
    fog: { color: 0xe6f0f6, near: 90, far: 290 },
    ground: {
      base: 0xc9b463,       // 金草
      stripe: 0xbfa957,
      stripeAlt: 0xd3bf6d,
    },
    road: { surface: 0x515a6e, shoulder: 0xd6cdb4 },
    water: { enabled: false },
    props: ['grassTuft', 'lonelyTree', 'bush', 'rock', 'grassTuft', 'lonelyTree'],
    propFar: ['mesa'],
    ambient: { hemiSky: 0xe8f4ff, hemiGround: 0xc0aa60, hemiInt: 1.12 },
    sun: { color: 0xfff0c0, int: 2.3 },
    accent: '#c9b463',
  },
};

export const THEME_ORDER = ['coast', 'country', 'prairie'];

/* ── 座驾定义 ── */
export const RIDERS = {
  bike: {
    id: 'bike',
    name: '自行车',
    icon: '🚲',
    seatHeight: 0.96,     // 鹈鹕坐垫高度
    pedalSpread: 0.15,
  },
  scooter: {
    id: 'scooter',
    name: '滑板车',
    icon: '🛴',
    seatHeight: 0.0,      // 滑板车站立，无座位
    deckY: 0.22,
  },
};

/* ── 配色方案（每种座驾三套） ── */
export const PALETTES = {
  bike: [
    {
      id: 'teal', name: '青碧',
      frame: 0x1fb3ab, frameDark: 0x158a84, accent: 0xffb648,
      rim: 0xc8d4e2, metal: 0x9fb0c4, seat: 0x141c2b,
      swatch: '#1fb3ab',
    },
    {
      id: 'coral', name: '珊瑚',
      frame: 0xf2705a, frameDark: 0xc9503c, accent: 0x2fa8dd,
      rim: 0xf0f3f7, metal: 0xb9c4d2, seat: 0x1b2230,
      swatch: '#f2705a',
    },
    {
      id: 'midnight', name: '墨夜',
      frame: 0x35406b, frameDark: 0x232b4d, accent: 0xe8b93a,
      rim: 0xa8b6c8, metal: 0x7c8ca3, seat: 0x11161f,
      swatch: '#35406b',
    },
  ],
  scooter: [
    {
      id: 'sunset', name: '落日',
      frame: 0xff7a45, frameDark: 0xd15a2c, accent: 0x2b3550,
      rim: 0x2b3550, metal: 0xa9b6c7, seat: 0x1a2130,
      swatch: '#ff7a45',
    },
    {
      id: 'mint', name: '薄荷',
      frame: 0x3cc9a0, frameDark: 0x2a9d7c, accent: 0x1f2a3d,
      rim: 0x1f2a3d, metal: 0xb7c4d3, seat: 0x1a2130,
      swatch: '#3cc9a0',
    },
    {
      id: 'violet', name: '紫罗兰',
      frame: 0x8a6fe0, frameDark: 0x6b52b8, accent: 0xffd166,
      rim: 0x2a2440, metal: 0xb3b9d0, seat: 0x181428,
      swatch: '#8a6fe0',
    },
  ],
};

/* ── 鹈鹕的三种羽色（跟随座驾配色微调） ── */
export const PELICAN_SKINS = {
  classic: { body: 0xf7f8fa, wing: 0xe4e8ee, beak: 0xffb03a, pouch: 0xffcf7a, leg: 0xf0a040, eye: 0x1b2230 },
  warm:    { body: 0xfbf6ec, wing: 0xeee2cf, beak: 0xff9e2c, pouch: 0xffbe66, leg: 0xe89030, eye: 0x1b2230 },
  cool:    { body: 0xeff3f8, wing: 0xd9e2ec, beak: 0xffb03a, pouch: 0xffcb70, leg: 0xe89a38, eye: 0x1b2230 },
};
