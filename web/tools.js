// Sopi web demo — tools.
// Mirrors the desktop app's tool set (backend/brain.py) but every tool acts on a
// sandboxed *virtual* desktop inside the page, so it is safe to host publicly.

const STORAGE_KEY = 'sopi-web-demo-v1';

// Same policy as backend/config.py, adapted to the virtual desktop
export const ALLOW_LIST_DIRECTORIES = ['~/Documents', '~/Desktop'];
export const DENY_LIST_APPS = ['cmd.exe', 'cmd', 'powershell', 'powershell.exe', 'regedit', 'regedit.exe', 'control.exe'];
export const APPS = ['notepad', 'terminal', 'files', 'browser'];

const SEED_FILES = {
  '~/Documents/welcome.txt': 'Welcome to the Sopi web demo!\nEverything here lives in a sandboxed virtual file system inside your browser.',
  '~/Documents/todo.txt': '- Finish resume\n- Push VisionCraft update\n- Call the clinic leads',
  '~/Desktop/ideas.md': '# Ideas\n- Voice-controlled study planner\n- Wake word on a Raspberry Pi',
};

// ---------- persistent state (per viewer, best effort) ----------
function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* storage unavailable */ }
  return { files: { ...SEED_FILES }, memories: { user_name: 'User' }, preApproved: [] };
}
export const state = load();
export function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* ignore */ }
}
export function resetState() {
  state.files = { ...SEED_FILES };
  state.memories = { user_name: 'User' };
  state.preApproved = [];
  save();
}

