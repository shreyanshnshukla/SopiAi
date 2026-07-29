# Sopi: Personal Voice Assistant for Windows

Sopi is a sleek, personal desktop voice assistant that you can talk to out loud. It features low-latency voice I/O, local desktop control (opening apps, running shell commands, automation), file operations, web search, and a robust user-permission gating system for security.

Friday supports three backend brains:
1. **Gemini API** (Google Generative AI - default, supports dynamic tool calling).
2. **Ollama** (Local offline LLMs like Llama3/Qwen/Phi).
3. **Offline Mock Mode** (A rule-based offline demo brain that requires no key or local model).

---

## Features

* **Voice I/O**:
  * **Wake-word Activation**: Continuous background microphone listening triggers Sopi whenever you say *"Sopi"*.
  * **Push-to-Talk**: Hit the **Spacebar** or click the glowing Visualizer Orb to start recording.
  * **Natural TTS**: Uses Microsoft Edge's realistic neural voices for speech output.
* **OS & Desktop Control**:
  * Launch applications (e.g. Chrome, Notepad, Paint).
  * Safe shell command executor (run build scripts, query system status).
  * Web search (dynamic web scraping of Google or DuckDuckGo) and fetch text from specific URLs.
  * PyAutoGUI mouse/keyboard control (typing text, clicking coordinates, key combinations).
* **Safety First**:
  * **Strict Directory Allow-list**: Friday is locked down to specific directories (defaults to workspace, Documents, and Desktop). All file reads/writes/edits outside these folders are blocked immediately.
  * **Application Deny-list**: Block launch of risky tools (e.g., cmd.exe, PowerShell, Registry Editor).
  * **Permission Gating**: Every desktop control action blocks and opens a visual permission dialog requesting your choice of **Allow Once**, **Deny**, or **Always Approve** (pre-approval).
  * **No Pre-approval for Destruction**: File deletion (`delete_file`, `delete_directory`) can *never* be pre-approved; they will *always* trigger a manual prompt.
  * **Safety Audit Logs**: Every action is saved to `friday_audit_log.json` and visible via the built-in logs viewer in the settings panel.

---

## Quick Start on Windows

1. Double-click [run.bat](file:///C:/Users/SHREYANSH/.gemini/antigravity/scratch/friday/run.bat) (or run it in the command prompt).
2. The script will automatically create a Python virtual environment, install dependencies, spin up the FastAPI server, open the browser interface, and start the background wake-word listener.
3. Open the **Settings panel** (sliders icon in the bottom-right corner):
   * Select your **LLM Brain Provider**:
     * For **Gemini**: Paste your API key from Google AI Studio.
     * For **Mock**: No key needed (perfect for testing voice loops immediately).
     * For **Ollama**: Specify your local URL and active model name.
   * Click **Save Changes**.
4. To speak, press the **Spacebar** or say **"Friday"** out loud. Say *"Who are you?"* or *"Search the web for SpaceX"*!

---

## File Structure

```
friday/
├── run.bat                 # One-click Windows launcher script
├── requirements.txt        # Python package declarations
├── README.md               # Setup & extension guide
├── friday_memories.json    # Persistent memories (name, preferences)
├── friday_audit_log.json   # Safety log output
├── backend/
│   ├── main.py              # FastAPI server & Websocket router
│   ├── config.py            # Allowed folders, blocked apps, current voice config
│   ├── brain.py             # LLM router (Gemini/Ollama/Mock) & Function Calling dispatcher
│   ├── tools/
│   │   ├── internet.py      # Google/DuckDuckGo searches & webpage text scraper
│   │   ├── desktop.py       # Application launching & PyAutoGUI simulation
│   │   └── file_ops.py      # File system listings, reading, writing, and deletions
│   └── utils/
│       ├── voice_detector.py# PyAudio background wake-word detector
│       ├── gating.py        # Asynchronous user-approval gating
│       └── logger.py        # Audit logs compiler
└── frontend/
    ├── index.html           # Glassmorphic control dashboard
    ├── style.css            # Dark neon styles & visualizer keyframe animations
    ├── app.js               # Web Speech STT, Websocket events, and modal interactions
    └── audio/               # Directory containing temp TTS response files
```

---

## How to Extend Friday with New Tools

Friday utilizes Gemini's native **Function Calling** capabilities. The Gemini Python SDK automatically extracts tool definitions, parameters, and descriptions directly from Python functions via **Type Annotations** and **Docstrings**.

To add a new tool to Friday, follow these three steps:

### 1. Create the Tool Function
Add your function in one of the tools modules, or create a new file in `backend/tools/`.
Ensure it has a descriptive **docstring** (used by Gemini to understand when to invoke it) and **type hints** for all parameters.

*Example (in `backend/tools/desktop.py`):*
```python
def check_disk_space(drive: str = "C") -> str:
    """Returns the free disk space on a specific Windows drive.
    
    Args:
        drive: The drive letter to check (default is 'C').
    """
    import shutil
    try:
        total, used, free = shutil.disk_usage(f"{drive}:\\")
        free_gb = free // (2**30)
        return f"Drive {drive}: has {free_gb} GB of free space."
    except Exception as e:
        return f"Failed to check disk space: {e}"
```

### 2. Register the Tool in the Safety Gating Router
Open [backend/brain.py](file:///C:/Users/SHREYANSH/.gemini/antigravity/scratch/friday/backend/brain.py):
1. Import your function.
2. Add a routing check inside the `run_tool_safely` function:
   ```diff
          elif tool_name == "delete_directory":
              result = file_ops.delete_directory(**args)
   +      elif tool_name == "check_disk_space":
   +          result = desktop.check_disk_space(**args)
   ```
3. Add the function reference to the `tools_list` array inside `init_brain` so Gemini is aware of it:
   ```diff
                      tools_list = [
                          internet.web_search,
                          internet.fetch_page,
   +                      desktop.check_disk_space,
                          desktop.open_app,
   ```

### 3. Add to Pre-Approved Settings Checkbox (Optional)
If you want to allow the user to pre-approve this tool, add a checkbox for it in the settings panel of [index.html](file:///C:/Users/SHREYANSH/.gemini/antigravity/scratch/friday/frontend/index.html) and bind it in [app.js](file:///C:/Users/SHREYANSH/.gemini/antigravity/scratch/friday/frontend/app.js) inside the configurations list.
