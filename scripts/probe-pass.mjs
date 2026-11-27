// 测量「过门瞬间」：门架从 z=0 一路掠过镜头时，屏幕被占多少
// 用法：node scripts/probe-pass.mjs [port]
import { spawn } from 'node:child_process';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

const PORT = Number(process.argv[2] || 8901);
const OUT = 'screenshots/pass';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DBG = 9335;
const PROFILE = '/tmp/wr-pass-profile';
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function cdpTarget() {
  for (let i = 0; i < 60; i++) {
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
  async eval(e) {
    const r = await this.send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval');
    return r.result.value;
  }
  async shot(path) {
    const r = await this.send('Page.captureScreenshot', { format: 'png' });
    await writeFile(path, Buffer.from(r.data, 'base64'));
  }
}

async function main() {
  await rm(PROFILE, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });
  const chrome = spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${DBG}`, `--user-data-dir=${PROFILE}`,
    '--window-size=1400,880', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check',
    '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', 'about:blank',
  ], { stdio: 'ignore' });

  try {
    const c = await CDP.connect((await cdpTarget()).webSocketDebuggerUrl);
    await c.send('Page.enable');
    await c.send('Runtime.enable');
    await c.send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 880, deviceScaleFactor: 1, mobile: false });
    await c.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/` });
    for (let i = 0; i < 120; i++) {
      if (await c.eval('!!window.__rider').catch(() => false)) break;
      await sleep(250);
    }

    await c.eval(`(() => {
      const r = window.__rider;
      r.ui.show('countdown');
      r.game.reset({ mode:'vocab', includeNew:true, gear:2, theme:'coast', vehicle:'bike', palette:'teal' });
      r.game.start();
      return 1;
    })()`);
    await sleep(4300);
    for (let i = 0; i < 80; i++) {
      if (await c.eval('!!window.__rider.game.currentGate')) break;
      await sleep(100);
    }
    // 答对，门从 z=0 掠过
    await c.eval(`(() => {
      const g = window.__rider.game, gate = g.currentGate;
      g.lane = gate.question.answer;
      g.laneLocked = false;
      gate.z = 0.02;
      return 1;
    })()`);

    console.log('屏幕占比（门架几何在视口内覆盖）与门架 z：');
    for (let i = 0; i < 8; i++) {
      const info = await c.eval(`(() => {
        const w = window.__rider.world;
        const g = window.__rider.game;
        const cam = w.camera;
        // 用门架四个角投影到屏幕，算包围盒覆盖率
        const box = new (Object.getPrototypeOf(cam.position).constructor)();
        let minX=9, maxX=-9, minY=9, maxY=-9, vis=0;
        const gate = g.gates.find(x => x.answered);
        if (gate && gate.gateObj && gate.gateObj.group.visible && gate.gateObj.group.parent) {
          gate.gateObj.group.updateMatrixWorld(true);
          const v = new (Object.getPrototypeOf(cam.position).constructor)();
          gate.gateObj.group.traverse(o => {
            if (!o.isMesh || !o.geometry) return;
            if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
            const b = o.geometry.boundingBox;
            for (const xs of [b.min.x, b.max.x]) for (const ys of [b.min.y, b.max.y]) for (const zs of [b.min.z, b.max.z]) {
              v.set(xs, ys, zs).applyMatrix4(o.matrixWorld);
              const zc = v.clone().applyMatrix4(cam.matrixWorldInverse).z;
              if (zc > -0.1) continue;         // 在相机后面
              v.project(cam);
              if (v.x < -1.2 || v.x > 1.2 || v.y < -1.2 || v.y > 1.2) continue;
              vis++;
              minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x);
              minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y);
            }
          });
        }
        const w01 = Math.max(0, Math.min(1, (maxX - minX) / 2));
        const h01 = Math.max(0, Math.min(1, (maxY - minY) / 2));
        return {
          z: gate ? +gate.z.toFixed(1) : null,
          cover: +(w01 * h01 * 100).toFixed(0),
          visibleVerts: vis,
        };
      })()`).catch(e => ({ err: e.message }));

      const r = await c.send('Page.captureScreenshot', { format: 'png' });
      await writeFile(join(OUT, `${String(i).padStart(2, '0')}.png`), Buffer.from(r.data, 'base64'));
      console.log(`  #${i}  z=${info.z}  覆盖率=${info.cover}%  可见顶点=${info.visibleVerts}`);
      await sleep(150);
    }
  } finally {
    chrome.kill('SIGKILL');
  }
}

main().catch(e => { console.error('✘', e.message); process.exit(1); });
