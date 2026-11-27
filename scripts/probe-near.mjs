// 拍「门架逼近镜头」的对照帧：冻结时间，手动摆 z，逐张截图
// 用法：node scripts/probe-near.mjs [port]
import { spawn } from 'node:child_process';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

const PORT = Number(process.argv[2] || 8901);
const OUT = 'screenshots/near';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DBG = 9336;
const PROFILE = '/tmp/wr-near-profile';
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
      r.game.reset({ includeNew:true, gear:2, theme:'coast', vehicle:'bike', palette:'teal' });
      r.game.start();
      return 1;
    })()`);
    await sleep(4300);
    for (let i = 0; i < 80; i++) {
      if (await c.eval('!!window.__rider.game.currentGate')) break;
      await sleep(100);
    }

    // 冻结：state=paused 让门不动；只保留渲染
    await c.eval(`(() => {
      const g = window.__rider.game;
      g.state = 'paused';
      window.__gate = g.currentGate;
      window.__frozen = true;
      return !!window.__gate;
    })()`);

    // 依次把门摆到不同 z：0 是刚过门，越大越贴脸
    for (const z of [-30, -12, -6, -2, 0, 3, 6, 9, 12]) {
      await c.eval(`(() => {
        const g = window.__gate;
        if (!g) return 0;
        g.z = ${z};
        g.gateObj.group.position.z = ${z};
        g.gateObj.group.visible = true;
        return 1;
      })()`);
      await sleep(140);
      const r = await c.send('Page.captureScreenshot', { format: 'png' });
      const name = `z${z >= 0 ? 'p' : 'n'}${String(Math.abs(z)).padStart(2, '0')}.png`;
      await writeFile(join(OUT, name), Buffer.from(r.data, 'base64'));
      console.log('  📸', name);
    }
  } finally {
    chrome.kill('SIGKILL');
  }
}

main().catch(e => { console.error('✘', e.message); process.exit(1); });
