// Friday Frontend Application Logic

// WebSocket Connection
let socket = null;
let socketUrl = `ws://${window.location.host}/ws`;
// Fallback URL if running on a custom page locally
if (window.location.protocol === 'file:') {
    socketUrl = 'ws://localhost:8000/ws';
}

// UI State Elements
const orb = document.getElementById('sopi-sphere-container') || document.getElementById('friday-orb');
const currentStatusTitle = document.getElementById('current-status-title');
const currentStatusDesc = document.getElementById('current-status-desc');
const connectionStatus = document.getElementById('connection-status');
const connectionStatusText = connectionStatus.querySelector('.status-text');
const connectionStatusDot = connectionStatus.querySelector('.status-dot');
const transcriptViewport = document.getElementById('transcript-viewport');
const textInput = document.getElementById('text-input');
const sendBtn = document.getElementById('send-btn');
const clearTranscriptBtn = document.getElementById('clear-transcript-btn');
const ttsAudioPlayer = document.getElementById('tts-audio-player');
const activeVoicePill = document.getElementById('active-voice-pill');

// Settings Drawer Elements
const settingsDrawer = document.getElementById('settings-drawer');
const settingsToggleBtn = document.getElementById('settings-toggle-btn');
const closeDrawerBtn = document.getElementById('close-drawer-btn');
const settingsForm = document.getElementById('settings-form');
const apiKeyInput = document.getElementById('settings-api-key');
const toggleKeyVisibility = document.getElementById('toggle-key-visibility');
const voiceSelect = document.getElementById('settings-voice');
const allowedDirsList = document.getElementById('allowed-dirs-list');
const addDirInput = document.getElementById('add-dir-input');
const addDirBtn = document.getElementById('add-dir-btn');

// Checkboxes
const checkboxOpenApp = document.getElementById('approve-open-app');
const checkboxWebSearch = document.getElementById('approve-web-search');
const checkboxReadFile = document.getElementById('approve-read-file');
const checkboxWriteFile = document.getElementById('approve-write-file');

// Provider & Ollama elements
const providerSelect = document.getElementById('settings-provider');
const geminiKeyGroup = document.getElementById('gemini-key-group');
const grokKeyGroup = document.getElementById('grok-key-group');
const grokKeyInput = document.getElementById('settings-grok-key');
const grokModelInput = document.getElementById('settings-grok-model');
const toggleGrokKeyVisibility = document.getElementById('toggle-grok-key-visibility');
const ollamaConfigGroup = document.getElementById('ollama-config-group');
const ollamaUrlInput = document.getElementById('settings-ollama-url');
const ollamaModelInput = document.getElementById('settings-ollama-model');

// Desktop actions confirmation modal elements
const confirmationModal = document.getElementById('confirmation-modal');
const actionPayloadContent = document.getElementById('action-payload-content');
const confirmDenyBtn = document.getElementById('confirm-deny-btn');
const confirmAlwaysBtn = document.getElementById('confirm-always-btn');
const confirmAllowBtn = document.getElementById('confirm-allow-btn');

// State Variables
let isListening = false;
let isSpeaking = false;
let isThinking = false;
let recognition = null;
let currentConfig = {
    has_key: false,
    provider: 'gemini',
    ollama_url: 'http://localhost:11434',
    ollama_model: 'llama3',
    voice: 'en-US-AndrewNeural',
    allow_dirs: [],
    pre_approved: []
};

// 3D Dotted Sphere Visualizer Variables
let spherePoints = [];
const numPoints = 800; // particle count
let angleX = 0;
let angleY = 0;
let sphereState = 'idle'; // 'idle', 'listening', 'thinking', 'speaking'
let targetWaveIntensity = 0;
let currentWaveIntensity = 0;
let time = 0;

// Pending Confirmation Callback
let pendingActionCallback = null;

