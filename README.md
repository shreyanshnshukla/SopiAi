# Sopi — Voice-Controlled Desktop AI Agent

**Live web demo:** https://shreyanshnshukla.github.io/SopiAi/

Sopi is a personal voice assistant for Windows that you talk to out loud. It plans with an LLM, then **acts through tools**: launching apps, running shell commands, typing, managing files and searching the web. Every risky action is **permission-gated** and sandboxed by folder and app policies.

> The live demo runs in the browser with the same tools, allow-list and permission gating, but acts on a sandboxed **virtual desktop** so it is safe to host publicly. Use it in offline demo mode, or paste your own free Gemini API key for the full LLM brain. The key stays in your browser tab.

## Features

- **Voice in, voice out:** wake word ("Sopi"), push-to-talk (Spacebar) and natural neural TTS via Microsoft Edge voices.
- **LLM tool calling:** the model chooses from 12 tools: `web_search`, `fetch_page`, `open_app`, `run_command`, `browser_open`, `pyautogui_control`, `list_directory`, `read_file`, `create_file`, `edit_file`, `delete_file` and `delete_directory`.
- **Swappable brains:** Gemini API (default, with automatic model detection), xAI Grok, local **Ollama** models (Llama 3, Qwen, Phi), or an offline rule-based mock brain that needs no key.
- **Long-term memory:** remembers your name and preferences across sessions (`sopi_memories.json`).
- **Safety first:**
  - **Directory allow-list:** file access is limited to the workspace, Documents and Desktop.
  - **Application deny-list:** `cmd.exe`, PowerShell, Registry Editor and similar tools are blocked.
  - **Permission gating:** every desktop action opens a dialog with **Allow once / Deny / Always approve**.
  - **Audit log:** every action and decision is written to `sopi_audit_log.json` and viewable in the UI.

## Architecture

```
 Microphone ─▶ Web Speech STT ─┐                          ┌─▶ tools/desktop.py   (apps, PyAutoGUI, shell)
 Wake word (PyAudio) ──────────┼─▶ FastAPI + WebSocket ─▶ brain.py ─▶ gating ─┼─▶ tools/file_ops.py  (allow-listed files)
 Text input ───────────────────┘        (main.py)         (LLM router)         └─▶ tools/internet.py  (search, scraping)
                                            │
                       Edge TTS ◀── reply ──┘
```

## Run the desktop app (Windows)

1. Install Python 3.10+.
2. Create a `.env` file in the project root:
   ```
   GEMINI_API_KEY=your-key-here
   LLM_PROVIDER=gemini        # gemini | grok | ollama | mock
   ```
3. Double-click `run.bat`. It creates a virtual environment, installs `requirements.txt`, starts the FastAPI server on `http://127.0.0.1:8000`, opens the UI and starts the wake-word listener.
4. Press **Space** or say **"Sopi"**, then try *"Who are you?"*, *"Open Notepad"* or *"Search the web for SpaceX"*.

Manual start:

```bash
python -m venv venv
venv\Scripts\pip install -r requirements.txt
venv\Scripts\uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

## Project structure

```
SopiAi/
├── run.bat                  # One-click Windows launcher
├── requirements.txt
├── backend/
│   ├── main.py              # FastAPI server, WebSocket router, TTS
│   ├── config.py            # Allow-listed folders, blocked apps, provider settings
│   ├── brain.py             # LLM router (Gemini / Grok / Ollama / mock) + tool-calling loop
│   ├── tools/
│   │   ├── internet.py      # Web search and page text extraction
│   │   ├── desktop.py       # App launching, shell commands, PyAutoGUI control
│   │   └── file_ops.py      # Allow-listed file operations
│   └── utils/
│       ├── gating.py        # Async user-approval gating
│       ├── logger.py        # Audit log
│       └── voice_detector.py# Background wake-word listener
├── frontend/                # Desktop UI (HTML/CSS/JS, 3D dotted-sphere visualizer)
└── web/                     # Static browser demo deployed to GitHub Pages
```

## Adding a tool

1. Write a function with type hints and a docstring in `backend/tools/` (Gemini reads both to decide when to call it).
2. Route it in `run_tool_safely` in `backend/brain.py` so it goes through permission gating, and add it to the tool list in `init_brain`.
3. Optionally, add it to the pre-approval settings in `frontend/app.js`.

## Web demo

`web/` is a dependency-free static site (ES modules) that reuses Sopi's tool schema, safety policy and UI. The Gemini brain calls the Gemini REST API directly from the browser with function calling. The offline brain is rule-based. Every push to `main` deploys it to GitHub Pages through `.github/workflows/pages.yml`.

---

Built by [Shreyansh Nandan Shukla](https://github.com/shreyanshnshukla).
