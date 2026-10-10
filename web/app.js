// Sopi web demo — UI, voice, permission gating and the agent loop.
import { TOOLS, TOOL_MAP, state, save, resetState, ALLOW_LIST_DIRECTORIES } from './tools.js';
import { geminiRespond, offlineRespond, detectGeminiModel } from './brains.js';

const $ = (id) => document.getElementById(id);

// ---------- settings (kept in memory; the API key is never persisted) ----------
const settings = { brain: 'offline', apiKey: '', model: '', tts: true };
let geminiHistory = [];
let busy = false;

// ---------- transcript ----------
function addMsg(kind, text, who) {
  const el = document.createElement('div');
  el.className = `msg ${kind}`;
  const label = who || { user: 'YOU', sopi: 'SOPI', system: 'SYSTEM', tool: 'TOOL' }[kind.split(' ')[0]];
  el.innerHTML = `<div class="who"></div><div class="body"></div>`;
  el.querySelector('.who').textContent = label;
  el.querySelector('.body').textContent = text;
  $('transcript').appendChild(el);
  $('transcript').scrollTop = $('transcript').scrollHeight;
  return el;
}

// ---------- status + sphere ----------
let sphereState = 'idle';
const STATUS = {
  idle: ['STANDBY', 'Click the sphere or hold Space to talk'],
  listening: ['LISTENING', 'Speak now…'],
  thinking: ['THINKING', 'Planning and calling tools…'],
  speaking: ['SPEAKING', ''],
  waiting: ['AWAITING PERMISSION', 'Approve or deny the requested action'],
};
function setStatus(s, desc) {
  sphereState = s === 'waiting' ? 'thinking' : s;
  $('status-title').textContent = STATUS[s][0];
  $('status-desc').textContent = desc ?? STATUS[s][1];
}

// Fibonacci dotted sphere (same renderer as the desktop frontend)
const points = [];
const N = 420;
for (let i = 0; i < N; i++) {
  const y = 1 - (i / (N - 1)) * 2;
  const r = Math.sqrt(1 - y * y);
  const th = i * Math.PI * (3 - Math.sqrt(5));
  points.push({ x: Math.cos(th) * r, y, z: Math.sin(th) * r });
}
let angleX = 0, angleY = 0, t = 0, wave = 0.02;
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
function drawSphere() {
  const c = $('sopi-canvas');
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, c.width, c.height);
  const target = { idle: 0.02, listening: 0.16, thinking: 0.05, speaking: 0.22 }[sphereState] ?? 0.02;
  const speed = { idle: 1, listening: 1.5, thinking: 4, speaking: 1.8 }[sphereState] ?? 1;
  wave += (target - wave) * 0.05;
  if (!reduceMotion) { t += 0.012; angleY += 0.0012 * speed; angleX += 0.0004 * speed; }
  const proj = points.map((p) => {
    let w;
    if (sphereState === 'listening') w = Math.sin(p.y * 6 + t * 5) * Math.cos(p.x * 6 + t * 4);
    else if (sphereState === 'thinking') w = Math.sin(t * 12) * Math.cos(p.z * 7 + t * 10) * 0.4;
    else if (sphereState === 'speaking') w = Math.sin(p.y * 8 + t * 7) * Math.cos(p.x * 8 + t * 6);
    else w = Math.sin(p.y * 3.5 + t * 1.5) * 0.18;
    const r = 1 + w * wave;
    const x = p.x * r, y = p.y * r, z = p.z * r;
    const x1 = x * Math.cos(angleY) - z * Math.sin(angleY);
    const z1 = x * Math.sin(angleY) + z * Math.cos(angleY);
    const y2 = y * Math.cos(angleX) - z1 * Math.sin(angleX);
    const z2 = y * Math.sin(angleX) + z1 * Math.cos(angleX);
    return { x1, y2, z2 };
  }).sort((a, b) => a.z2 - b.z2);
  for (const p of proj) {
    const s = 330 / (3.6 + p.z2);
    const d = (p.z2 + 1.3) / 2.6;
    ctx.fillStyle = `rgba(255,255,255,${Math.max(0.08, Math.min(1, d * 0.85 + 0.15))})`;
    ctx.beginPath();
    ctx.arc(c.width / 2 + p.x1 * s, c.height / 2 + p.y2 * s, Math.max(0.6, Math.min(2.5, d * 1.8 + 0.5)), 0, Math.PI * 2);
    ctx.fill();
  }
  requestAnimationFrame(drawSphere);
}

