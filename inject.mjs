// Keeps project-filter.js injected into every ChatGPT/Codex renderer window.
// Uses Page.addScriptToEvaluateOnNewDocument so reloads are covered too.
// Exits by itself once the app (and its debug port) is gone.
import { readFileSync } from 'node:fs';

const PORT = process.env.CHATGPT_DEBUG_PORT || 9222;
const SCRIPT = readFileSync(new URL('./project-filter.js', import.meta.url), 'utf8');
const sessions = new Map(); // target id -> WebSocket

function attach(target) {
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  sessions.set(target.id, ws);
  ws.onmessage = (e) => { if (process.env.PF_DEBUG) console.log(target.id.slice(0, 6), e.data.slice(0, 160)); };
  ws.onopen = () => {
    const send = (id, method, params) => ws.send(JSON.stringify({ id, method, params }));
    send(1, 'Page.enable');
    send(2, 'Page.addScriptToEvaluateOnNewDocument', { source: SCRIPT });
    send(3, 'Runtime.evaluate', { expression: SCRIPT });
  };
  ws.onclose = ws.onerror = () => sessions.delete(target.id);
}

let misses = 0;
async function tick() {
  try {
    const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
    misses = 0;
    for (const t of targets) {
      if (t.type === 'page' && t.url.startsWith('app://-/index.html') && !sessions.has(t.id)) attach(t);
    }
  } catch {
    if (++misses >= 5) process.exit(0);
  }
}
setInterval(tick, 1500);
tick();