// Initialize Speech Recognition
function initSpeechRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
        logToTranscript('System', 'Web Speech API is not supported in this browser. Please use Chrome or Edge.', 'system');
        return;
    }
    
    recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = 'en-US';
    
    recognition.onstart = () => {
        isListening = true;
        setOrbState('listening', 'LISTENING', 'I\'m listening. Speak now...');
        const audioStatus = document.getElementById('diag-audio-status');
        if (audioStatus) audioStatus.textContent = 'RECORDING';
    };
    
    recognition.onresult = (event) => {
        let interimTranscript = '';
        let finalTranscript = '';
        
        for (let i = event.resultIndex; i < event.results.length; ++i) {
            if (event.results[i].isFinal) {
                finalTranscript += event.results[i][0].transcript;
            } else {
                interimTranscript += event.results[i][0].transcript;
            }
        }
        
        // Show what is being spoken in the status description
        if (interimTranscript) {
            currentStatusDesc.textContent = `"${interimTranscript}..."`;
        }
    };
    
    recognition.onerror = (event) => {
        console.error('Speech recognition error:', event.error);
        if (event.error !== 'no-speech') {
            logToTranscript('System', `Speech recognition error: ${event.error}`, 'system');
        }
        stopListening();
    };
    
    recognition.onend = () => {
        // If we were listening and recognition ended, check if we have a final transcript
        // If the user stopped talking, recognition triggers onend.
        isListening = false;
        
        // We will extract final transcript from the event results or just rely on a brief wait.
        // Actually, let's grab it on the final result event.
    };
    
    // Rewrite onresult to send final transcript
    recognition.onresult = (event) => {
        let finalTranscript = '';
        for (let i = event.resultIndex; i < event.results.length; ++i) {
            if (event.results[i].isFinal) {
                finalTranscript += event.results[i][0].transcript;
            } else {
                currentStatusDesc.textContent = `"${event.results[i][0].transcript}..."`;
            }
        }
        
        if (finalTranscript.trim()) {
            sendInput(finalTranscript);
        }
    };
}

function startListening() {
    if (isSpeaking) {
        ttsAudioPlayer.pause();
        isSpeaking = false;
    }
    if (recognition && !isListening) {
        try {
            recognition.start();
        } catch (e) {
            console.error(e);
        }
    }
}

function stopListening() {
    if (recognition && isListening) {
        recognition.stop();
        isListening = false;
        setOrbState('idle', 'STANDBY', 'Click the core or press Space to engage');
        const audioStatus = document.getElementById('diag-audio-status');
        if (audioStatus) audioStatus.textContent = 'STANDBY';
    }
}

function toggleListening() {
    if (isListening) {
        stopListening();
    } else {
        startListening();
    }
}

// WebSocket Connection Setup
function connectWebSocket() {
    console.log('Connecting to WebSocket:', socketUrl);
    socket = new WebSocket(socketUrl);
    
    socket.onopen = () => {
        connectionStatusDot.className = 'status-dot connected';
        connectionStatusText.textContent = 'NEURAL_LINK_ACTIVE';
        setOrbState('idle', 'STANDBY', 'Systems operational');
        
        const brainModeEl = document.getElementById('diag-brain-mode');
        if (brainModeEl) brainModeEl.textContent = currentConfig.provider ? currentConfig.provider.toUpperCase() : 'GEMINI';
    };
    
    socket.onmessage = (event) => {
        const data = JSON.parse(event.data);
        handleSocketMessage(data);
    };
    
    socket.onclose = () => {
        connectionStatusDot.className = 'status-dot disconnected';
        connectionStatusText.textContent = 'NEURAL_LINK_OFFLINE';
        setOrbState('idle', 'OFFLINE', 'Neural link lost. Reconnecting...');
        // Retry connection in 3 seconds
        setTimeout(connectWebSocket, 3000);
    };
    
    socket.onerror = (err) => {
        console.error('WebSocket Error:', err);
    };
}

function handleSocketMessage(data) {
    switch (data.type) {
        case 'system':
            logToTranscript('System', data.message, 'system');
            break;
        case 'status':
            updateStatusState(data.status);
            break;
        case 'assistant_reply':
            logToTranscript('Sopi', data.text, 'assistant');
            if (data.audio_url) {
                playAudioResponse(data.audio_url);
            }
            break;
        case 'wake_trigger':
            // Triggered by python background wake word listener
            logToTranscript('System', 'Wake word detected. Friday is listening...', 'system');
            startListening();
            break;
        case 'confirm_request':
            // Triggered when a desktop tool wants approval
            showConfirmationModal(data.payload, (decision, preApprove = false) => {
                socket.send(JSON.stringify({
                    type: 'confirm_response',
                    id: data.id,
                    decision: decision,
                    pre_approve: preApprove,
                    action_type: data.action_type
                }));
            });
            break;
        default:
            console.log('Unknown socket event:', data);
    }
}

