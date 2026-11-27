// 集成检查：把题库里每个词都出一遍 spell 题，跑真实判分流程
// 用法：node scripts/test-spell.mjs [port]
import { spawn } from 'node:child_process';
import { rm } from 'node:fs/promises';

const PORT = Number(process.argv[2] || 8901);
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DBG = 9365;
const PROFILE = '/tmp/wr-test-spell';
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
    await c.send('Runtime.enable');
    await c.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/` });
    for (let i = 0; i < 120; i++) {
      if (await c.eval('!!window.__rider').catch(() => false)) break;
      await sleep(250);
    }
    console.log('ready');

    // 捕获页面内的 JS 错误
    await c.eval(`window.__errs = []; addEventListener('error', e => window.__errs.push(String(e.message))); true`);

    const report = await c.eval(`(async () => {
      const r = window.__rider;
      const mod = await import('./core/questions.js');
      const issues = [];
      let n = 0, pairs = 0;

      for (const item of r.bank.vocab) {
        for (let k = 0; k < 12; k++) {
          const q = mod.makeVocabQuestion(item, r.bank.vocab, Math.random, {
            type: 'spell', answerIndex: k % 4,
          });
          n++;
          const { pre, len, post } = q.stem.blank;
          const correct = q.options[q.answer];
          const expect = item.word.slice(pre.length, pre.length + len);

          if (len === 2) pairs++;
          if (correct !== expect) issues.push(['hole', item.word, correct, expect]);
          if (q.stem.text !== pre + '_'.repeat(len) + post) issues.push(['text', item.word, q.stem.text]);
          if (new Set(q.options).size !== 4) issues.push(['dup', item.word, q.options]);
          if (q.options.some(o => o.length !== len)) issues.push(['len', item.word, q.options]);
          if (q.answer !== k % 4) issues.push(['idx', item.word, q.answer, k % 4]);
          if (!pre || !post) issues.push(['edge', item.word, q.stem.text]);
          if (q.stem.sub !== item.meaning) issues.push(['sub', item.word]);
          if (q.answerFull !== item.word) issues.push(['full', item.word]);
          if (q.speakBefore !== item.word) issues.push(['speak', item.word]);
          if (!q.explain || !q.explain.includes(item.word)) issues.push(['explain', item.word]);
        }
      }

      // 真跑一次判分：造门架 → 答题 → 看 mistakes 与结算卡
      const g = r.game;
      g.reset({ mode: 'vocab', includeNew: true, gear: 2 });
      r.ui.show('hud');
      g.start();
      g.countdown = 0.001;
      g.update(1 / 60);          // 进 RIDING，生成首门

      const gate = g.gates[0];
      const item = r.bank.vocab.find(v => v.word === 'acknowledge');
      const q = mod.makeVocabQuestion(item, r.bank.vocab, Math.random, { type: 'spell' });
      gate.question = q;
      gate.gateObj.configure(q, false);
      gate.z = 0.02;
      g.lane = q.answer;          // 答对
      const before = g.score;
      g.resolveGate(gate);
      const afterCorrect = g.score;
      if (afterCorrect !== before + 5) issues.push(['score', before, afterCorrect]);

      // 再答错一道，检查 mistakes 里存了完整单词
      const gate2 = g.gates.find(x => !x.answered) || null;
      let wrongOk = 'no-gate';
      if (gate2) {
        const q2 = mod.makeVocabQuestion(r.bank.vocab[0], r.bank.vocab, Math.random, { type: 'spell' });
        gate2.question = q2;
        gate2.gateObj.configure(q2, false);
        gate2.z = 0.02;
        g.lane = (q2.answer + 1) % 4;
        g.resolveGate(gate2);
        const m = g.mistakes[g.mistakes.length - 1];
        wrongOk = m && m.answerFull === r.bank.vocab[0].word ? 'ok' : JSON.stringify(m);
        if (wrongOk !== 'ok') issues.push(['mistake', wrongOk]);
      }

      // 结算页渲染
      const dbg = { mistakes: g.mistakes.length, state: g.state, shield: g.shield };
      g.finish();
      const rev = document.querySelector('#res-review')?.textContent || '';
      const hasFull = rev.includes('acknowledge') || rev.includes(r.bank.vocab[0].word);
      if (!hasFull) issues.push(['review-card', rev.slice(0, 200)]);

      return JSON.stringify({
        generated: n, twoLetter: pairs, issues: issues.slice(0, 20),
        issueCount: issues.length, reviewSnippet: rev.slice(0, 120), dbg,
        pageErrors: window.__errs,
      }, null, 1);
    })()`);

    console.log(report);
  } finally {
    chrome.kill('SIGKILL');
  }
}

main().catch(e => { console.error('✘', e.message); process.exit(1); });
