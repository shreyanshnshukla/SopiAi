import os
import shutil
import logging
from pathlib import Path
from backend import config

logger = logging.getLogger("sopi.tools.file_ops")

class FileOpsError(Exception):
    pass

def is_safe_path(path_str: str, check_parent: bool = False) -> bool:
    """Verifies if the target path is inside the allow-list directories."""
    try:
        p = Path(path_str)
        # If the file/folder doesn't exist yet, we check if the parent folder is safe
        if check_parent or not p.exists():
            p = p.parent
            
        resolved_path = p.resolve()
        
        for allowed in config.ALLOW_LIST_DIRECTORIES:
            try:
                resolved_allowed = Path(allowed).resolve()
                if resolved_path == resolved_allowed or resolved_path.is_relative_to(resolved_allowed):
                    return True
            except Exception:
                continue
    except Exception as e:
        logger.error(f"Error checking safety of path '{path_str}': {e}")
        
    return False

def list_directory(directory_path: str = ".") -> str:
    """Lists files and folders inside a given allow-listed directory."""
    if not is_safe_path(directory_path):
        return f"Access Denied: Path '{directory_path}' is not within approved directories."
        
    try:
        p = Path(directory_path)
        items = list(p.iterdir())
        if not items:
            return f"Directory '{directory_path}' is empty."
            
        lines = []
        for item in items:
            type_str = "<DIR>" if item.is_dir() else f"{item.stat().st_size} bytes"
            lines.append(f"{item.name:30} {type_str}")
        return "\n".join(lines)
    except Exception as e:
        return f"Error listing directory: {e}"

def read_file(file_path: str) -> str:
    """Reads and returns the contents of a text file inside an allow-listed directory."""
    if not is_safe_path(file_path):
        return f"Access Denied: Path '{file_path}' is not within approved directories."
        
    try:
        p = Path(file_path)
        if not p.is_file():
            return f"Error: '{file_path}' is not a file."
            
        # Limit read size to prevent context overload
        if p.stat().st_size > 100000:
            return f"Error: File is too large ({p.stat().st_size} bytes). Max readable size is 100KB."
            
        return p.read_text(encoding='utf-8', errors='replace')
    except Exception as e:
        return f"Error reading file: {e}"

def create_file(file_path: str, content: str) -> str:
    """Creates a new file with the specified content inside an allow-listed directory."""
    if not is_safe_path(file_path, check_parent=True):
        return f"Access Denied: Cannot create file at '{file_path}'. Not within approved directories."
        
    try:
        p = Path(file_path)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(content, encoding='utf-8')
        return f"Successfully created file: '{file_path}' ({len(content)} characters)."
    except Exception as e:
        return f"Error creating file: {e}"

def edit_file(file_path: str, target_string: str, replacement_string: str) -> str:
    """Replaces occurrences of target_string with replacement_string in a file."""
    if not is_safe_path(file_path):
        return f"Access Denied: Path '{file_path}' is not within approved directories."
        
    try:
        p = Path(file_path)
        if not p.is_file():
            return f"Error: '{file_path}' is not a file."
            
        content = p.read_text(encoding='utf-8', errors='replace')
        if target_string not in content:
            return f"Error: Search string '{target_string}' not found in file."
            
        new_content = content.replace(target_string, replacement_string)
        p.write_text(new_content, encoding='utf-8')
        return f"Successfully edited file '{file_path}'."
    except Exception as e:
        return f"Error editing file: {e}"

def delete_file(file_path: str) -> str:
    """Removes a file from the disk inside allow-listed folders. ALWAYS requires separate confirmation."""
    if not is_safe_path(file_path):
        return f"Access Denied: Path '{file_path}' is not within approved directories."
        
    try:
        p = Path(file_path)
        if p.is_file():
            p.unlink()
            return f"Successfully deleted file: '{file_path}'."
        else:
            return f"Error: '{file_path}' is not a file."
    except Exception as e:
        return f"Error deleting file: {e}"

def delete_directory(dir_path: str) -> str:
    """Recursively removes a directory from disk inside allow-listed folders. ALWAYS requires separate confirmation."""
    if not is_safe_path(dir_path):
        return f"Access Denied: Path '{dir_path}' is not within approved directories."
        
    try:
        p = Path(dir_path)
        if p.is_dir():
            shutil.rmtree(p)
            return f"Successfully deleted directory: '{dir_path}'."
        else:
            return f"Error: '{dir_path}' is not a directory."
    except Exception as e:
        return f"Error deleting directory: {e}"
