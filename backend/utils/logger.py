import json
import logging
from datetime import datetime
from pathlib import Path
from backend import config

logger = logging.getLogger("sopi.utils.logger")

def log_action(command: str, tool_name: str, arguments: dict, status: str, result: str):
    """Appends an audited action entry to the local JSON log file.
    
    Status can be: "pre_approved", "allowed_once", "denied", "error", or "bypass".
    """
    entry = {
        "timestamp": datetime.now().isoformat(),
        "command": command,
        "tool": tool_name,
        "arguments": arguments,
        "status": status,
        "result": str(result)[:2000] # Cap output to prevent massive log files
    }
    
    logger.info(f"AUDIT LOG: Tool={tool_name} Status={status} Args={arguments}")
    
    try:
        log_file = Path(config.LOG_FILE)
        log_entries = []
        
        if log_file.exists():
            try:
                with open(log_file, "r", encoding="utf-8") as f:
                    log_entries = json.load(f)
                    if not isinstance(log_entries, list):
                        log_entries = []
            except Exception as e:
                logger.error(f"Failed to read existing audit log: {e}")
                
        log_entries.append(entry)
        
        with open(log_file, "w", encoding="utf-8") as f:
            json.dump(log_entries, f, indent=2)
            
    except Exception as e:
        logger.error(f"Failed to write to audit log file: {e}")