function updateStatusState(status) {
    const audioStatus = document.getElementById('diag-audio-status');
    if (status === 'thinking') {
        isThinking = true;
        setOrbState('thinking', 'THINKING', 'Analyzing command sequence...');
        if (audioStatus) audioStatus.textContent = 'THINKING';
    } else if (status === 'speaking') {
        isSpeaking = true;
        setOrbState('speaking', 'SPEAKING', 'Vocalizing reply...');
        if (audioStatus) audioStatus.textContent = 'SPEAKING';
    } else if (status === 'idle') {
        isThinking = false;
        isSpeaking = false;
        setOrbState('idle', 'STANDBY', 'Systems standby');
        if (audioStatus) audioStatus.textContent = 'STANDBY';
    }
}

function playAudioResponse(url) {
    // Add cache busting param
    ttsAudioPlayer.src = url + '?t=' + new Date().getTime();
    ttsAudioPlayer.play()
        .then(() => {
            isSpeaking = true;
            setOrbState('speaking', 'SPEAKING', 'Vocalizing reply...');
            const audioStatus = document.getElementById('diag-audio-status');
            if (audioStatus) audioStatus.textContent = 'SPEAKING';
        })
        .catch(err => {
            console.error('Audio playback failed:', err);
            isSpeaking = false;
            setOrbState('idle', 'STANDBY', 'Systems standby');
            const audioStatus = document.getElementById('diag-audio-status');
            if (audioStatus) audioStatus.textContent = 'STANDBY';
        });
}

// Playback ends, return to standby
ttsAudioPlayer.onended = () => {
    isSpeaking = false;
    setOrbState('idle', 'STANDBY', 'Systems standby');
    const audioStatus = document.getElementById('diag-audio-status');
    if (audioStatus) audioStatus.textContent = 'STANDBY';
};

// UI orb state modifiers
function setOrbState(stateClass, label, desc) {
    sphereState = stateClass; // Update 3D canvas state!
    currentStatusTitle.textContent = label;
    currentStatusDesc.textContent = desc;
    
    // Automatically minimize chat panel during response, restore on standby
    if (stateClass === 'thinking' || stateClass === 'speaking') {
        setChatMinimized(true);
    } else if (stateClass === 'idle') {
        setChatMinimized(false);
    }
}

// Sending input helper
function sendInput(text) {
    if (!text.trim()) return;
    
    logToTranscript('You', text, 'user');
    
    if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({
            type: 'text_input',
            text: text
        }));
    } else {
        logToTranscript('System', 'Cannot send message. Backend is disconnected.', 'system');
    }
    
    textInput.value = '';
    stopListening();
}

// Log entries writer
function logToTranscript(sender, text, type) {
    const entry = document.createElement('div');
    entry.className = `log-entry ${type}-entry`;
    
    const now = new Date();
    const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    
    const timeEl = document.createElement('div');
    timeEl.className = 'log-time';
    timeEl.textContent = timeStr;
    
    const textEl = document.createElement('div');
    textEl.className = 'log-text';
    
    // Simple markdown formatting helper (replaces `code` and **bold** with elements)
    let formattedText = text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/`(.*?)`/g, '<code>$1</code>')
        // Convert [Title](URL) into custom citations
        .replace(/\[(.*?)\]\((https?:\/\/.*?)\)/g, '<a href="$2" target="_blank" class="citation-link"><i class="fa-solid fa-arrow-up-right-from-square"></i> $1</a>');
        
    textEl.innerHTML = formattedText;
    
    entry.appendChild(timeEl);
    entry.appendChild(textEl);
    
    transcriptViewport.appendChild(entry);
    transcriptViewport.scrollTop = transcriptViewport.scrollHeight;
}

