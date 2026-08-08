import json
import logging
from pathlib import Path
import requests
import google.generativeai as genai

from backend import config
from backend.tools import internet, desktop, file_ops
from backend.utils import logger as audit_logger
from backend.utils.gating import request_user_confirmation

logger = logging.getLogger("sopi.brain")

def get_openai_tools():
    return [
        {
            "type": "function",
            "function": {
                "name": "web_search",
                "description": "Queries DuckDuckGo/Google for real-time web results.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "query": {"type": "string", "description": "The search query."}
                    },
                    "required": ["query"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "fetch_page",
                "description": "Scrapes and gets clean visible text from any URL.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "url": {"type": "string", "description": "The absolute URL to fetch."}
                    },
                    "required": ["url"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "open_app",
                "description": "Launches a local application on Windows.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "app_name": {"type": "string", "description": "Application name or executable path."}
                    },
                    "required": ["app_name"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "run_command",
                "description": "Runs a safe shell command on Windows command prompt.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "command": {"type": "string", "description": "The shell command line to run."}
                    },
                    "required": ["command"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "browser_open",
                "description": "Opens a URL in the default web browser.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "url": {"type": "string", "description": "The URL to open."}
                    },
                    "required": ["url"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "pyautogui_control",
                "description": "Performs mouse clicks, typing, or hotkeys on screen.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "action_type": {"type": "string", "enum": ["click", "type", "press_key"], "description": "The action type."},
                        "text": {"type": "string", "description": "Text to type (only if action_type is 'type')."},
                        "x": {"type": "integer", "description": "X coordinate for click action."},
                        "y": {"type": "integer", "description": "Y coordinate for click action."}
                    },
                    "required": ["action_type"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "list_directory",
                "description": "Lists files and subdirectories inside a path.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "path": {"type": "string", "description": "The directory path to list."}
                    },
                    "required": ["path"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "read_file",
                "description": "Reads the text contents of a file.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "filepath": {"type": "string", "description": "Absolute file path to read."}
                    },
                    "required": ["filepath"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "create_file",
                "description": "Creates a new file with optional starting content.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "filepath": {"type": "string", "description": "Absolute path to create."},
                        "content": {"type": "string", "description": "Starting content to write."}
                    },
                    "required": ["filepath"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "edit_file",
                "description": "Replaces a contiguous block of text in an existing file.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "filepath": {"type": "string", "description": "Absolute path to edit."},
                        "target_content": {"type": "string", "description": "The exact string to be replaced."},
                        "replacement_content": {"type": "string", "description": "The new content to write."}
                    },
                    "required": ["filepath", "target_content", "replacement_content"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "delete_file",
                "description": "Deletes a specific file.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "filepath": {"type": "string", "description": "Absolute path of file to delete."}
                    },
                    "required": ["filepath"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "delete_directory",
                "description": "Clears and deletes a directory.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "path": {"type": "string", "description": "Absolute path of directory to delete."}
                    },
                    "required": ["path"]
                }
            }
        }
    ]

