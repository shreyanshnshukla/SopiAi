import os
from pathlib import Path
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

# Base directories
BASE_DIR = Path(__file__).resolve().parent.parent
WORKSPACE_DIR = BASE_DIR

# API Keys & LLM Settings
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
GROK_API_KEY = os.getenv("GROK_API_KEY", "")
GROK_MODEL = os.getenv("GROK_MODEL", "grok-4.5")
LLM_PROVIDER = os.getenv("LLM_PROVIDER", "gemini") # "gemini", "grok", "ollama", "mock"
OLLAMA_URL = os.getenv("OLLAMA_URL", "http://localhost:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "llama3")

# Speech & Voice Settings
# edge-tts voice list can be found by running edge-tts --list-voices
DEFAULT_VOICE = os.getenv("DEFAULT_VOICE", "en-US-AndrewNeural") 

# Safety & Permissions
ALLOW_LIST_DIRECTORIES = [
    str(WORKSPACE_DIR),
    os.path.expanduser("~/Documents"),
    os.path.expanduser("~/Desktop")
]

DENY_LIST_APPS = [
    "cmd.exe", "powershell.exe", "regedit.exe", "control.exe"
]

PRE_APPROVED_ACTIONS = [] # Filled dynamically by the UI settings

# Audio config
WAKE_WORD = "friday"
PTT_SHORTCUT = "ctrl+space"

# Logs
LOG_FILE = BASE_DIR / "friday_audit_log.json"
MEMORIES_FILE = BASE_DIR / "friday_memories.json"
