// 直接导出 3D 门架牌的 canvas 纹理，检查题干牌/选项牌的绘制结果
// 不依赖 rAF，也不需要完整渲染一帧
import { spawn } from 'node:child_process';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

const OUT = process.argv[2] || 'design/spell';
const PORT = Number(process.argv[3] || 8901);
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DBG = 9363;
const PROFILE = '/tmp/wr-tex';
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
    await c.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/` });
    for (let i = 0; i < 120; i++) {
      if (await c.eval('!!window.__rider').catch(() => false)) break;
      await sleep(250);
    }
    console.log('ready');

    // 造一个门架并配置成拼写题，导出它的题干牌与选项牌纹理
    const shots = await c.eval(`(async () => {
      const r = window.__rider;
      const mod = await import('./core/questions.js');
      const gate = r.world.createGate();
      const cases = [
        { word: 'acknowledge', answerIndex: 0 },
        { word: 'essential',   answerIndex: 2 },
        { word: 'convey',      answerIndex: 1 },
        { word: 'compensate',  answerIndex: 3 },
      ];
      const out = [];
      for (const cs of cases) {
        const item = r.bank.vocab.find(v => v.word === cs.word);
        const q = mod.makeVocabQuestion(item, r.bank.vocab, Math.random, {
          type: 'spell', answerIndex: cs.answerIndex,
        });
        gate.configure(q, true);   // 开星标，顺便验证星标与空格槽不打架
        const stemCanvas = gate.stemMat.map.image;
        const boards = gate.boards.map(b => b.faceMat.map.image.toDataURL('image/png'));
        out.push({
          word: cs.word,
          stem: q.stem.text,
          sub: q.stem.sub,
          opts: q.options,
          ans: q.answer,
          stemPng: stemCanvas.toDataURL('image/png'),
          boardPngs: boards,
        });
      }
      gate.dispose();
      return out;
    })()`);

    for (const s of shots) {
      const stem = s.stemPng.split(',')[1];
      await writeFile(join(OUT, `tex-stem-${s.word}.png`), Buffer.from(stem, 'base64'));
      for (let i = 0; i < s.boardPngs.length; i++) {
        const b = s.boardPngs[i].split(',')[1];
        await writeFile(join(OUT, `tex-board-${s.word}-${i + 1}.png`), Buffer.from(b, 'base64'));
      }
      console.log(' ', s.word, '|', s.stem, '|', s.sub, '|', s.opts.join(' '), '| ans', s.ans);
    }
    console.log('✔ 纹理已导出');
  } finally {
    chrome.kill('SIGKILL');
  }
}

main().catch(e => { console.error('✘', e.message); process.exit(1); });