// Settings Server API Sync
async function loadConfig() {
    try {
        let host = window.location.host;
        if (window.location.protocol === 'file:') {
            host = 'localhost:8000';
        }
        const res = await fetch(`http://${host}/api/config`);
        if (res.ok) {
            currentConfig = await res.json();
            updateSettingsUI();
        }
    } catch (e) {
        console.error('Error fetching config:', e);
    }
}

function updateSettingsUI() {
    providerSelect.value = currentConfig.provider || 'gemini';
    ollamaUrlInput.value = currentConfig.ollama_url || 'http://localhost:11434';
    ollamaModelInput.value = currentConfig.ollama_model || 'llama3';
    
    // Update Stark diagnostic screen
    const brainModeEl = document.getElementById('diag-brain-mode');
    if (brainModeEl) brainModeEl.textContent = providerSelect.value.toUpperCase();
    
    // Toggle field visibility depending on active provider
    if (providerSelect.value === 'gemini') {
        geminiKeyGroup.style.display = 'block';
        grokKeyGroup.style.display = 'none';
        ollamaConfigGroup.style.display = 'none';
    } else if (providerSelect.value === 'grok') {
        geminiKeyGroup.style.display = 'none';
        grokKeyGroup.style.display = 'block';
        ollamaConfigGroup.style.display = 'none';
    } else if (providerSelect.value === 'ollama') {
        geminiKeyGroup.style.display = 'none';
        grokKeyGroup.style.display = 'none';
        ollamaConfigGroup.style.display = 'block';
    } else {
        geminiKeyGroup.style.display = 'none';
        grokKeyGroup.style.display = 'none';
        ollamaConfigGroup.style.display = 'none';
    }
    
    apiKeyInput.value = currentConfig.has_key ? '••••••••••••••••' : '';
    grokKeyInput.value = currentConfig.has_grok_key ? '••••••••••••••••' : '';
    grokModelInput.value = currentConfig.grok_model || 'grok-4.5';
    voiceSelect.value = currentConfig.voice;
    activeVoicePill.innerHTML = `<i class="fa-solid fa-volume-high"></i> Voice: ${currentConfig.voice.split('-')[2].replace('Neural', '')}`;
    
    // Directory list render
    allowedDirsList.innerHTML = '';
    currentConfig.allow_dirs.forEach((dir, index) => {
        const item = document.createElement('div');
        item.className = 'list-item';
        item.innerHTML = `
            <span>${dir}</span>
            <button type="button" onclick="removeDirectory(${index})"><i class="fa-solid fa-trash"></i></button>
        `;
        allowedDirsList.appendChild(item);
    });
    
    // Checkbox mapping
    checkboxOpenApp.checked = currentConfig.pre_approved.includes('open_app');
    checkboxWebSearch.checked = currentConfig.pre_approved.includes('web_search');
    checkboxReadFile.checked = currentConfig.pre_approved.includes('read_file');
    checkboxWriteFile.checked = currentConfig.pre_approved.includes('write_file');
}

// Add onchange handler to dynamically adjust inputs in settings panel
providerSelect.onchange = () => {
    const val = providerSelect.value;
    if (val === 'gemini') {
        geminiKeyGroup.style.display = 'block';
        grokKeyGroup.style.display = 'none';
        ollamaConfigGroup.style.display = 'none';
    } else if (val === 'grok') {
        geminiKeyGroup.style.display = 'none';
        grokKeyGroup.style.display = 'block';
        ollamaConfigGroup.style.display = 'none';
    } else if (val === 'ollama') {
        geminiKeyGroup.style.display = 'none';
        grokKeyGroup.style.display = 'none';
        ollamaConfigGroup.style.display = 'block';
    } else {
        geminiKeyGroup.style.display = 'none';
        grokKeyGroup.style.display = 'none';
        ollamaConfigGroup.style.display = 'none';
    }
};

