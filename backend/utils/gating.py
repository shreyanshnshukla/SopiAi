import uuid
import asyncio
import logging
from backend import config

logger = logging.getLogger("friday.utils.gating")

# Shared state between WebSocket server and tools
active_connections = []
pending_confirmations = {}      # req_id -> asyncio.Event
confirmation_decisions = {}     # req_id -> "allow" / "deny"
confirmation_preapprove = {}    # req_id -> true / false

async def request_user_confirmation(action_type: str, payload: dict) -> tuple[str, bool]:
    """Sends a message to the Web UI and waits for the user's permission.
    Returns: (decision, pre_approve) where decision is 'allow' or 'deny'.
    """
    # 1. Check if action is pre-approved
    # Destructive operations (delete_file, delete_directory) are NEVER pre-approved
    is_destructive = action_type in ["delete_file", "delete_directory"]
    if action_type in config.PRE_APPROVED_ACTIONS and not is_destructive:
        logger.info(f"Action '{action_type}' is pre-approved. Bypassing user check.")
        return "allow", False
        
    if not active_connections:
        logger.warning("No active WebSocket client connected. Action blocked automatically.")
        return "deny", False
        
    # 2. Generate a unique ID for this request
    req_id = str(uuid.uuid4())
    event = asyncio.Event()
    pending_confirmations[req_id] = event
    
    # 3. Broadcast to client
    logger.info(f"Requesting confirmation for '{action_type}' (id: {req_id}). Payload: {payload}")
    for ws in active_connections:
        try:
            await ws.send_json({
                "type": "confirm_request",
                "id": req_id,
                "action_type": action_type,
                "payload": payload
            })
        except Exception as e:
            logger.error(f"Failed to send confirmation request to client: {e}")
            
    # 4. Wait for event set (triggered when confirm_response arrives)
    try:
        # Timeout after 60 seconds (user must respond in 60s)
        await asyncio.wait_for(event.wait(), timeout=60.0)
        decision = confirmation_decisions.get(req_id, "deny")
        pre_approve = confirmation_preapprove.get(req_id, False)
        logger.info(f"User decision received: {decision} (Always Approve: {pre_approve})")
        return decision, pre_approve
    except asyncio.TimeoutError:
        logger.warning(f"Confirmation request '{req_id}' timed out after 60 seconds.")
        return "deny", False
    finally:
        # Clean up
        pending_confirmations.pop(req_id, None)
        confirmation_decisions.pop(req_id, None)
        confirmation_preapprove.pop(req_id, None)
