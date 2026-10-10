import os
import subprocess
import webbrowser
import logging
import pyautogui
from backend import config

logger = logging.getLogger("sopi.tools.desktop")

# Disable PyAutoGUI delay where possible to make actions quick, but add a small safety pause
pyautogui.PAUSE = 0.5
# PyAutoGUI fail-safe: moving mouse to any corner aborts script
pyautogui.FAILSAFE = True

def is_app_denied(app_name_or_path: str) -> bool:
    name_lower = os.path.basename(app_name_or_path).lower()
    for denied in config.DENY_LIST_APPS:
        if denied.lower() in name_lower or denied.lower() == name_lower:
            return True
    return False

def is_command_dangerous(command: str) -> bool:
    cmd_lower = command.lower()
    # Dangerous keywords that shouldn't be run directly
    dangerous = [
        "del", "rm ", "rmdir", "format", "shutdown", "reboot", 
        "mkfs", "fdisk", "reg delete", "net user", "kill"
    ]
    for word in dangerous:
        if word in cmd_lower:
            # Check for word boundary or command match
            if f" {word}" in f" {cmd_lower}":
                return True
    return False

def open_app(app_name_or_path: str) -> str:
    """Launches an application on the user's desktop."""
    if is_app_denied(app_name_or_path):
        return f"Access Denied: Launching '{app_name_or_path}' is forbidden by deny-list policies."
        
    try:
        # Check standard common windows apps shortcuts
        common_apps = {
            "notepad": "notepad.exe",
            "calc": "calc.exe",
            "calculator": "calc.exe",
            "paint": "mspaint.exe",
            "explorer": "explorer.exe",
            "word": "winword.exe",
            "excel": "excel.exe",
            "chrome": "chrome.exe",
            "edge": "msedge.exe"
        }
        
        target = common_apps.get(app_name_or_path.lower(), app_name_or_path)
        
        logger.info(f"Launching application: {target}")
        # On Windows, os.startfile is the cleanest way to run files/apps without terminal popping
        os.startfile(target)
        return f"Successfully launched application: '{app_name_or_path}'."
    except Exception as e:
        # Fallback to subprocess start
        try:
            subprocess.Popen(target, shell=True)
            return f"Successfully launched application: '{app_name_or_path}'."
        except Exception as ex:
            return f"Error launching application: {e} (Fallback: {ex})"

def run_command(command: str) -> str:
    """Runs a shell command safely in the Windows shell and returns output."""
    if is_command_dangerous(command):
        return "Access Denied: This command contains patterns recognized as dangerous and is blocked."
        
    logger.info(f"Executing command: {command}")
    try:
        # Run with timeout to prevent hang
        result = subprocess.run(
            command,
            shell=True,
            text=True,
            capture_output=True,
            timeout=10,
            cwd=str(config.WORKSPACE_DIR)
        )
        
        out = result.stdout or ""
        err = result.stderr or ""
        
        response = []
        if out.strip():
            response.append(f"STDOUT:\n{out}")
        if err.strip():
            response.append(f"STDERR:\n{err}")
        if not response:
            response.append(f"Command executed (Return code: {result.returncode}) with no output.")
            
        return "\n".join(response)
    except subprocess.TimeoutExpired:
        return "Error: Command timed out after 10 seconds."
    except Exception as e:
        return f"Error executing command: {e}"

def browser_open(url: str) -> str:
    """Opens the specified URL in the user's default web browser."""
    logger.info(f"Opening browser to URL: {url}")
    try:
        # Add http if not present
        target_url = url
        if not url.startswith("http://") and not url.startswith("https://"):
            target_url = "https://" + url
            
        webbrowser.open(target_url)
        return f"Successfully opened browser to: '{target_url}'."
    except Exception as e:
        return f"Error opening browser: {e}"

def pyautogui_control(action_type: str, text: str = "", x: int = None, y: int = None) -> str:
    """Performs manual keyboard or mouse automation.
    Actions: 'click' (at coordinates x,y), 'type' (a string), 'press' (a shortcut, e.g. 'enter'), 'move' (to x,y).
    """
    logger.info(f"PyAutoGUI action: {action_type} (text: '{text}', x: {x}, y: {y})")
    try:
        action = action_type.lower()
        if action == "click":
            if x is not None and y is not None:
                pyautogui.click(x, y)
                return f"Mouse clicked at coordinates ({x}, {y})."
            else:
                pyautogui.click()
                return "Mouse clicked at current position."
                
        elif action == "move":
            if x is not None and y is not None:
                pyautogui.moveTo(x, y, duration=0.5)
                return f"Mouse moved to coordinates ({x}, {y})."
            else:
                return "Error: Click/Move action requires 'x' and 'y' coordinates."
                
        elif action == "type":
            if text:
                pyautogui.write(text, interval=0.05)
                return f"Typed text string: '{text}'."
            else:
                return "Error: Type action requires a 'text' argument."
                
        elif action == "press":
            if text:
                # Can be a single key 'enter' or combo 'ctrl+t'
                keys = text.split("+")
                if len(keys) > 1:
                    pyautogui.hotkey(*keys)
                else:
                    pyautogui.press(text)
                return f"Pressed key/shortcut: '{text}'."
            else:
                return "Error: Press action requires a key 'text' argument."
                
        return f"Unknown PyAutoGUI action type: '{action_type}'"
    except Exception as e:
        return f"Automation error: {e}"