// ---------- virtual desktop UI (passed to tools) ----------
let currentFile = null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ui = {
  openApp(app) {
    document.querySelectorAll('.window').forEach((w) => w.classList.toggle('active', w.dataset.app === app));
    document.querySelectorAll('.app-tabs button').forEach((b) => b.classList.toggle('active', b.dataset.app === app));
    if (app === 'files') renderFiles();
  },
  async typeText(text) {
    const ta = $('notepad-text');
    if (ta.value && !ta.value.endsWith('\n')) ta.value += '\n';
    const step = Math.max(1, Math.ceil(text.length / 120));
    for (let i = 0; i < text.length; i += step) {
      ta.value += text.slice(i, i + step);
      ta.scrollTop = ta.scrollHeight;
      await sleep(reduceMotion ? 0 : 18);
    }
    if (currentFile) { state.files[currentFile] = ta.value; save(); }
  },
  terminal(cmd, out, isErr) {
    const pre = $('terminal-out');
    const c = document.createElement('div'); c.className = 'cmd'; c.textContent = `\n$ ${cmd}`;
    const o = document.createElement('div'); o.className = isErr ? 'err' : ''; o.textContent = out;
    pre.append(c, o);
    pre.scrollTop = pre.scrollHeight;
  },
  showSearch(query, results) {
    ui.openApp('browser');
    $('browser-title').textContent = `Search: ${query}`;
    const body = $('browser-body');
    body.replaceChildren();
    if (!results.length) body.innerHTML = '<p class="muted">No results.</p>';
    for (const r of results) {
      const d = document.createElement('div'); d.className = 'result';
      const a = document.createElement('a'); a.href = r.url; a.target = '_blank'; a.rel = 'noreferrer'; a.textContent = r.title;
      const p = document.createElement('p'); p.textContent = r.snippet;
      d.append(a, p); body.append(d);
    }
  },
  showArticle(article) {
    ui.openApp('browser');
    $('browser-title').textContent = article.title;
    const d = document.createElement('div'); d.className = 'article';
    const h = document.createElement('h4'); h.textContent = article.title;
    const p = document.createElement('p'); p.textContent = article.extract;
    d.append(h, p);
    if (article.url) { const a = document.createElement('a'); a.href = article.url; a.target = '_blank'; a.rel = 'noreferrer'; a.textContent = 'Open on Wikipedia ↗'; d.append(a); }
    $('browser-body').prepend(d);
  },
  showLink(url) {
    ui.openApp('browser');
    $('browser-title').textContent = url;
    const body = $('browser-body');
    body.replaceChildren();
    const p = document.createElement('p'); p.className = 'muted'; p.textContent = 'For safety, the demo does not load external sites inside the page.';
    const a = document.createElement('a'); a.href = /^https?:\/\//.test(url) ? url : `https://${url}`; a.target = '_blank'; a.rel = 'noreferrer'; a.textContent = `Open ${url} in a new tab ↗`;
    body.append(a, p);
  },
  showFile(path) {
    currentFile = path;
    $('notepad-title').textContent = `${path} — Notepad`;
    $('notepad-text').value = state.files[path] ?? '';
    ui.openApp('notepad');
  },
  refreshMemories() { renderMemory(); },
  log() {},
};

function renderFiles() {
  const tree = $('file-tree');
  tree.replaceChildren();
  for (const dir of ALLOW_LIST_DIRECTORIES) {
    const h = document.createElement('div'); h.className = 'dir'; h.textContent = `${dir}/`;
    tree.append(h);
    const files = Object.keys(state.files).filter((f) => f.startsWith(dir + '/')).sort();
    if (!files.length) { const e = document.createElement('div'); e.className = 'muted'; e.textContent = '  (empty)'; tree.append(e); }
    for (const f of files) {
      const b = document.createElement('button');
      b.innerHTML = '<i class="fa-regular fa-file-lines"></i> <span></span>';
      b.querySelector('span').textContent = f.slice(dir.length + 1);
      b.onclick = () => ui.showFile(f);
      tree.append(b);
    }
  }
}
function renderMemory() {
  const name = state.memories.user_name;
  $('diag-memory').textContent = `${Object.keys(state.memories).length} item(s)${name && name !== 'User' ? ` · ${name}` : ''}`;
  $('preapproved').textContent = state.preApproved.length ? state.preApproved.join(', ') : 'None';
}