async function saveConfig(event) {
    if (event) event.preventDefault();
    
    const preApproved = [];
    if (checkboxOpenApp.checked) preApproved.push('open_app');
    if (checkboxWebSearch.checked) preApproved.push('web_search');
    if (checkboxReadFile.checked) preApproved.push('read_file');
    if (checkboxWriteFile.checked) preApproved.push('write_file');
    
    const payload = {
        provider: providerSelect.value,
        ollama_url: ollamaUrlInput.value,
        ollama_model: ollamaModelInput.value,
        grok_model: grokModelInput.value,
        voice: voiceSelect.value,
        allow_dirs: currentConfig.allow_dirs,
        pre_approved: preApproved
    };
    
    // Send API Key only if user typed a new one (not the placeholders)
    if (apiKeyInput.value && apiKeyInput.value !== '••••••••••••••••') {
        payload.gemini_key = apiKeyInput.value;
    }
    if (grokKeyInput.value && grokKeyInput.value !== '••••••••••••••••') {
        payload.grok_key = grokKeyInput.value;
    }
    
    try {
        let host = window.location.host;
        if (window.location.protocol === 'file:') {
            host = 'localhost:8000';
        }
        const res = await fetch(`http://${host}/api/config`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        
        if (res.ok) {
            currentConfig = (await res.json()).config;
            updateSettingsUI();
            logToTranscript('System', `Settings saved. Brain switched to ${currentConfig.provider.toUpperCase()} mode.`, 'system');
            closeDrawer();
        } else {
            const err = await res.json();
            alert(`Error saving settings: ${err.detail}`);
        }
    } catch (e) {
        console.error('Error saving config:', e);
        alert('Could not connect to backend to save settings.');
    }
}

window.removeDirectory = (index) => {
    currentConfig.allow_dirs.splice(index, 1);
    updateSettingsUI();
};

// Add folder helper
addDirBtn.onclick = () => {
    const path = addDirInput.value.trim();
    if (path) {
        if (!currentConfig.allow_dirs.includes(path)) {
            currentConfig.allow_dirs.push(path);
            updateSettingsUI();
        }
        addDirInput.value = '';
    }
};

// Drawer controls
function openDrawer() {
    settingsDrawer.classList.add('open');
}

function closeDrawer() {
    settingsDrawer.classList.remove('open');
}

// Modal handling
function showConfirmationModal(payload, callback) {
    actionPayloadContent.textContent = typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2);
    confirmationModal.classList.add('show');
    pendingActionCallback = callback;
}

function handleConfirmation(decision, preApprove = false) {
    confirmationModal.classList.remove('show');
    if (pendingActionCallback) {
        pendingActionCallback(decision, preApprove);
        pendingActionCallback = null;
    }
}

// Set up UI event listeners
orb.onclick = toggleListening;
sendBtn.onclick = () => sendInput(textInput.value);
textInput.onkeydown = (e) => {
    if (e.key === 'Enter') {
        sendInput(textInput.value);
    }
};

clearTranscriptBtn.onclick = () => {
    transcriptViewport.innerHTML = '';
    logToTranscript('System', 'Conversation logs cleared.', 'system');
};

settingsToggleBtn.onclick = openDrawer;
closeDrawerBtn.onclick = closeDrawer;
settingsForm.onsubmit = saveConfig;

// Eye icon visibility toggle
toggleKeyVisibility.onclick = () => {
    const isPassword = apiKeyInput.type === 'password';
    apiKeyInput.type = isPassword ? 'text' : 'password';
    toggleKeyVisibility.querySelector('i').className = isPassword ? 'fa-solid fa-eye-slash' : 'fa-solid fa-eye';
};

toggleGrokKeyVisibility.onclick = () => {
    const isPassword = grokKeyInput.type === 'password';
    grokKeyInput.type = isPassword ? 'text' : 'password';
    toggleGrokKeyVisibility.querySelector('i').className = isPassword ? 'fa-solid fa-eye-slash' : 'fa-solid fa-eye';
};

// Modal buttons
confirmAllowBtn.onclick = () => handleConfirmation('allow');
confirmDenyBtn.onclick = () => handleConfirmation('deny');
confirmAlwaysBtn.onclick = () => handleConfirmation('allow', true);

