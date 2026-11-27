// 截取「拼写补全」题型：强制把当前门架换成 spell 题，拍 HUD 与 3D 门架
// 用法：node scripts/shoot-spell.mjs <outDir> [port]
import { spawn } from 'node:child_process';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

const OUT = process.argv[2] || 'screenshots/spell';
const PORT = Number(process.argv[3] || 8901);
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DBG = 9351;
const PROFILE = '/tmp/wr-spell-profile';
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
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-features=CalculateNativeWinOcclusion',
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

    for (let i = 0; i < 120; i++) {
      if (await c.eval('!!window.__rider').catch(() => false)) break;
      await sleep(250);
    }
    console.log('✔ 就绪');

    // 无头 swiftshader 下一帧渲染要 ~2.8s，所以只推逻辑，截图前才渲染
    await c.eval(`window.__tick = (n = 1, dt = 1/60) => {
      const r = window.__rider;
      for (let i = 0; i < n; i++) {
        r.game.update(dt);
        r.world.update(dt, r.game, performance.now() / 1000);
        r.ui.updateHud(r.game.hud, r.game.currentGate);
      }
      return r.game.state;
    };
    window.__render = () => { window.__rider.world.render(); return true; };
    true`);

    // 只出单词题，全压 spell
    await c.eval(`(() => {
      const r = window.__rider;
      r.game.reset({ mode: 'vocab', includeNew: true, gear: 2, theme: 'prairie', vehicle: 'bike', palette: 'teal' });
      r.ui.show('hud');
      r.game.start();
      // 直接把倒计时走完，省去 200+ 帧渲染
      r.game.countdown = 0.001;
      return true;
    })()`);
    await c.eval(`window.__tick(2)`);

    // 等到门架出现
    for (let i = 0; i < 20; i++) {
      if (await c.eval('!!window.__rider.game.currentGate')) break;
      await c.eval(`window.__tick(2)`);
      await sleep(40);
    }
    const has = await c.eval('!!window.__rider.game.currentGate');
    console.log('  当前门架：', has);
    if (!has) throw new Error('没有生成门架');

    const picks = ['acknowledge', 'compensate', 'essential', 'convey', 'arbitrary', 'accurate'];
    for (let i = 0; i < picks.length; i++) {
      const word = picks[i];
      const info = await c.eval(`(async () => {
        const r = window.__rider;
        const g = r.game;
        const item = r.bank.vocab.find(v => v.word === '${word}');
        const mod = await import('./core/questions.js');
        const q = mod.makeVocabQuestion(item, r.bank.vocab, Math.random, { type: 'spell', answerIndex: ${i % 4} });
        const gate = g.currentGate;
        if (!gate) return 'no-gate';
        gate.question = q;
        gate.star = false;
        gate.answered = false;
        gate.gateObj.configure(q, false);
        gate.z = -52;                 // 放在可读距离（远一点，避免路边道具挡住）
        gate.gateObj.group.position.z = gate.z;
        g.lane = ${i % 4};
        g.laneLocked = false;
        g.laneLockAt = 0;
        g.onQuestionActive(gate);
        return JSON.stringify({ stem: q.stem.text, sub: q.stem.sub, opts: q.options, ans: q.answer });
      })()`);
      console.log('  ', info);
      // 驱动几帧让门架前进，然后只渲一次
      await c.eval(`window.__tick(20)`);
      await c.eval(`window.__render()`);
      await c.shot(join(OUT, `spell-${i + 1}-${word}.png`));
    }

    // 答对瞬间：锁定正确道 + 把门推到判定点
    await c.eval(`(() => {
      const g = window.__rider.game;
      const gate = g.currentGate;
      g.lane = gate.question.answer;
      g.laneLocked = false;
      gate.z = 0.02;
      return 'ok';
    })()`);
    await c.eval(`window.__tick(3)`);
    await c.eval(`window.__render()`);
    await sleep(160);
    await c.shot(join(OUT, 'spell-answer-correct.png'));
  } finally {
    chrome.kill('SIGKILL');
  }
}

main().catch(e => { console.error('✘', e.message); process.exit(1); });
