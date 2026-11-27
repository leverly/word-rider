// 只验结算页：用一个合成的 summary 渲染错题卡，检查拼写题显示完整单词
import { spawn } from 'node:child_process';
import { writeFile, rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const OUT = process.argv[2] || 'design/spell';
const PORT = Number(process.argv[3] || 8901);
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DBG = 9367;
const PROFILE = '/tmp/wr-review';
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

    const text = await c.eval(`(async () => {
      const r = window.__rider;
      const mod = await import('./core/questions.js');
      const mk = (word, chosenOffset) => {
        const item = r.bank.vocab.find(v => v.word === word);
        const q = mod.makeVocabQuestion(item, r.bank.vocab, Math.random, { type: 'spell' });
        return {
          id: q.id, kind: 'vocab', type: 'spell',
          stem: q.stem.text, phonetic: q.stem.phonetic,
          options: q.options.slice(), answer: q.answer,
          chosen: (q.answer + chosenOffset) % 4,
          answerFull: q.answerFull,
          explain: q.explain, speakAfter: q.speakAfter,
        };
      };
      const mistakes = [mk('acknowledge', 1), mk('convey', 2)];
      r.ui.showResult({
        score: 42, grade: 'B', answered: 12, correct: 10, accuracy: 10 / 12,
        maxCombo: 5, gear: 2, starsEarned: 1, mistakes,
        seconds: 180, reviewed: 12, upgraded: 6, totalQueue: 60,
      });
      const rev = document.querySelector('#res-review');
      return JSON.stringify({
        text: rev.textContent.replace(/\\s+/g, ' ').trim(),
        cards: rev.querySelectorAll('.rev-card').length,
      }, null, 1);
    })()`);
    console.log(text);
    await sleep(400);
    await c.shot(join(OUT, 'review-card.png'));
  } finally {
    chrome.kill('SIGKILL');
  }
}

main().catch(e => { console.error('✘', e.message); process.exit(1); });
