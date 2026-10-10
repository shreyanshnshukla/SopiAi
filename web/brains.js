// Sopi web demo — the two "brains".
//  * Gemini: real LLM function calling via the Gemini REST API, using the visitor's own key.
//  * Offline demo: a rule-based brain (like the desktop app's mock mode) that needs no key.
import { functionDeclarations, state } from './tools.js';

const API = 'https://generativelanguage.googleapis.com/v1beta';

export function systemInstruction() {
  return [
    "You are Sopi, a helpful personal voice assistant. In this web demo you control a sandboxed virtual desktop inside the user's browser",
    '(apps: notepad, terminal, files, browser; folders: ~/Documents and ~/Desktop).',
    'Keep replies brief and conversational because they are read aloud. Avoid markdown, lists and code blocks.',
    'Use your tools whenever the user asks you to do something; safety gating is handled automatically by the app.',
    'When the user shares personal details or preferences, save them with the remember tool.',
    `Long-term memories: ${JSON.stringify(state.memories)}`,
  ].join('\n');
}

// Pick the newest available "flash" model, like detect_model() in backend/brain.py
export async function detectGeminiModel(apiKey) {
  const res = await fetch(`${API}/models?pageSize=200`, { headers: { 'x-goog-api-key': apiKey } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error?.message || `Gemini API error ${res.status}`);
  const names = (data.models || [])
    .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
    .map((m) => m.name.replace('models/', ''));
  const version = (n) => parseFloat((n.match(/^gemini-(\d+(?:\.\d+)?)/) || [])[1] || '0');
  const stable = names.filter((n) => /^gemini-\d+(\.\d+)?-flash$/.test(n)).sort((a, b) => version(b) - version(a));
  return stable[0] || names.find((n) => n.includes('flash')) || names[0] || 'gemini-2.5-flash';
}

// One user turn with the Gemini tool-calling loop.
// `history` is the running `contents` array (mutated in place).
export async function geminiRespond(text, { apiKey, model, history, exec, onStatus }) {
  history.push({ role: 'user', parts: [{ text }] });
  for (let step = 0; step < 6; step++) {
    onStatus?.('thinking');
    const res = await fetch(`${API}/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemInstruction() }] },
        contents: history,
        tools: [{ functionDeclarations }],
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error?.message || `Gemini API error ${res.status}`);

    const content = data.candidates?.[0]?.content;
    if (!content?.parts?.length) {
      const reason = data.candidates?.[0]?.finishReason || data.promptFeedback?.blockReason || 'empty response';
      return `Sorry, I couldn't answer that (${reason}).`;
    }
    history.push(content);

    const calls = content.parts.filter((p) => p.functionCall);
    if (calls.length === 0) {
      return content.parts.map((p) => p.text || '').join('').trim();
    }

    const responses = [];
    for (const { functionCall } of calls) {
      const result = await exec(functionCall.name, functionCall.args || {});
      responses.push({ functionResponse: { name: functionCall.name, response: result } });
    }
    history.push({ role: 'user', parts: responses });
  }
  return 'I stopped after several tool steps. Tell me how you would like to continue.';
}

// ---------- offline rule-based brain ----------
const fail = (r) => (/denied permission/.test(r.error) ? "Okay, I won't do that." : r.error);
const clean = (s) => s.replace(/[.?!]+$/, '').trim();
function fileName(raw) {
  const n = clean(raw).replace(/^(a |the )/i, '').replace(/["']/g, '').trim().replace(/\s+/g, '-');
  return /\.[a-z0-9]+$/i.test(n) ? n : `${n}.txt`;
}

export async function offlineRespond(input, { exec }) {
  const text = input.trim();
  const t = text.toLowerCase();
  let m;

  if (/^(hi|hello|hey)\b/.test(t)) {
    const name = state.memories.user_name && state.memories.user_name !== 'User' ? `, ${state.memories.user_name}` : '';
    return `Hello${name}! I'm Sopi, running in offline demo mode. Try asking me to open notepad, search for something, or create a note.`;
  }
  if (/who are you|your name|what can you do|^help/.test(t)) {
    return "I'm Sopi, a voice assistant that uses tools to get things done. In this demo I control a sandboxed virtual desktop: I can open apps, type, run safe commands, manage files and search Wikipedia. Add a Gemini key in settings to give me a real AI brain.";
  }
  if ((m = t.match(/(?:my name is|call me)\s+(.+)/))) {
    const name = clean(text.slice(text.toLowerCase().indexOf(m[1]))).replace(/^\w/, (c) => c.toUpperCase());
    const r = await exec('remember', { key: 'user_name', value: name });
    return r.error ? fail(r) : `Nice to meet you, ${name}. I'll remember that.`;
  }
  if (/\b(time|date|day is it)\b/.test(t)) {
    return `It's ${new Date().toLocaleString([], { weekday: 'long', hour: 'numeric', minute: '2-digit', month: 'long', day: 'numeric' })}.`;
  }
  if ((m = text.match(/^(?:type|write)\s+(.+?)(?:\s+in(?:to)? notepad)?$/i))) {
    const r = await exec('type_text', { text: clean(m[1]).replace(/^["']|["']$/g, '') });
    return r.error ? fail(r) : 'Done, I typed that into Notepad.';
  }
  if ((m = t.match(/^(?:open|launch|start)\s+(?:the\s+)?(.+)$/))) {
    const r = await exec('open_app', { app_name: clean(m[1]) });
    return r.error ? fail(r) : `Opened ${r.opened}.`;
  }
  if ((m = text.match(/^run\s+(.+)$/i))) {
    const r = await exec('run_command', { command: clean(m[1]).replace(/^["'`]|["'`]$/g, '') });
    return r.error ? fail(r) : 'Command finished. The output is in the terminal.';
  }
  if ((m = text.match(/^(?:create|make|new)\s+(?:a\s+)?(?:note|file)\s+(?:called|named)\s+(.+?)(?:\s+(?:with|saying|that says|containing)\s+(.+))?$/i))) {
    const r = await exec('create_file', { filepath: `~/Documents/${fileName(m[1])}`, content: m[2] ? clean(m[2]) : '' });
    return r.error ? fail(r) : `Created ${r.created}.`;
  }
  if ((m = text.match(/^(?:read|show|open file)\s+(?:the\s+)?(?:file\s+)?(.+)$/i)) && /\.|\//.test(m[1])) {
    const r = await exec('read_file', { filepath: clean(m[1]) });
    return r.error ? fail(r) : `Here's ${r.filepath}: ${r.content.slice(0, 160)}${r.content.length > 160 ? '…' : ''}`;
  }
  if ((m = text.match(/^delete\s+(?:the\s+)?(?:file\s+)?(.+)$/i))) {
    const r = await exec('delete_file', { filepath: clean(m[1]) });
    return r.error ? fail(r) : `Deleted ${r.deleted}.`;
  }
  if (/\b(list|show)\b.*\b(files|documents|desktop)\b/.test(t)) {
    const r = await exec('list_directory', { path: t.includes('desktop') ? '~/Desktop' : '~/Documents' });
    return r.error ? fail(r) : `${r.path} has ${r.entries.length} item(s): ${r.entries.join(', ') || 'nothing yet'}.`;
  }
  if ((m = text.match(/^(?:search(?: the web| wikipedia)?(?: for)?|look up|google|what is|what are|who is|who was|tell me about)\s+(.+)$/i))) {
    const q = clean(m[1]);
    const r = await exec('web_search', { query: q });
    if (r.error) return fail(r);
    if (!r.results.length) return `I couldn't find anything for ${q}.`;
    const a = await exec('fetch_page', { url: r.results[0].title });
    if (a.error || !a.extract) return `Top result: ${r.results[0].title}.`;
    return a.extract.split(/(?<=\.)\s/).slice(0, 2).join(' ');
  }
  return "In offline demo mode I understand commands like: open notepad, type hello world, search for Alan Turing, create a note called groceries with milk and eggs, list my documents, run whoami. Add a free Gemini API key in settings and I can handle anything you say.";
}