// ---------- path helpers ----------
export function normalizePath(p = '') {
  let s = String(p).trim().replace(/\\/g, '/').replace(/\/+$/, '');
  if (!s) return '~/Documents';
  if (/^(documents|desktop)(\/|$)/i.test(s)) s = '~/' + s;
  s = s.replace(/^~\/documents/i, '~/Documents').replace(/^~\/desktop/i, '~/Desktop');
  if (!s.startsWith('~/') && !/^[a-z]:\//i.test(s) && !s.startsWith('/')) s = '~/Documents/' + s;
  return s;
}
function assertAllowed(path) {
  if (!ALLOW_LIST_DIRECTORIES.some((d) => path === d || path.startsWith(d + '/'))) {
    throw new Error(`Blocked by safety policy: "${path}" is outside the allow-listed folders (${ALLOW_LIST_DIRECTORIES.join(', ')}).`);
  }
}
function listDir(path) {
  const prefix = path + '/';
  const entries = new Set();
  for (const f of Object.keys(state.files)) {
    if (f.startsWith(prefix)) {
      const rest = f.slice(prefix.length);
      entries.add(rest.includes('/') ? rest.split('/')[0] + '/' : rest);
    }
  }
  return [...entries].sort();
}

// ---------- sandboxed shell ----------
function runShell(command, ui) {
  const [cmd, ...rest] = command.trim().split(/\s+/);
  const arg = rest.join(' ');
  switch ((cmd || '').toLowerCase()) {
    case 'help': return 'Sandbox commands: ls, dir, cat, type, echo, date, whoami, pwd, help';
    case 'ls': case 'dir': {
      const p = normalizePath(arg || '~/Documents'); assertAllowed(p);
      return listDir(p).join('\n') || '(empty)';
    }
    case 'cat': case 'type': {
      const p = normalizePath(arg); assertAllowed(p);
      if (!(p in state.files)) throw new Error(`No such file: ${p}`);
      return state.files[p];
    }
    case 'echo': return arg;
    case 'date': return new Date().toString();
    case 'whoami': return `${state.memories.user_name || 'user'}@sopi-sandbox`;
    case 'pwd': return '~/Documents';
    default:
      ui?.log?.(`Command "${cmd}" refused`);
      throw new Error(`"${cmd}" is not permitted in the sandbox. Allowed: ls, dir, cat, type, echo, date, whoami, pwd, help.`);
  }
}

// ---------- Wikipedia (CORS-enabled) for web search ----------
async function wikiSearch(query) {
  const url = `https://en.wikipedia.org/w/api.php?action=query&list=search&format=json&origin=*&srlimit=5&srsearch=${encodeURIComponent(query)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Search failed (${res.status})`);
  const data = await res.json();
  return (data.query?.search || []).map((r) => ({
    title: r.title,
    snippet: r.snippet.replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&amp;/g, '&'),
    url: `https://en.wikipedia.org/wiki/${encodeURIComponent(r.title.replace(/ /g, '_'))}`,
  }));
}
async function wikiSummary(title) {
  const t = String(title).replace(/^https?:\/\/en\.wikipedia\.org\/wiki\//, '');
  const res = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(decodeURIComponent(t).replace(/ /g, '_'))}`);
  if (!res.ok) throw new Error(`Article not found: ${title}`);
  const d = await res.json();
  return { title: d.title, extract: d.extract, url: d.content_urls?.desktop?.page };
}

// ---------- tool registry ----------
// `gated: true` tools need the user's permission (Allow once / Deny / Always approve),
// exactly like backend/utils/gating.py in the desktop app.
const S = (properties, required = []) => ({ type: 'OBJECT', properties, required });
const str = (description) => ({ type: 'STRING', description });

export const TOOLS = [
  {
    name: 'web_search', gated: false,
    description: 'Searches the web (Wikipedia) for real-time information. Returns titles, snippets and URLs.',
    parameters: S({ query: str('The search query.') }, ['query']),
    async run({ query }, ui) {
      const results = await wikiSearch(query);
      ui.showSearch(query, results);
      return { results };
    },
  },
  {
    name: 'fetch_page', gated: false,
    description: 'Gets the summary text of a Wikipedia article, by title or Wikipedia URL.',
    parameters: S({ url: str('Article title or https://en.wikipedia.org/wiki/... URL.') }, ['url']),
    async run({ url }, ui) {
      const article = await wikiSummary(url);
      ui.showArticle(article);
      return article;
    },
  },
  {
    name: 'open_app', gated: true,
    description: `Launches an application on the (virtual) desktop. Installed apps: ${APPS.join(', ')}.`,
    parameters: S({ app_name: str('Application name, e.g. notepad, terminal, files, browser.') }, ['app_name']),
    async run({ app_name }, ui) {
      const name = String(app_name).toLowerCase().replace(/\.exe$/, '').trim();
      if (DENY_LIST_APPS.includes(name) || DENY_LIST_APPS.includes(name + '.exe')) {
        throw new Error(`Blocked by safety policy: "${app_name}" is on the application deny-list.`);
      }
      const app = APPS.find((a) => name.includes(a)) || (name.includes('explorer') ? 'files' : name.includes('chrome') || name.includes('edge') ? 'browser' : null);
      if (!app) throw new Error(`"${app_name}" is not installed on the virtual desktop. Available: ${APPS.join(', ')}.`);
      ui.openApp(app);
      return { opened: app };
    },
  },
  {
    name: 'run_command', gated: true,
    description: 'Runs a shell command in a sandboxed terminal (ls, dir, cat, type, echo, date, whoami, pwd, help).',
    parameters: S({ command: str('The shell command line to run.') }, ['command']),
    async run({ command }, ui) {
      ui.openApp('terminal');
      try {
        const output = runShell(command, ui);
        ui.terminal(command, output);
        return { output };
      } catch (e) {
        ui.terminal(command, e.message, true);
        throw e;
      }
    },
  },
  {
    name: 'browser_open', gated: true,
    description: 'Opens a URL in the virtual browser window.',
    parameters: S({ url: str('The URL to open.') }, ['url']),
    async run({ url }, ui) {
      ui.showLink(url);
      return { opened: url };
    },
  },
  {
    name: 'type_text', gated: true,
    description: 'Types text into the active Notepad window, like a keyboard (pyautogui in the desktop app).',
    parameters: S({ text: str('Text to type.') }, ['text']),
    async run({ text }, ui) {
      ui.openApp('notepad');
      await ui.typeText(String(text));
      return { typed_characters: String(text).length };
    },
  },
  {
    name: 'list_directory', gated: false,
    description: `Lists files in a folder. Allowed folders: ${ALLOW_LIST_DIRECTORIES.join(', ')}.`,
    parameters: S({ path: str('Folder path, e.g. ~/Documents.') }, ['path']),
    async run({ path }, ui) {
      const p = normalizePath(path); assertAllowed(p);
      ui.openApp('files');
      return { path: p, entries: listDir(p) };
    },
  },
  {
    name: 'read_file', gated: false,
    description: 'Reads the text content of a file.',
    parameters: S({ filepath: str('File path, e.g. ~/Documents/todo.txt.') }, ['filepath']),
    async run({ filepath }, ui) {
      const p = normalizePath(filepath); assertAllowed(p);
      if (!(p in state.files)) throw new Error(`No such file: ${p}`);
      ui.showFile(p);
      return { filepath: p, content: state.files[p] };
    },
  },
  {
    name: 'create_file', gated: true,
    description: 'Creates (or overwrites) a text file with optional content.',
    parameters: S({ filepath: str('File path, e.g. ~/Documents/notes.txt.'), content: str('Content to write.') }, ['filepath']),
    async run({ filepath, content = '' }, ui) {
      let p = normalizePath(filepath); assertAllowed(p);
      if (!/\.[a-z0-9]+$/i.test(p)) p += '.txt';
      state.files[p] = String(content); save();
      ui.showFile(p);
      return { created: p, bytes: String(content).length };
    },
  },
  {
    name: 'edit_file', gated: true,
    description: 'Replaces an exact block of text in an existing file.',
    parameters: S({ filepath: str('File path.'), target_content: str('Exact text to replace.'), replacement_content: str('New text.') }, ['filepath', 'target_content', 'replacement_content']),
    async run({ filepath, target_content, replacement_content }, ui) {
      const p = normalizePath(filepath); assertAllowed(p);
      if (!(p in state.files)) throw new Error(`No such file: ${p}`);
      if (!state.files[p].includes(target_content)) throw new Error('Target text not found in file.');
      state.files[p] = state.files[p].replace(target_content, replacement_content); save();
      ui.showFile(p);
      return { edited: p };
    },
  },
  {
    name: 'delete_file', gated: true,
    description: 'Deletes a file.',
    parameters: S({ filepath: str('File path to delete.') }, ['filepath']),
    async run({ filepath }, ui) {
      const p = normalizePath(filepath); assertAllowed(p);
      if (!(p in state.files)) throw new Error(`No such file: ${p}`);
      delete state.files[p]; save();
      ui.openApp('files');
      return { deleted: p };
    },
  },
  {
    name: 'remember', gated: false,
    description: "Saves a long-term memory about the user (e.g. key 'user_name').",
    parameters: S({ key: str('Memory key, e.g. user_name or favorite_color.'), value: str('Value to remember.') }, ['key', 'value']),
    async run({ key, value }, ui) {
      state.memories[key] = value; save();
      ui.refreshMemories();
      return { saved: { [key]: value } };
    },
  },
];

export const TOOL_MAP = Object.fromEntries(TOOLS.map((t) => [t.name, t]));
export const functionDeclarations = TOOLS.map(({ name, description, parameters }) => ({ name, description, parameters }));
