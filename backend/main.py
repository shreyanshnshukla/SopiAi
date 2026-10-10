import os
import json
import logging
import asyncio
from pathlib import Path
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import edge_tts

from backend import config
from backend.brain import SopiBrain
from backend.utils import gating

# Configure logger
logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger("sopi.main")

app = FastAPI(title="Sopi Voice Assistant API")

# Allow CORS for local development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Ensure audio directory exists
AUDIO_DIR = config.BASE_DIR / "frontend" / "audio"
AUDIO_DIR.mkdir(parents=True, exist_ok=True)

# Initialize Brain
brain = SopiBrain()

class ConfigUpdate(BaseModel):
    gemini_key: str = None
    grok_key: str = None
    grok_model: str = None
    voice: str = None
    allow_dirs: list[str] = None
    pre_approved: list[str] = None
    provider: str = None
    ollama_url: str = None
    ollama_model: str = None

@app.post("/api/config")
async def update_config(data: ConfigUpdate):
    if data.gemini_key is not None:
        # Only update key if it has value and isn't the masked string
        if data.gemini_key != "••••••••••••••••" and data.gemini_key.strip():
            success = brain.update_api_key(data.gemini_key)
            if not success and data.provider == "gemini":
                raise HTTPException(status_code=400, detail="Failed to initialize brain with the provided key")
                
    if data.grok_key is not None:
        # Update Grok API Key
        if data.grok_key != "••••••••••••••••" and data.grok_key.strip():
            success = brain.update_grok_key(data.grok_key, data.grok_model)
            if not success and data.provider == "grok":
                raise HTTPException(status_code=400, detail="Failed to initialize brain with the provided Grok key")
                
    if data.grok_model is not None:
        config.GROK_MODEL = data.grok_model
        brain.grok_model = data.grok_model
    
    if data.provider is not None:
        brain.update_provider(data.provider, data.ollama_url, data.ollama_model)
        
    if data.voice is not None:
        config.DEFAULT_VOICE = data.voice
        
    if data.allow_dirs is not None:
        config.ALLOW_LIST_DIRECTORIES = data.allow_dirs
        
    if data.pre_approved is not None:
        config.PRE_APPROVED_ACTIONS = data.pre_approved
        
    return {
        "status": "success",
        "config": {
            "has_key": bool(brain.api_key),
            "has_grok_key": bool(brain.grok_key),
            "grok_model": config.GROK_MODEL,
            "provider": config.LLM_PROVIDER,
            "ollama_url": config.OLLAMA_URL,
            "ollama_model": config.OLLAMA_MODEL,
            "voice": config.DEFAULT_VOICE,
            "allow_dirs": config.ALLOW_LIST_DIRECTORIES,
            "pre_approved": config.PRE_APPROVED_ACTIONS
        }
    }

@app.get("/api/config")
async def get_config():
    return {
        "has_key": bool(brain.api_key),
        "has_grok_key": bool(brain.grok_key),
        "grok_model": config.GROK_MODEL,
        "provider": config.LLM_PROVIDER,
        "ollama_url": config.OLLAMA_URL,
        "ollama_model": config.OLLAMA_MODEL,
        "voice": config.DEFAULT_VOICE,
        "allow_dirs": config.ALLOW_LIST_DIRECTORIES,
        "pre_approved": config.PRE_APPROVED_ACTIONS
    }

@app.get("/api/logs")
async def get_logs():
    log_file = config.BASE_DIR / "sopi_audit_log.json"
    if log_file.exists():
        try:
            with open(log_file, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to read logs: {e}")
    return []

@app.post("/api/wake")
async def trigger_wake():
    logger.info("Wake word detected externally")
    for ws in gating.active_connections:
        try:
            await ws.send_json({"type": "wake_trigger"})
        except Exception as e:
            logger.error(f"Failed to send wake trigger to WS: {e}")
    return {"status": "ok"}

async def generate_tts(text: str) -> str:
    """Generates an MP3 file using edge-tts and returns the relative path."""
    try:
        # Sanitize text for TTS (remove markdown bold/italic tags and complex symbols)
        clean_text = text.replace("*", "").replace("_", "").replace("`", "")
        
        filename = "response.mp3"
        filepath = AUDIO_DIR / filename
        
        communicate = edge_tts.Communicate(clean_text, config.DEFAULT_VOICE)
        await communicate.save(str(filepath))
        
        return f"/frontend/audio/{filename}"
    except Exception as e:
        logger.error(f"TTS generation error: {e}")
        return ""

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    gating.active_connections.append(websocket)
    logger.info("WebSocket client connected.")
    
    try:
        # Send initial connection state
        await websocket.send_json({
            "type": "system",
            "message": f"Connected to Sopi Backend. Active Brain: {config.LLM_PROVIDER.upper()}."
        })
        
        while True:
            # Wait for messages from the frontend
            data = await websocket.receive_text()
            message = json.loads(data)
            
            msg_type = message.get("type")
            
            if msg_type == "text_input" or msg_type == "speech_input":
                user_text = message.get("text", "")
                logger.info(f"Received user input: {user_text}")
                
                # Send typing indicator
                await websocket.send_json({"type": "status", "status": "thinking"})
                
                # Query brain (which will block if a tool confirmation is needed)
                reply = await brain.query(user_text)
                
                # Send typing indicator end
                await websocket.send_json({"type": "status", "status": "speaking"})
                
                # Generate TTS
                audio_url = await generate_tts(reply)
                
                # Send reply to client
                await websocket.send_json({
                    "type": "assistant_reply",
                    "text": reply,
                    "audio_url": audio_url
                })
                
                # Reset status to idle
                await websocket.send_json({"type": "status", "status": "idle"})
                
            elif msg_type == "confirm_response":
                req_id = message.get("id")
                decision = message.get("decision", "deny")
                pre_approve = message.get("pre_approve", False)
                action_t = message.get("action_type")
                
                logger.info(f"Received confirmation response: id={req_id}, decision={decision}, pre_approve={pre_approve}")
                
                # Save to config.PRE_APPROVED_ACTIONS
                if pre_approve and decision == "allow" and action_t:
                    if action_t not in config.PRE_APPROVED_ACTIONS:
                        config.PRE_APPROVED_ACTIONS.append(action_t)
                
                # Set event to unblock tool execution thread
                if req_id in gating.pending_confirmations:
                    gating.confirmation_decisions[req_id] = decision
                    gating.confirmation_preapprove[req_id] = pre_approve
                    gating.pending_confirmations[req_id].set()
                else:
                    logger.warning(f"Received confirm_response for unknown/expired request ID: {req_id}")
                
    except WebSocketDisconnect:
        gating.active_connections.remove(websocket)
        logger.info("WebSocket client disconnected.")
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
        if websocket in gating.active_connections:
            gating.active_connections.remove(websocket)

# Mount frontend directory as static files (this serves index.html, css, js)
app.mount("/frontend", StaticFiles(directory=config.BASE_DIR / "frontend"), name="frontend")

# Redirect root to frontend index.html
@app.get("/")
async def read_index():
    from fastapi.responses import RedirectResponse
    return RedirectResponse(url="/frontend/index.html")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("backend.main:app", host="127.0.0.1", port=8000, reload=True)