// Logs modal triggers
async function showLogs() {
    closeDrawer();
    const logsModal = document.getElementById('logs-modal');
    const logsListContent = document.getElementById('logs-list-content');
    
    logsListContent.textContent = "Loading safety logs...";
    logsModal.classList.add('show');
    
    try {
        let host = window.location.host;
        if (window.location.protocol === 'file:') {
            host = 'localhost:8000';
        }
        const res = await fetch(`http://${host}/api/logs`);
        if (res.ok) {
            const logs = await res.json();
            if (logs.length === 0) {
                logsListContent.textContent = "No actions logged yet.";
                return;
            }
            
            let logsHtml = "";
            [...logs].reverse().forEach(log => {
                const date = new Date(log.timestamp).toLocaleString();
                const argsStr = JSON.stringify(log.arguments);
                let statusColor = '#f59e0b'; // warning orange for allowed_once / pending
                if (log.status === 'denied') statusColor = '#ef4444';
                if (log.status === 'pre_approved') statusColor = '#10b981';
                
                logsHtml += `[${date}] Tool: <strong>${log.tool}</strong>\n`;
                logsHtml += `  Command: "${log.command}"\n`;
                logsHtml += `  Arguments: ${argsStr}\n`;
                logsHtml += `  Permission: <span style="color: ${statusColor}; font-weight: bold;">${log.status.toUpperCase()}</span>\n`;
                logsHtml += `  Result: ${log.result}\n`;
                logsHtml += `------------------------------------------------------------\n`;
            });
            logsListContent.innerHTML = logsHtml;
        } else {
            logsListContent.textContent = "Error fetching safety logs from backend.";
        }
    } catch (e) {
        console.error(e);
        logsListContent.textContent = "Failed to connect to backend to fetch safety logs.";
    }
}

document.getElementById('view-logs-btn').onclick = showLogs;
document.getElementById('close-logs-btn').onclick = () => document.getElementById('logs-modal').classList.remove('show');

// Hotkey: Spacebar toggles listening (if not focused on inputs)
document.onkeydown = (e) => {
    if (e.code === 'Space' && document.activeElement !== textInput && document.activeElement !== apiKeyInput && document.activeElement !== addDirInput) {
        // Prevent default space page-scroll behavior
        e.preventDefault();
        if (!isListening) {
            startListening();
        }
    }
};

document.onkeyup = (e) => {
    if (e.code === 'Space' && document.activeElement !== textInput && document.activeElement !== apiKeyInput && document.activeElement !== addDirInput) {
        e.preventDefault();
    }
};

// Fibonacci 3D Dotted Sphere Renderer
function initSphere() {
    spherePoints = [];
    for (let i = 0; i < numPoints; i++) {
        // Distribute points evenly using Fibonacci sphere formula
        const y = 1 - (i / (numPoints - 1)) * 2;
        const radius = Math.sqrt(1 - y * y);
        const theta = i * Math.PI * (3 - Math.sqrt(5)); // Golden angle
        const x = Math.cos(theta) * radius;
        const z = Math.sin(theta) * radius;
        spherePoints.push({ x, y, z });
    }
}

