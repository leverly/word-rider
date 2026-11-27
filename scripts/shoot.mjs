// 无头 Chrome 截图：复现「答完题的一瞬间」，用于视觉评审
// 用法：node scripts/shoot.mjs <outDir> [port]
// 依赖：本机 Chrome；目标站点需已在 port 上运行（默认 8901）
import { spawn } from 'node:child_process';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

const OUT = process.argv[2] || 'screenshots/after';
const PORT = Number(process.argv[3] || 8901);
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DBG = 9333;
const PROFILE = '/tmp/wr-chrome-profile';

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function cdpTargets() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${DBG}/json/list`);
      const list = await r.json();
      const page = list.find(t => t.type === 'page');
      if (page) return page;
    } catch { /* not ready */ }
    await sleep(250);
  }
  throw new Error('CDP 未就绪');
}

class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.waits = new Map(); }
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
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval error');
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
    '--window-size=1400,880',
    '--hide-scrollbars',
    '--no-first-run',
    '--no-default-browser-check',
    '--allow-file-access-from-files',
    '--enable-unsafe-swiftshader',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    'about:blank',
  ], { stdio: 'ignore' });

  try {
    const target = await cdpTargets();
    const c = await CDP.connect(target.webSocketDebuggerUrl);
    await c.send('Page.enable');
    await c.send('Runtime.enable');
    await c.send('Emulation.setDeviceMetricsOverride', {
      width: 1400, height: 880, deviceScaleFactor: 1, mobile: false,
    });

    await c.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/` });

    // 等游戏就绪
    for (let i = 0; i < 120; i++) {
      const ok = await c.eval('!!window.__rider').catch(() => false);
      if (ok) break;
      await sleep(250);
    }
    const ready = await c.eval('!!window.__rider');
    if (!ready) throw new Error('游戏未就绪（题库或 three 载入失败）');
    console.log('✔ 游戏已就绪');

    // 直接开局，跳过首页
    await c.eval(`(() => {
      const r = window.__rider;
      r.ui.show('countdown');
      r.game.reset({ mode: 'mixed', includeNew: true, gear: 2, theme: 'coast', vehicle: 'bike', palette: 'teal' });
      r.game.start();
      return true;
    })()`);
    await sleep(4200);   // 跳过 3.6s 倒计时

    // 等到有当前题目
    for (let i = 0; i < 60; i++) {
      const has = await c.eval('!!(window.__rider.game.currentGate)');
      if (has) break;
      await sleep(100);
    }

    // 场景 1：正常骑行（对照组）
    await c.shot(join(OUT, '01-骑行中.png'));

    /* 强制一次「答错」，捕捉答后瞬间 */
    await c.eval(`(() => {
      const g = window.__rider.game;
      const gate = g.currentGate;
      if (!gate) return 'no-gate';
      // 先选一条错道（保持距离，避免车道锁）
      const wrong = (gate.question.answer + 1) % 4;
      g.lane = wrong;
      g.laneLocked = false;
      // 把门推到判定点，下一帧就会 resolve
      gate.z = 0.02;
      return 'forced-wrong:' + wrong + ' answer=' + gate.question.answer;
    })()`).then(v => console.log('  强制答错 →', v));

    await sleep(90);
    await c.shot(join(OUT, '02-答错瞬间.png'));
    await sleep(300);
    await c.shot(join(OUT, '03-答错+600ms.png'));
    await sleep(700);
    await c.shot(join(OUT, '04-答错+1.3s.png'));

    // 再等一会儿，看下一题是否已可读
    await sleep(1500);
    await c.shot(join(OUT, '05-下一题.png'));

    /* 强制一次「答对」 */
    await c.eval(`(() => {
      const g = window.__rider.game;
      const gate = g.currentGate;
      if (!gate) return 'no-gate';
      g.lane = gate.question.answer;
      g.laneLocked = false;
      gate.z = 0.02;
      return 'forced-right';
    })()`);
    await sleep(90);
    await c.shot(join(OUT, '06-答对瞬间.png'));
    await sleep(400);
    await c.shot(join(OUT, '07-答对+500ms.png'));

    // 记录一下 DOM 里反馈块的位置，量化遮挡
    const overlay = await c.eval(`(() => {
      const fb = document.querySelector('#hud-feedback');
      const box = document.querySelector('#hud-bottom');
      const r = fb.getBoundingClientRect();
      const b = box.getBoundingClientRect();
      return {
        feedback: { top: r.top, bottom: r.bottom, height: r.height, visible: getComputedStyle(fb).opacity },
        answerBar: { top: b.top, bottom: b.bottom },
        viewport: { w: innerWidth, h: innerHeight },
      };
    })()`);
    console.log('  反馈块位置：', JSON.stringify(overlay, null, 2));

    await sleep(400);
  } finally {
    chrome.kill('SIGKILL');
  }
}

main().catch(e => { console.error('✘', e.message); process.exit(1); });
