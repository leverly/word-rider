// 拍「答对 / 答错 / 驻留结束 / 手机」关键时刻，单次导航顺序执行
// 用法：node scripts/shoot-answer.mjs [outDir] [port]
import { spawn } from 'node:child_process';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

const OUT = process.argv[2] || 'screenshots/answer';
const PORT = Number(process.argv[3] || 8901);
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DBG = 9338;
const PROFILE = '/tmp/wr-ans2-profile';
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
  async eval(e) {
    const r = await this.send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval');
    return r.result.value;
  }
  async shot(name) {
    const r = await this.send('Page.captureScreenshot', { format: 'png' });
    await writeFile(join(OUT, name), Buffer.from(r.data, 'base64'));
    console.log('  📸', name);
  }
}

const START = `(() => {
  const r = window.__rider;
  // 无头 SwiftShader 跑真 3D 极慢：关掉后处理/阴影/像素比，只保留几何，
  // 才能在可接受时间内出帧（只影响截图速度，不影响真实游戏表现）
  try {
    const w = r.world;
    if (w) {
      w.render = () => w.renderer.render(w.scene, w.camera);
      w.renderer.setPixelRatio(1);
      w.renderer.shadowMap.enabled = false;
      if (w.scene.fog) w.scene.fog.far = 260;
      w.scene.traverse(o => { if (o.isMesh) o.castShadow = false; });
    }
  } catch (e) { /* ignore */ }
  r.ui.show('countdown');
  r.game.reset({ includeNew:true, gear:2, theme:'coast', vehicle:'bike', palette:'teal' });
  r.game.start();
  const g = r.game;
  g.countdown = 0;
  g.state = 'riding';
  r.ui.show('hud');
  g.spawnGate();
  return 1;
})()`;

async function waitGate(c) {
  for (let i = 0; i < 400; i++) {
    if (await c.eval('!!window.__rider.game.currentGate')) return true;
    await sleep(100);
  }
  return false;
}

/** 等「答后驻留」真正建立：说明 resolveGate 已跑完、反馈已渲染 */
async function waitHold(c) {
  for (let i = 0; i < 400; i++) {
    if (await c.eval('!!window.__rider.game.hudHold')) return true;
    await sleep(60);
  }
  return false;
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
    await c.send('Emulation.setDeviceMetricsOverride', { width: 900, height: 600, deviceScaleFactor: 1, mobile: false });
    await c.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/` });
    for (let i = 0; i < 600; i++) {
      if (await c.eval('!!window.__rider').catch(() => false)) break;
      await sleep(250);
    }
    console.log('✔ 就绪');

    // ① 答错全流程
    await c.eval(START);
    await waitGate(c);
    await c.shot('01-答前.png');

    await c.eval(`(() => {
      const g = window.__rider.game, gate = g.currentGate;
      g.lane = (gate.question.answer + 1) % 4;
      g.laneLocked = false;
      gate.z = 0.02;
      return 1;
    })()`);
    await sleep(200);
    await waitHold(c);
    await c.shot('02-答错-反馈.png');
    await sleep(600);
    await c.shot('03-答错-仍在驻留.png');

    for (let i = 0; i < 400; i++) {
      if (await c.eval('!window.__rider.game.hudHold')) break;
      await sleep(100);
    }
    await sleep(250);
    await c.shot('04-驻留结束-下一题.png');

    // ② 答对
    await c.eval(START);
    await waitGate(c);
    await c.eval(`(() => {
      const g = window.__rider.game, gate = g.currentGate;
      g.lane = gate.question.answer;
      g.laneLocked = false;
      gate.z = 0.02;
      return 1;
    })()`);
    await sleep(200);
    await waitHold(c);
    await c.shot('05-答对-反馈.png');

    // ③ 手机竖屏答错
    await c.send('Emulation.setDeviceMetricsOverride', { width: 430, height: 860, deviceScaleFactor: 2, mobile: true });
    await sleep(300);
    await c.eval(START);
    await waitGate(c);
    await c.shot('06-手机-答前.png');
    await c.eval(`(() => {
      const g = window.__rider.game, gate = g.currentGate;
      g.lane = (gate.question.answer + 1) % 4;
      g.laneLocked = false;
      gate.z = 0.02;
      return 1;
    })()`);
    await sleep(200);
    await waitHold(c);
    await c.shot('07-手机-答错.png');

    // 量化最终布局
    const m = await c.eval(`(() => {
      const r = el => { const b = el.getBoundingClientRect(); return { t: Math.round(b.top), b: Math.round(b.bottom), h: Math.round(b.height) }; };
      const fb = document.querySelector('#hud-feedback');
      const ask = document.querySelector('#hud-ask');
      const opts = document.querySelector('#hud-opts');
      const bar = document.querySelector('.hud-bottom');
      const hit = (a,b) => a.t < b.b && b.t < a.b;
      const F = fb.classList.contains('show') ? r(fb) : null;
      const A = r(ask), O = r(opts), B = r(bar);
      return { vp: innerHeight, feedback: F, ask: A, opts: O, bottomBar: B,
        overlap: { fb_ask: F ? hit(F,A) : null, fb_opts: F ? hit(F,O) : null } };
    })()`);
    console.log('\n最终布局:', JSON.stringify(m, null, 2));
  } finally {
    chrome.kill('SIGKILL');
  }
}

main().catch(e => { console.error('✘', e.message); process.exit(1); });