// ---------- permission gate (Allow once / Deny / Always approve) ----------
function requestPermission(name, args) {
  if (state.preApproved.includes(name)) return Promise.resolve('allow');
  setStatus('waiting');
  $('gate-payload').textContent = `${name}(${JSON.stringify(args, null, 2)})`;
  $('gate').classList.add('show');
  $('gate-allow').focus();
  return new Promise((resolve) => {
    const done = (decision) => {
      $('gate').classList.remove('show');
      ['gate-allow', 'gate-deny', 'gate-always'].forEach((id) => { $(id).onclick = null; });
      setStatus('thinking');
      resolve(decision);
    };
    $('gate-allow').onclick = () => done('allow');
    $('gate-deny').onclick = () => done('deny');
    $('gate-always').onclick = () => {
      state.preApproved.push(name); save(); renderMemory();
      done('allow');
    };
  });
}

// Every tool call goes through here: gate -> run -> log. Returns a JSON-able result.
async function exec(name, args) {
  const tool = TOOL_MAP[name];
  const argText = JSON.stringify(args);
  if (!tool) {
    addMsg('tool error', `✗ ${name} — unknown tool`);
    return { error: `Unknown tool ${name}` };
  }
  if (tool.gated) {
    const decision = await requestPermission(name, args);
    if (decision !== 'allow') {
      addMsg('tool denied', `⊘ ${name}${argText} — denied by user`);
      return { error: 'The user denied permission for this action.' };
    }
  }
  try {
    const result = await tool.run(args, ui);
    addMsg('tool ok', `✓ ${name}${argText}`);
    return result;
  } catch (e) {
    addMsg('tool error', `✗ ${name}${argText} — ${e.message}`);
    return { error: e.message };
  }
}

// ---------- voice ----------
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;
let listening = false;
function speak(text) {
  if (!settings.tts || !('speechSynthesis' in window) || !text) { setStatus('idle'); return; }
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text.slice(0, 600));
  const voices = speechSynthesis.getVoices();
  u.voice = voices.find((v) => /en-(US|GB)/.test(v.lang) && /natural|google|andrew|guy/i.test(v.name)) || voices.find((v) => v.lang.startsWith('en')) || null;
  u.onstart = () => setStatus('speaking', text.length > 90 ? text.slice(0, 90) + '…' : text);
  u.onend = u.onerror = () => setStatus('idle');
  speechSynthesis.speak(u);
}
function startListening() {
  if (busy || listening) return;
  if (!SR) { addMsg('system', 'Voice input needs Chrome or Edge (Web Speech API). You can type instead.'); return; }
  speechSynthesis?.cancel();
  recognition = new SR();
  recognition.lang = 'en-US';
  recognition.interimResults = true;
  recognition.onstart = () => { listening = true; setStatus('listening'); $('mic-btn').classList.add('recording'); };
  recognition.onresult = (e) => {
    let fin = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      if (e.results[i].isFinal) fin += e.results[i][0].transcript;
      else $('status-desc').textContent = `"${e.results[i][0].transcript}…"`;
    }
    if (fin.trim()) handleInput(fin.trim());
  };
  recognition.onerror = (e) => { if (e.error !== 'no-speech' && e.error !== 'aborted') addMsg('system', `Microphone error: ${e.error}`); };
  recognition.onend = () => { listening = false; $('mic-btn').classList.remove('recording'); if (!busy) setStatus('idle'); };
  recognition.start();
}
function stopListening() { recognition?.stop(); }

// ---------- agent turn ----------
async function handleInput(text) {
  if (busy || !text) return;
  busy = true;
  addMsg('user', text);
  setStatus('thinking');
  let reply;
  try {
    if (settings.brain === 'gemini' && settings.apiKey) {
      reply = await geminiRespond(text, { apiKey: settings.apiKey, model: settings.model, history: geminiHistory, exec, onStatus: setStatus });
    } else {
      reply = await offlineRespond(text, { exec });
    }
  } catch (e) {
    reply = `Something went wrong: ${e.message}`;
    if (settings.brain === 'gemini') geminiHistory = [];
  }
  addMsg('sopi', reply || '(no reply)');
  busy = false;
  speak(reply);
}

