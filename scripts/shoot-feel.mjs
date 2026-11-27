// 体感验收：跑真实游戏循环，抓运行时错误 + 各速度档的实景图
// 用法：node scripts/shoot-feel.mjs <outDir> [port]
import { spawn } from 'node:child_process';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

const OUT = process.argv[2] || 'design/feel';
const PORT = Number(process.argv[3] || 8901);
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DBG = 9371;
const PROFILE = '/tmp/wr-feel';
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function cdpTarget() {
  for (let i = 0; i < 80; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${DBG}/json/list`)).json();
      const p = list.find(t => t.type === 'page');
      if (p) return p;
    } catch { /* wait */ }
    await sleep(250);
  }
  throw new Error('CDP 未就绪');
}

class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.w = new Map(); }
  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    const c = new CDP(ws);
    ws.onmessage = ev => {
      const m = JSON.parse(ev.data);
      if (m.id && c.w.has(m.id)) {
        const { res, rej } = c.w.get(m.id); c.w.delete(m.id);
        m.error ? rej(new Error(m.error.message)) : res(m.result);
      }
    };
    return c;
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((res, rej) => this.w.set(id, { res, rej }));
  }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', {
      expression: expr, awaitPromise: true, returnByValue: true,
    });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval');
    return r.result.value;
  }
  async shot(path) {
    const r = await this.send('Page.captureScreenshot', { format: 'png' });
    await writeFile(path, Buffer.from(r.data, 'base64'));
    console.log('  📸', path);
  }
}

async function main() {
  await rm(PROFILE, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });
  const chrome = spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${DBG}`, `--user-data-dir=${PROFILE}`,
    '--window-size=1400,880', '--hide-scrollbars', '--no-first-run',
    '--no-default-browser-check', '--enable-unsafe-swiftshader',
    '--use-gl=angle', '--use-angle=swiftshader', 'about:blank',
  ], { stdio: 'ignore' });

  try {
    const target = await cdpTarget();
    const c = await CDP.connect(target.webSocketDebuggerUrl);
    await c.send('Page.enable');
    await c.send('Runtime.enable');
    await c.send('Emulation.setDeviceMetricsOverride', {
      width: 1400, height: 880, deviceScaleFactor: 1, mobile: false,
    });
    await c.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/` });

    // 收集运行时错误
    await c.eval(`window.__errs = [];
      addEventListener('error', e => window.__errs.push('ERR: ' + e.message));
      addEventListener('unhandledrejection', e => window.__errs.push('REJ: ' + e.reason));
      true`);

    for (let i = 0; i < 120; i++) {
      if (await c.eval('!!window.__rider').catch(() => false)) break;
      await sleep(250);
    }
    console.log('ready');

    // 只推逻辑，不每帧渲染（软件渲染太慢）
    await c.eval(`window.__tick = (n = 1, dt = 1/60, render = false) => {
      const r = window.__rider;
      for (let i = 0; i < n; i++) {
        r.game.update(dt);
        r.world.update(dt, r.game, performance.now() / 1000);
        if (render) r.world.render();
      }
      return true;
    };
    window.__render = () => { window.__rider.world.render(); return true; };
    true`);

    await c.eval(`(() => {
      const r = window.__rider;
      r.game.reset({ includeNew: true, gear: 2, theme: 'day', vehicle: 'bike', palette: 'teal' });
      r.ui.show('hud');
      r.game.start();
      r.game.countdown = 0.001;
      return true;
    })()`);
    await c.eval(`window.__tick(6)`);

    // 各档速度 + 冲刺，各拍一张
    const cases = [
      { gear: 0, label: '1-低速', boost: false },
      { gear: 2, label: '2-巡航', boost: false },
      { gear: 4, label: '3-冲刺档', boost: false },
      { gear: 4, label: '4-氮气', boost: true },
    ];
    for (const cs of cases) {
      const info = await c.eval(`(() => {
        const g = window.__rider.game;
        g.gear = ${cs.gear};
        g.speed = ${cs.gear === 4 ? 20 : [10, 12.5, 15, 17.5, 20][cs.gear]};
        ${cs.boost ? "g.active.boost = 10;" : "g.active.boost = 0;"}
        // 推进几帧让相机/特效收敛
        window.__tick(40);
        window.__render();
        const w = window.__rider.world;
        const u = w.gradePass.uniforms;
        return JSON.stringify({
          gear: g.gear,
          speed: +g.speed.toFixed(1),
          fov: +w.camera.fov.toFixed(1),
          camY: +w.camera.position.y.toFixed(2),
          camZ: +w.camera.position.z.toFixed(2),
          roll: +w.camera.rotation.z.toFixed(3),
          speedLines: +u.uSpeedLines.value.toFixed(2),
          boostU: +u.uBoost.value.toFixed(2),
          streakOpacity: +w.streaks.object.material.opacity.toFixed(3),
          nitroVisible: w.nitro.object.visible,
        });
      })()`);
      console.log(' ', cs.label, info);
      await c.shot(join(OUT, `feel-${cs.label}.png`));
    }

    // 换道：检查侧倾与相机冲击
    const laneInfo = await c.eval(`(() => {
      const g = window.__rider.game;
      g.active.boost = 0;
      g.gear = 2; g.speed = 15;
      g.setLane(3);
      window.__tick(6);
      const w = window.__rider.world;
      return JSON.stringify({
        lane: g.lane,
        camKick: +(w.camKick || 0).toFixed(3),
        camRoll: +w.camera.rotation.z.toFixed(3),
        camX: +w.camera.position.x.toFixed(2),
      });
    })()`);
    console.log('  换道 →', laneInfo);

    // 路面滚动：确认标线真的在动
    const scrollInfo = await c.eval(`(() => {
      const w = window.__rider.world;
      const before = w.road.scroll;
      window.__tick(30);
      const after = w.road.scroll;
      return JSON.stringify({ before: +before.toFixed(1), after: +after.toFixed(1), delta: +(after-before).toFixed(1) });
    })()`);
    console.log('  路面滚动 →', scrollInfo);

    const errs = await c.eval('JSON.stringify(window.__errs)');
    console.log('  运行时错误 →', errs);
  } finally {
    chrome.kill('SIGKILL');
  }
}

main().catch(e => { console.error('✘', e.message); process.exit(1); });