async def run_tool_safely(tool_name: str, args: dict, command: str) -> str:
    """Invokes the requested tool after verifying safety policies and gating on user permission."""
    try:
        # 1. Verification and User Confirmation request
        decision, pre_approve = await request_user_confirmation(tool_name, args)
        
        if decision != "allow":
            logger.warning(f"Safety Gating: Action '{tool_name}' was DENIED by the user.")
            audit_logger.log_action(command, tool_name, args, "denied", "User denied permission.")
            return "Action Blocked: User denied permission to run this action."
            
        status = "pre_approved" if tool_name in config.PRE_APPROVED_ACTIONS else "allowed_once"
        logger.info(f"Safety Gating: Action '{tool_name}' APPROVED. Execution starting...")
        
        # 2. Tool routing
        result = ""
        if tool_name == "web_search":
            result = internet.web_search(**args)
        elif tool_name == "fetch_page":
            result = internet.fetch_page(**args)
        elif tool_name == "open_app":
            result = desktop.open_app(**args)
        elif tool_name == "run_command":
            result = desktop.run_command(**args)
        elif tool_name == "browser_open":
            result = desktop.browser_open(**args)
        elif tool_name == "pyautogui_control":
            # pyautogui args can contain floats/None, let's coerce them
            coerce_args = {
                "action_type": args.get("action_type", ""),
                "text": args.get("text", ""),
                "x": int(args["x"]) if args.get("x") is not None else None,
                "y": int(args["y"]) if args.get("y") is not None else None
            }
            result = desktop.pyautogui_control(**coerce_args)
        elif tool_name == "list_directory":
            result = file_ops.list_directory(**args)
        elif tool_name == "read_file":
            result = file_ops.read_file(**args)
        elif tool_name == "create_file":
            result = file_ops.create_file(**args)
        elif tool_name == "edit_file":
            result = file_ops.edit_file(**args)
        elif tool_name == "delete_file":
            result = file_ops.delete_file(**args)
        elif tool_name == "delete_directory":
            result = file_ops.delete_directory(**args)
        else:
            status = "error"
            result = f"Unknown tool name: {tool_name}"
            
        # 3. Log the audit trail
        audit_logger.log_action(command, tool_name, args, status, result)
        return result
        
    except Exception as e:
        logger.error(f"Error running tool '{tool_name}' safely: {e}")
        audit_logger.log_action(command, tool_name, args, "error", str(e))
        return f"Error executing tool safely: {e}"