// ---------- settings drawer ----------
function setBrainUI() {
  const live = settings.brain === 'gemini' && settings.apiKey && settings.model;
  $('brain-pill').classList.toggle('live', !!live);
  $('brain-pill-text').textContent = live ? `GEMINI · ${settings.model}`.toUpperCase() : 'OFFLINE DEMO BRAIN';
  $('diag-brain').textContent = live ? settings.model.toUpperCase() : 'OFFLINE DEMO';
  $('gemini-fields').style.display = settings.brain === 'gemini' ? 'flex' : 'none';
}
async function connectGemini() {
  const key = $('api-key').value.trim();
  if (!key) { $('gemini-status').textContent = 'Paste your API key first.'; return; }
  $('gemini-status').textContent = 'Connecting…';
  try {
    const model = await detectGeminiModel(key);
    Object.assign(settings, { apiKey: key, model, brain: 'gemini' });
    geminiHistory = [];
    $('gemini-status').textContent = `Connected. Using ${model} with ${TOOLS.length} tools.`;
    addMsg('system', `Gemini brain connected (${model}). Ask me anything — I'll use tools when needed.`);
  } catch (e) {
    settings.apiKey = '';
    $('gemini-status').textContent = `Could not connect: ${e.message}`;
  }
  setBrainUI();
}

// ---------- wire up ----------
const CHIPS = [
  'Open notepad',
  'Type hello from Sopi',
  'Search for Alan Turing',
  'Create a note called groceries with milk and eggs',
  'List my documents',
  'Run whoami',
  'Open regedit',
  'Read C:/Windows/system.ini',
];
function init() {
  $('diag-tools').textContent = String(TOOLS.length);
  for (const c of CHIPS) {
    const b = document.createElement('button');
    b.className = 'chip'; b.type = 'button'; b.textContent = c;
    b.onclick = () => handleInput(c);
    $('chips').append(b);
  }
  document.querySelectorAll('.app-tabs button').forEach((b) => { b.onclick = () => ui.openApp(b.dataset.app); });
  $('notepad-text').addEventListener('input', () => { if (currentFile) { state.files[currentFile] = $('notepad-text').value; save(); } });

  $('input-form').onsubmit = (e) => { e.preventDefault(); const v = $('text-input').value.trim(); $('text-input').value = ''; handleInput(v); };
  $('mic-btn').onclick = () => (listening ? stopListening() : startListening());
  $('sphere-wrap').onclick = () => (listening ? stopListening() : startListening());
  $('sphere-wrap').onkeydown = (e) => { if (e.key === 'Enter') startListening(); };
  const typing = () => ['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName);
  document.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && !typing() && !e.repeat && !$('gate').classList.contains('show')) { e.preventDefault(); startListening(); }
    if (e.key === 'Escape') { $('drawer').classList.remove('open'); }
  });
  document.addEventListener('keyup', (e) => { if (e.code === 'Space' && !typing() && listening) { e.preventDefault(); stopListening(); } });

  const openDrawer = () => { $('drawer').classList.add('open'); $('api-key').focus(); };
  $('settings-btn').onclick = openDrawer;
  $('intro-settings').onclick = () => { document.querySelector('input[name=brain][value=gemini]').checked = true; settings.brain = 'gemini'; setBrainUI(); openDrawer(); };
  $('intro-close').onclick = () => $('intro').remove();
  $('drawer-close').onclick = () => $('drawer').classList.remove('open');
  document.querySelectorAll('input[name=brain]').forEach((r) => { r.onchange = () => { settings.brain = r.value; setBrainUI(); }; });
  $('connect-btn').onclick = connectGemini;
  $('api-key').onkeydown = (e) => { if (e.key === 'Enter') connectGemini(); };
  $('tts-toggle').onchange = (e) => { settings.tts = e.target.checked; if (!settings.tts) speechSynthesis?.cancel(); };
  $('reset-btn').onclick = () => {
    resetState(); currentFile = null; $('notepad-text').value = ''; $('notepad-title').textContent = 'Untitled.txt — Notepad';
    renderFiles(); renderMemory(); addMsg('system', 'Virtual desktop, memory and approvals reset.');
  };
  $('clear-btn').onclick = () => { $('transcript').replaceChildren(); geminiHistory = []; };

  ui.openApp('notepad');
  renderMemory();
  setBrainUI();
  addMsg('system', 'Sopi web demo ready. Try a suggestion, type a command, or hold Space to talk. Gated actions will ask for your permission first.');
  drawSphere();
}
init();
