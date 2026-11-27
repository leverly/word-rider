// 只截 HUD 答题条：把一道拼写题塞进 HUD，检查题干空格槽与选项排版
import { spawn } from 'node:child_process';
import { writeFile, rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const OUT = process.argv[2] || 'design/spell';
const PORT = Number(process.argv[3] || 8901);
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DBG = 9369;
const PROFILE = '/tmp/wr-hud';
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
    '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', 'about:blank',
  ], { stdio: 'ignore' });
  try {
    const t = await cdpTarget();
    const c = await CDP.connect(t.webSocketDebuggerUrl);
    await c.send('Page.enable');
    await c.send('Runtime.enable');
    await c.send('Emulation.setDeviceMetricsOverride', {
      width: 1400, height: 880, deviceScaleFactor: 1, mobile: false,
    });
    await c.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/` });
    for (let i = 0; i < 120; i++) {
      if (await c.eval('!!window.__rider').catch(() => false)) break;
      await sleep(250);
    }
    console.log('ready');

    const words = ['acknowledge', 'essential', 'convey'];
    for (let i = 0; i < words.length; i++) {
      const info = await c.eval(`(async () => {
        const r = window.__rider;
        const mod = await import('./core/questions.js');
        const item = r.bank.vocab.find(v => v.word === '${words[i]}');
        const q = mod.makeVocabQuestion(item, r.bank.vocab, Math.random, {
          type: 'spell', answerIndex: ${i},
        });
        r.ui.show('hud');
        const fakeGate = { question: q, star: ${i === 0}, z: -60, gap: 100, retry: null };
        r.ui.updateHud({
          score: 25, combo: 3, remaining: 132, timeText: '02:12', gear: 2,
          gearName: '巡航', gearMax: 4, lane: ${i}, speed: 15,
          active: { double: 0, boost: 0, slowmo: 0 }, shield: false, slots: [],
          speedRatio: 0.3, rush: false, progress: 0.27, locked: false,
        }, fakeGate);
        // 让渲染稳定
        await new Promise(res => requestAnimationFrame(() => requestAnimationFrame(res)));
        const main = document.querySelector('#hud-q-main');
        return JSON.stringify({
          stem: q.stem.text, sub: q.stem.sub,
          mainHtml: main.innerHTML,
          opts: [...document.querySelectorAll('#hud-opts .opt')].map(o => ({
            t: o.querySelector('.t').textContent, letters: o.classList.contains('letters'),
          })),
        });
      })()`);
      console.log(' ', info);
      await c.shot(join(OUT, `hud-spell-${i + 1}-${words[i]}.png`));
    }
  } finally {
    chrome.kill('SIGKILL');
  }
}

main().catch(e => { console.error('✘', e.message); process.exit(1); });