class FridayBrain:
    def __init__(self):
        self.api_key = config.GEMINI_API_KEY
        self.grok_key = getattr(config, "GROK_API_KEY", "")
        self.grok_model = getattr(config, "GROK_MODEL", "grok-4.5")
        self.chat = None
        self.history = []
        self.long_term_memories = {}
        
        # Load long-term memories
        self.load_memories()
        self.init_brain()

    def init_brain(self):
        """Initializes the active LLM provider based on settings."""
        provider = config.LLM_PROVIDER.lower()
        logger.info(f"Initializing Friday brain with provider: {provider}")
        
        if provider == "gemini":
            if self.api_key:
                try:
                    genai.configure(api_key=self.api_key)
                    # Dynamically detect supported model
                    model_name = self.detect_model()
                    
                    # Bind tools list
                    tools_list = [
                        internet.web_search,
                        internet.fetch_page,
                        desktop.open_app,
                        desktop.run_command,
                        desktop.browser_open,
                        desktop.pyautogui_control,
                        file_ops.list_directory,
                        file_ops.read_file,
                        file_ops.create_file,
                        file_ops.edit_file,
                        file_ops.delete_file,
                        file_ops.delete_directory
                    ]
                    
                    self.model = genai.GenerativeModel(
                        model_name=model_name,
                        system_instruction=self._get_system_instruction(),
                        tools=tools_list
                    )
                    self.chat = self.model.start_chat(history=[])
                    logger.info(f"Gemini API ({model_name}) initialized with tools successfully.")
                    return True
                except Exception as e:
                    logger.error(f"Failed to initialize Gemini API: {e}")
            else:
                logger.warning("No Gemini API Key provided. Set GEMINI_API_KEY in settings or use another provider.")
        
        elif provider == "ollama":
            # Test connection to Ollama server
            try:
                res = requests.get(f"{config.OLLAMA_URL}/api/tags", timeout=1)
                if res.status_code == 200:
                    logger.info(f"Ollama server connected at {config.OLLAMA_URL} using model '{config.OLLAMA_MODEL}'")
                    return True
            except Exception as e:
                logger.warning(f"Ollama server not running or unreachable at {config.OLLAMA_URL}: {e}")
        
        elif provider == "grok":
            if self.grok_key:
                logger.info("Grok API key found. Attempting to query available models...")
                self.detect_grok_model()
                return True
            else:
                logger.warning("No Grok API key provided. Set GROK_API_KEY in settings.")
                
        elif provider == "mock":
            logger.info("Friday brain running in offline Mock Demo mode.")
            return True
            
        return False

    def detect_model(self) -> str:
        """Queries the Gemini API for supported text models, prioritizing newer Flash models."""
        try:
            available_models = [m.name for m in genai.list_models() if 'generateContent' in m.supported_generation_methods]
            logger.info(f"Available Gemini models: {available_models}")
            
            prioritized = [
                "models/gemini-2.5-flash",
                "models/gemini-2.0-flash",
                "models/gemini-1.5-flash-latest",
                "models/gemini-1.5-flash",
                "models/gemini-1.5-pro",
                "models/gemini-2.0-flash-lite"
            ]
            
            for m in prioritized:
                if m in available_models:
                    model_name = m.replace("models/", "")
                    logger.info(f"Selected Gemini model: {model_name}")
                    return model_name
                    
            for m in available_models:
                if "flash" in m.lower():
                    model_name = m.replace("models/", "")
                    logger.info(f"Selected fallback flash model: {model_name}")
                    return model_name
            
            if available_models:
                model_name = available_models[0].replace("models/", "")
                logger.info(f"Selected first available model: {model_name}")
                return model_name
                
            return "gemini-2.0-flash"
        except Exception as e:
            logger.warning(f"Failed to query available models: {e}. Falling back to gemini-2.0-flash")
            return "gemini-2.0-flash"

    def detect_grok_model(self):
        """Queries xAI endpoint to list models available to this specific key."""
        if not self.grok_key:
            self.grok_model = "grok-2"
            return
            
        headers = {
            "Authorization": f"Bearer {self.grok_key}"
        }
        try:
            res = requests.get("https://api.x.ai/v1/models", headers=headers, timeout=6)
            if res.status_code == 200:
                data = res.json()
                model_ids = [m["id"] for m in data.get("data", [])]
                logger.info(f"Available Grok models for your key: {model_ids}")
                
                # Check for standard model keys
                selected = None
                for priority in ["grok-4.5-latest", "grok-4.5", "grok-4-latest", "grok-4", "grok-3-latest", "grok-3", "grok-2-latest", "grok-2", "grok-beta", "grok-2-1212"]:
                    if priority in model_ids:
                        selected = priority
                        break
                
                if not selected:
                    # Fallback to any model with 'grok' in name
                    grok_candidates = [m for m in model_ids if "grok" in m.lower()]
                    if grok_candidates:
                        selected = grok_candidates[0]
                    elif model_ids:
                        selected = model_ids[0]
                        
                if selected:
                    self.grok_model = selected
                    logger.info(f"Dynamically selected Grok model: {self.grok_model}")
                    return
            else:
                logger.warning(f"Failed to query Grok models (status {res.status_code}): {res.text}")
        except Exception as e:
            logger.error(f"Error querying Grok models: {e}")
            
        # Keep the configured/user-provided model name on error
        logger.info(f"Keeping active Grok model name: {self.grok_model}")

    def _get_system_instruction(self) -> str:
        memory_str = json.dumps(self.long_term_memories, indent=2)
        return (
            "You are Sopi, a premium, helpful personal voice assistant running on the user's desktop (Windows).\n"
            "Keep your responses relatively brief, conversational, and direct, because they will be read aloud to the user.\n"
            "Avoid outputting markdown lists, code blocks, or heavy formatting in your direct answers unless requested, as it doesn't speak well.\n"
            "If you need to show code or detailed lists, explain it briefly and state that you have displayed it in the transcript window.\n\n"
            "You have access to a variety of tools to control the local computer (launching apps, creating/editing files, browser control, running shell scripts, and web searches).\n"
            "Use them whenever the user asks you to complete a task. Safety gating is handled automatically, so write/call files when needed.\n\n"
            f"Here are the user's persisted preferences and long-term memories:\n{memory_str}\n\n"
            "If the user shares new details (like their name, preferences, or tasks they want you to remember), acknowledge it and "
            "make sure to update your memory files. Be friendly, sleek, and highly capable."
        )

    def update_api_key(self, api_key: str):
        self.api_key = api_key
        config.GEMINI_API_KEY = api_key
        config.LLM_PROVIDER = "gemini" # Force switch to gemini
        return self.init_brain()

    def update_grok_key(self, grok_key: str, grok_model: str = None):
        self.grok_key = grok_key
        config.GROK_API_KEY = grok_key
        if grok_model:
            config.GROK_MODEL = grok_model
            self.grok_model = grok_model
        config.LLM_PROVIDER = "grok" # Force switch to grok
        return self.init_brain()

    def update_provider(self, provider: str, ollama_url: str = None, ollama_model: str = None):
        config.LLM_PROVIDER = provider
        if ollama_url:
            config.OLLAMA_URL = ollama_url
        if ollama_model:
            config.OLLAMA_MODEL = ollama_model
        return self.init_brain()

    def load_memories(self):
        if Path(config.MEMORIES_FILE).exists():
            try:
                with open(config.MEMORIES_FILE, 'r', encoding='utf-8') as f:
                    self.long_term_memories = json.load(f)
            except Exception as e:
                logger.error(f"Error loading memories: {e}")
                self.long_term_memories = {}
        else:
            self.long_term_memories = {
                "user_name": "User",
                "favorite_apps": [],
                "user_preferences": {}
            }
            self.save_memories()

    def save_memories(self):
        try:
            with open(config.MEMORIES_FILE, 'w', encoding='utf-8') as f:
                json.dump(self.long_term_memories, f, indent=2)
        except Exception as e:
            logger.error(f"Error saving memories: {e}")

    async def query(self, prompt: str) -> str:
        # Custom trigger check
        provider = config.LLM_PROVIDER.lower()
        
        # 1. Gemini query
        if provider == "gemini":
            if not self.api_key or not self.chat:
                return "My Gemini brain is not initialized. Please configure your API key in the Settings panel or choose another provider (Ollama or Mock)."
            
            try:
                response = self.chat.send_message(prompt)
                
                # Turn loop for handling function calls
                while True:
                    # Check if there is a function call in the parts
                    has_fc = False
                    if response.candidates and response.candidates[0].content.parts:
                        for part in response.candidates[0].content.parts:
                            if part.function_call:
                                has_fc = True
                                fc = part.function_call
                                tool_name = fc.name
                                args = dict(fc.args)
                                
                                logger.info(f"Gemini requested tool call: {tool_name} with args {args}")
                                
                                # Run the tool safely (awaits user confirmation)
                                tool_result = await run_tool_safely(tool_name, args, prompt)
                                
                                # Feed result back to the model
                                response = self.chat.send_message(
                                    genai.types.Part.from_function_response(
                                        name=tool_name,
                                        response={'result': tool_result}
                                    )
                                )
                                break # break parts loop to handle the new turn response
                    
                    if not has_fc:
                        break # no function calls left, exit loop
                        
                return response.text
                
            except Exception as e:
                logger.error(f"Error in Gemini API query: {e}")
                return f"Sorry, I encountered an error communicating with my brain: {str(e)}"
                
        # 1.5. Grok (xAI) query
        elif provider == "grok":
            if not self.grok_key:
                return "My Grok brain is not initialized. Please configure your Grok API key in the Settings panel."
                
            headers = {
                "Authorization": f"Bearer {self.grok_key}",
                "Content-Type": "application/json"
            }
            url = "https://api.x.ai/v1/chat/completions"
            system_prompt = self._get_system_instruction()
            
            # Construct messages context in OpenAI format
            messages = [{"role": "system", "content": system_prompt}]
            for role, text in self.history[-6:]:
                messages.append({"role": role, "content": text})
            messages.append({"role": "user", "content": prompt})
            
            try:
                logger.info(f"Querying Grok API using model: {self.grok_model}")
                # Turn loop for handling function calls
                while True:
                    payload = {
                        "model": self.grok_model,
                        "messages": messages,
                        "tools": get_openai_tools(),
                        "tool_choice": "auto"
                    }
                    
                    res = requests.post(url, headers=headers, json=payload, timeout=30)
                    if res.status_code != 200:
                        logger.error(f"Grok API error ({res.status_code}): {res.text}")
                        return f"Error from Grok API ({res.status_code}): {res.text}"
                        
                    response_data = res.json()
                    choice = response_data["choices"][0]
                    message = choice["message"]
                    
                    # Check if model requested tool calls
                    if "tool_calls" in message and message["tool_calls"]:
                        # Append assistant message with tool calls to context
                        messages.append(message)
                        
                        # Process tool calls
                        for tool_call in message["tool_calls"]:
                            tool_name = tool_call["function"]["name"]
                            tool_args_str = tool_call["function"]["arguments"]
                            tool_call_id = tool_call["id"]
                            
                            try:
                                args = json.loads(tool_args_str)
                            except Exception as parse_err:
                                logger.error(f"Failed to parse Grok tool arguments: {parse_err}")
                                args = {}
                                
                            logger.info(f"Grok requested tool call: {tool_name} with args {args}")
                            
                            # Run tool safely (awaits user approval modal)
                            tool_result = await run_tool_safely(tool_name, args, prompt)
                            
                            # Append tool response back to context
                            messages.append({
                                "role": "tool",
                                "tool_call_id": tool_call_id,
                                "name": tool_name,
                                "content": str(tool_result)
                            })
                        # Continue loop to send tool results back to Grok
                        continue
                    else:
                        # Direct text response, save to history and return
                        reply = message["content"]
                        self.history.append(("user", prompt))
                        self.history.append(("assistant", reply))
                        return reply
            except Exception as e:
                logger.error(f"Failed to query Grok: {e}")
                return f"Sorry, I failed to communicate with Grok: {str(e)}"
        
        # 2. Ollama query
        elif provider == "ollama":
            url = f"{config.OLLAMA_URL}/api/chat"
            system_prompt = self._get_system_instruction()
            
            messages = [{"role": "system", "content": system_prompt}]
            for role, text in self.history[-6:]:
                messages.append({"role": role, "content": text})
            messages.append({"role": "user", "content": prompt})
            
            payload = {
                "model": config.OLLAMA_MODEL,
                "messages": messages,
                "stream": False
            }
            
            try:
                res = requests.post(url, json=payload, timeout=12)
                if res.status_code == 200:
                    reply = res.json()["message"]["content"]
                    self.history.append(("user", prompt))
                    self.history.append(("assistant", reply))
                    return reply
                else:
                    return f"Error from Ollama ({res.status_code}): {res.text}"
            except Exception as e:
                logger.error(f"Failed to query Ollama at {url}: {e}")
                return f"Could not connect to your local Ollama server at {config.OLLAMA_URL}. Ensure Ollama is running."
                
        # 3. Mock query
        elif provider == "mock":
            if "hello" in clean_prompt or "hi" in clean_prompt:
                return "Hello there! I am Sopi, your desktop companion. I am currently running in offline mock mode."
            elif "who are you" in clean_prompt or "your name" in clean_prompt:
                return "I am Sopi, a desktop voice assistant. I'm currently running in demo mode, which means my brain responses are preconfigured but my voice and mic loops are fully functional."
            elif "time" in clean_prompt:
                import datetime
                now = datetime.datetime.now()
                return f"The current time is {now.strftime('%I:%M %p')}."
            elif "weather" in clean_prompt:
                return "I'd love to tell you the weather, but I'm currently in demo mode. Once you configure a Gemini API key or set up a local Ollama model, I'll be able to pull real-time weather details."
            else:
                return f"I heard you say: '{prompt}'. Sopi is running in local demo mode, meaning I don't have a live AI brain active, but our speech connection is working perfectly!"
                
        return "Unknown LLM provider configured."
