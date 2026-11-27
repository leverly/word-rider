// 探针：逐帧采样「答完题之后」HUD 与反馈卡的状态，输出时间线
// 用法：node scripts/probe-answer.mjs [port]
import { spawn } from 'node:child_process';
import { rm } from 'node:fs/promises';

const PORT = Number(process.argv[2] || 8901);
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DBG = 9334;
const PROFILE = '/tmp/wr-probe-profile';
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
      r.game.reset({ mode:'mixed', includeNew:true, gear:2, theme:'coast', vehicle:'bike', palette:'teal' });
      r.game.start();
      return 1;
    })()`);
    // 无头渲染很慢，dt 被钳在 0.05s/帧，倒计时可能要跑几十秒 —— 直接跳过
    await c.eval(`(() => {
      const g = window.__rider.game;
      g.countdown = 0;
      g.state = 'riding';
      window.__rider.ui.show('hud');
      g.spawnGate();
      return g.state;
    })()`);
    await sleep(400);
    for (let i = 0; i < 100; i++) {
      if (await c.eval('!!window.__rider.game.currentGate')) break;
      await sleep(100);
    }

    // 安装采样器：每 50ms 记一条
    await c.eval(`(() => {
      window.__samples = [];
      const pick = () => {
        const g = window.__rider.game;
        const fb = document.querySelector('#hud-feedback');
        const ask = document.querySelector('#hud-ask');
        const opts = document.querySelector('#hud-opts');
        const optT = [...opts.children].map(o => o.querySelector('.t').textContent);
        const rect = el => { const r = el.getBoundingClientRect(); return { t: Math.round(r.top), b: Math.round(r.bottom), h: Math.round(r.height) }; };
        return {
          ms: Math.round(performance.now()),
          state: g.state,
          hold: g.hudHold ? +g.hudHold.left.toFixed(2) : null,
          hudId: g.hudGate ? g.hudGate.question.id : null,
          cur: g.currentGate ? g.currentGate.question.id : null,
          curAns: g.currentGate ? g.currentGate.answered : null,
          curZ: g.currentGate ? +g.currentGate.z.toFixed(1) : null,
          unanswered: g.gates.filter(x => !x.answered).map(x => +x.z.toFixed(0)),
          fbShow: fb.classList.contains('show'),
          fbRect: fb.classList.contains('show') ? rect(fb) : null,
          fbText: fb.classList.contains('show') ? fb.textContent.trim().slice(0, 40) : '',
          askText: document.querySelector('#hud-q-main').textContent.slice(0, 24),
          askRect: rect(ask),
          optFirst: optT[0] ? optT[0].slice(0, 14) : '',
          optsRect: rect(opts),
          lane: g.lane,
        };
      };
      window.__pick = pick;
      const tick = () => { window.__samples.push(pick()); if (window.__sampling) setTimeout(tick, 50); };
      window.__sampling = true;
      tick();
      return 1;
    })()`);

    // 记录答错前 HUD
    const before = await c.eval('window.__pick()');
    console.log('答前：', JSON.stringify(before));

    // 强制答错
    await c.eval(`(() => {
      const g = window.__rider.game, gate = g.currentGate;
      g.lane = (gate.question.answer + 1) % 4;
      g.laneLocked = false;
      gate.z = 0.02;
      return 1;
    })()`);

    await sleep(2600);
    const samples = await c.eval('(window.__sampling = false, window.__samples)');

    // 打印关键变化点
    let prev = null;
    const fmt = s => `state=${Object.prototype.toString.call(s.state).slice(8,-1)} hold=${s.hold} ` +
      `hud=${s.hudId?.slice(-10)} cur=${s.cur?.slice(-10)} ans=${s.curAns} z=${s.curZ} ` +
      `fb=${s.fbShow ? '●' : '○'}${s.fbRect ? `[${s.fbRect.t}-${s.fbRect.b}]` : ''} ` +
      `ask="${s.askText}" opt1="${s.optFirst}" unanswered=[${s.unanswered}]`;
    console.log('\n── 时间线（只在状态变化时打印）──');
    for (const s of samples) {
      const key = `${s.state}|${s.hold}|${s.hudId}|${s.fbShow}|${s.askText}|${s.optFirst}`;
      if (key !== prev) { console.log(`  +${String(s.ms - samples[0].ms).padStart(5)}ms  ${fmt(s)}`); prev = key; }
    }

    // 量化遮挡：反馈卡与题干卡/选项条是否有交叠
    const overlap = samples.find(s => s.fbShow && s.fbRect);
    if (overlap) {
      const o = overlap;
      const hit = (a, b) => a && b && a.t < b.b && b.t < a.b;
      console.log('\n── 遮挡检查 ──');
      console.log('  反馈卡:', JSON.stringify(o.fbRect));
      console.log('  题干卡:', JSON.stringify(o.askRect), '交叠:', hit(o.fbRect, o.askRect));
      console.log('  选项条:', JSON.stringify(o.optsRect), '交叠:', hit(o.fbRect, o.optsRect));
      console.log('  视口高:', 880);
    }
  } finally {
    chrome.kill('SIGKILL');
  }
}

main().catch(e => { console.error('✘', e.message); process.exit(1); });
