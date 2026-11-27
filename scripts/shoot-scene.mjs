// 场景截图（GPU 路径）：抓 3D 画面 + 控制台错误
// 用法：node scripts/shoot-scene.mjs <outDir> [port]
import { spawn } from 'node:child_process';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

const OUT = process.argv[2] || 'screenshots/scene';
const PORT = Number(process.argv[3] || 8899);
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DBG = 9360;
const PROFILE = '/tmp/wr-chrome-scene';
const W = 1600, H = 900;

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function findPage() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${DBG}/json/list`);
      const list = await r.json();
      const page = list.find(t => t.type === 'page' && t.url === 'about:blank')
        || list.find(t => t.type === 'page');
      if (page?.webSocketDebuggerUrl) return page;
    } catch { /* not ready */ }
    await sleep(400);
  }
  throw new Error('CDP 未就绪');
}

class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.waits = new Map(); this.logs = []; }
  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    const c = new CDP(ws);
    ws.onmessage = ev => {
      const msg = JSON.parse(ev.data);
      if (msg.id && c.waits.has(msg.id)) {
        const { res, rej } = c.waits.get(msg.id);
        c.waits.delete(msg.id);
        msg.error ? rej(new Error(msg.error.message)) : res(msg.result);
        return;
      }
      if (msg.method === 'Runtime.consoleAPICalled') {
        const p = msg.params;
        const text = (p.args || []).map(a => a.value ?? a.description ?? '').join(' ');
        c.logs.push(`[${p.type}] ${text}`);
      } else if (msg.method === 'Runtime.exceptionThrown') {
        const d = msg.params.exceptionDetails;
        c.logs.push(`[EXC] ${d.exception?.description || d.text}`);
      } else if (msg.method === 'Log.entryAdded') {
        const e = msg.params.entry;
        c.logs.push(`[${e.level}] ${e.text}`);
      }
    };
    return c;
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((res, rej) => this.waits.set(id, { res, rej }));
  }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', {
      expression: expr, awaitPromise: true, returnByValue: true,
    });
    if (r.exceptionDetails) {
      throw new Error((r.exceptionDetails.exception?.description || 'eval error').slice(0, 400));
    }
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
    '--headless=new',
    `--remote-debugging-port=${DBG}`,
    `--user-data-dir=${PROFILE}`,
    `--window-size=${W},${H}`,
    '--hide-scrollbars',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--use-angle=metal',        // 真实 GPU（headless 也支持 Metal）
    '--enable-gpu',
    '--ignore-gpu-blocklist',
    'about:blank',
  ], { stdio: 'ignore' });

  const page = await findPage();
  const cdp = await CDP.connect(page.webSocketDebuggerUrl);
  await cdp.send('Runtime.enable');
  await cdp.send('Log.enable');
  await cdp.send('Page.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: W, height: H, deviceScaleFactor: 1, mobile: false,
  });

  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/` });

  let ready = false;
  for (let i = 0; i < 60; i++) {
    await sleep(600);
    try {
      const st = await cdp.eval(
        `window.__world ? (window.__world.ready ? 'ready' : 'loading') : 'none'`,
      );
      if (st === 'ready') { ready = true; break; }
    } catch { /* 页面未就绪 */ }
  }
  console.log('  world ready:', ready);
  if (!ready) {
    console.log('─── 控制台 ───');
    for (const l of [...new Set(cdp.logs)].slice(0, 30)) console.log(l);
    chrome.kill();
    process.exit(1);
  }

  await sleep(1800);
  console.log('  boot:', await cdp.eval(
    `document.getElementById('boot-hint')?.textContent`));

  await cdp.shot(join(OUT, '01-首帧.png'));

  for (const w of ['day', 'night', 'rain', 'snow']) {
    try {
      await cdp.eval(`(async () => { await window.__world.setWeather('${w}'); return 1; })()`);
      await sleep(2200);
      await cdp.shot(join(OUT, `02-天气-${w}.png`));
    } catch (e) {
      console.log('  ! weather', w, e.message);
    }
  }

  // 开局
  try {
    await cdp.eval(`(async () => { await window.__world.setWeather('day'); return 1; })()`);
    await sleep(1200);
    const clicked = await cdp.eval(`(() => {
      const btn = document.querySelector('#btn-start, .btn-start, button.primary, [data-act="start"]');
      if (btn) { btn.click(); return btn.outerHTML.slice(0, 80); }
      const all = [...document.querySelectorAll('button')].map(b => b.id || b.className || b.textContent.trim().slice(0,10));
      return 'no-button:' + all.join('|');
    })()`);
    console.log('  click:', clicked);
    await sleep(5200);
    await cdp.shot(join(OUT, '03-开局.png'));
    await sleep(3000);
    await cdp.shot(join(OUT, '04-骑行中.png'));
  } catch (e) {
    console.log('  ! play:', e.message);
  }

  const info = await cdp.eval(`JSON.stringify({
    frame: window.__rider?.world?.renderer?.info?.render?.frame,
    calls: window.__rider?.world?.renderer?.info?.render?.calls,
    tris: window.__rider?.world?.renderer?.info?.render?.triangles,
    state: window.__rider?.state,
  })`);
  console.log('  renderer:', info);

  console.log('─── 控制台 ───');
  for (const l of [...new Set(cdp.logs)].slice(0, 40)) console.log(l);

  await cdp.send('Browser.close').catch(() => {});
  chrome.kill();
  process.exit(0);
}

main().catch(e => { console.error('✘', e.message); process.exit(1); });