function drawSphere() {
    const canvas = document.getElementById('sopi-canvas');
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    const baseRadius = 75; // screen radius size of sphere
    const cameraDistance = 3.6;
    const fov = 350; // perspective fov
    
    // Morph settings based on current state (very slow movement)
    if (sphereState === 'idle') {
        targetWaveIntensity = 0.02; // calm breathing ripple
        angleY += 0.0012; // extremely slow Y rotation
        angleX += 0.0004; // extremely slow X rotation
    } else if (sphereState === 'listening') {
        targetWaveIntensity = 0.16; // wavy morphing bubble
        angleY += 0.0018;
        angleX += 0.0006;
    } else if (sphereState === 'thinking') {
        targetWaveIntensity = 0.04; // slow, elegant thinking ripple
        angleY += 0.005;
        angleX += 0.0015;
    } else if (sphereState === 'speaking') {
        targetWaveIntensity = 0.22; // voice modulation ripples
        angleY += 0.002;
        angleX += 0.0008;
    } else if (sphereState === 'offline') {
        targetWaveIntensity = 0.005;
        angleY += 0.0002;
        angleX += 0.0001;
    }
    
    // Interpolate wave distortion smoothly
    currentWaveIntensity += (targetWaveIntensity - currentWaveIntensity) * 0.05;
    time += 0.012; // much slower ripple cycle
    
    const projectedPoints = [];
    
    for (let i = 0; i < spherePoints.length; i++) {
        const p = spherePoints[i];
        
        // 1. Calculate wave deformation depending on current state
        let wave = 0;
        if (sphereState === 'listening') {
            // Wavy organic sphere deformation
            wave = Math.sin(p.y * 6 + time * 5.0) * Math.cos(p.x * 6 + time * 4.0);
        } else if (sphereState === 'thinking') {
            // High-frequency ripple
            wave = Math.sin(time * 12.0) * Math.cos(p.z * 7 + time * 10.0) * 0.4;
        } else if (sphereState === 'speaking') {
            // Voice bubble fluctuations (like standard speech waveforms)
            wave = Math.sin(p.y * 8 + time * 7.0) * Math.cos(p.x * 8 + time * 6.0);
        } else {
            // Slow, calm organic breathing
            wave = Math.sin(p.y * 3.5 + time * 1.5) * 0.18;
        }
        
        const r = 1 + wave * currentWaveIntensity;
        const curX = p.x * r;
        const curY = p.y * r;
        const curZ = p.z * r;
        
        // 2. Rotate points in 3D
        // Rotate Y axis
        const cosY = Math.cos(angleY), sinY = Math.sin(angleY);
        const x1 = curX * cosY - curZ * sinY;
        const z1 = curX * sinY + curZ * cosY;
        
        // Rotate X axis
        const cosX = Math.cos(angleX), sinX = Math.sin(angleX);
        const y2 = curY * cosX - z1 * sinX;
        const z2 = curY * sinX + z1 * cosX;
        
        projectedPoints.push({ x1, y2, z2 });
    }
    
    // Sort by depth (Painter's algorithm: draw back-most particles first)
    projectedPoints.sort((a, b) => a.z2 - b.z2);
    
    // Render particles
    for (let i = 0; i < projectedPoints.length; i++) {
        const p = projectedPoints[i];
        
        // Scale and project 3D point to 2D screen coordinates
        const scale = fov / (cameraDistance + p.z2);
        const screenX = centerX + p.x1 * scale;
        const screenY = centerY + p.y2 * scale;
        
        // Compute depth shading (alpha and particle size)
        // z2 ranges roughly from -1.3 to 1.3
        const depth = (p.z2 + 1.3) / 2.6; // normalized 0..1
        const alpha = Math.max(0.08, Math.min(1.0, depth * 0.85 + 0.15));
        const size = Math.max(0.6, Math.min(2.5, depth * 1.8 + 0.5));
        
        // Monochrome white rendering
        ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
        ctx.beginPath();
        ctx.arc(screenX, screenY, size, 0, Math.PI * 2);
        ctx.fill();
    }
    
    requestAnimationFrame(drawSphere);
}

// Chat Panel Collapse / Minimize Logic
function setChatMinimized(minimized) {
    const mainContainer = document.querySelector('.glass-container');
    const expandChatBtn = document.getElementById('expand-chat-btn');
    if (!mainContainer) return;
    
    if (minimized) {
        mainContainer.classList.add('chat-minimized');
        if (expandChatBtn) expandChatBtn.style.display = 'flex';
    } else {
        mainContainer.classList.remove('chat-minimized');
        if (expandChatBtn) expandChatBtn.style.display = 'none';
    }
}

// Bind Minimize / Expand Panel Buttons
const minimizeChatBtn = document.getElementById('minimize-chat-btn');
const expandChatBtn = document.getElementById('expand-chat-btn');
if (minimizeChatBtn) minimizeChatBtn.onclick = () => setChatMinimized(true);
if (expandChatBtn) expandChatBtn.onclick = () => setChatMinimized(false);

// Initial Setup
window.onload = () => {
    initSpeechRecognition();
    connectWebSocket();
    loadConfig();
    initSphere();
    drawSphere();
    setChatMinimized(false); // Default to visible on start
};
