document.addEventListener('DOMContentLoaded', () => {
    // UI Elements
    const wakeTimeInput = document.getElementById('wake-time');
    const startBtn = document.getElementById('start-btn');
    const stopBtn = document.getElementById('stop-btn');
    const statusDisplay = document.getElementById('status-display');
    const statusText = document.getElementById('status-text');
    const countdownText = document.getElementById('countdown-text');

    const whiteNoiseSelect = document.getElementById('white-noise-select');
    const alarmSelect = document.getElementById('alarm-select');
    const uploadNoise = document.getElementById('upload-noise');
    const uploadAlarm = document.getElementById('upload-alarm');
    const testNoiseBtn = document.getElementById('test-noise-btn');
    const testAlarmBtn = document.getElementById('test-alarm-btn');
    const noiseVolumeInput = document.getElementById('noise-volume');
    const alarmVolumeInput = document.getElementById('alarm-volume');

    // Network Elements
    const networkBtn = document.getElementById('network-btn');
    const networkModal = document.getElementById('network-modal');
    const closeModalBtn = document.getElementById('close-modal-btn');
    const sessionTagInput = document.getElementById('session-tag');
    const hostSessionBtn = document.getElementById('host-session-btn');
    const joinSessionBtn = document.getElementById('join-session-btn');
    const leaveSessionBtn = document.getElementById('leave-session-btn');
    const networkStatusText = document.getElementById('network-status-text');
    const sessionSetupView = document.getElementById('session-setup-view');
    const sessionActiveView = document.getElementById('session-active-view');

    let peer = null;
    let peerConnections = [];
    let networkRole = 'none';
    let currentHostId = null;
    let wakeLock = null;

    // IndexedDB Setup for Custom Sounds
    const DB_NAME = 'LullabarkDB';
    const DB_VERSION = 1;
    const STORE_NAME = 'sounds';

    function openDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);
            request.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    db.createObjectStore(STORE_NAME, { keyPath: 'id' });
                }
            };
            request.onsuccess = (e) => resolve(e.target.result);
            request.onerror = (e) => reject(e.target.error);
        });
    }

    async function saveSound(id, name, type, blob) {
        try {
            const db = await openDB();
            return new Promise((resolve, reject) => {
                const transaction = db.transaction(STORE_NAME, 'readwrite');
                const store = transaction.objectStore(STORE_NAME);
                const request = store.put({ id, name, type, blob });
                request.onsuccess = () => resolve();
                request.onerror = (e) => reject(e.target.error);
            });
        } catch (err) {
            console.error('Failed to save sound to IndexedDB:', err);
        }
    }

    async function getAllSounds() {
        try {
            const db = await openDB();
            return new Promise((resolve, reject) => {
                const transaction = db.transaction(STORE_NAME, 'readonly');
                const store = transaction.objectStore(STORE_NAME);
                const request = store.getAll();
                request.onsuccess = (e) => resolve(e.target.result);
                request.onerror = (e) => reject(e.target.error);
            });
        } catch (err) {
            console.error('Failed to get sounds from IndexedDB:', err);
            return [];
        }
    }

    async function deleteSound(id) {
        try {
            const db = await openDB();
            return new Promise((resolve, reject) => {
                const transaction = db.transaction(STORE_NAME, 'readwrite');
                const store = transaction.objectStore(STORE_NAME);
                const request = store.delete(id);
                request.onsuccess = () => resolve();
                request.onerror = (e) => reject(e.target.error);
            });
        } catch (err) {
            console.error('Failed to delete sound from IndexedDB:', err);
        }
    }

    // Load volume settings from localStorage or default to 50%
    const savedNoiseVol = localStorage.getItem('noiseVolume');
    const savedAlarmVol = localStorage.getItem('alarmVolume');
    noiseVolumeInput.value = savedNoiseVol !== null ? parseFloat(savedNoiseVol) : 0.5;
    alarmVolumeInput.value = savedAlarmVol !== null ? parseFloat(savedAlarmVol) : 0.5;

    // Helper to select an option in a dropdown safely
    function restoreSelectedOption(selectElement, savedId) {
        for (let i = 0; i < selectElement.options.length; i++) {
            const opt = selectElement.options[i];
            if (opt.getAttribute('data-id') === savedId || opt.value === savedId) {
                selectElement.selectedIndex = i;
                selectElement.dispatchEvent(new Event('change', { bubbles: true }));
                return;
            }
        }
    }

    // Load custom sounds from database
    async function loadCustomSounds() {
        let sounds = [];
        try {
            sounds = await getAllSounds();
        } catch (e) {
            console.error("Failed to load sounds from IndexedDB:", e);
            return;
        }

        const savedNoiseId = localStorage.getItem('selectedNoiseId');
        const savedAlarmId = localStorage.getItem('selectedAlarmId');
        
        let noiseSelected = false;
        let alarmSelected = false;

        for (const sound of sounds) {
            try {
                if (!sound || !sound.blob) {
                    throw new Error("Invalid sound record or empty blob");
                }
                const objectURL = URL.createObjectURL(sound.blob);
                const option = document.createElement('option');
                option.value = objectURL;
                option.text = `Custom: ${sound.name}`;
                option.setAttribute('data-id', sound.id);

                if (sound.type === 'noise') {
                    whiteNoiseSelect.appendChild(option);
                    if (sound.id === savedNoiseId) {
                        whiteNoiseSelect.value = objectURL;
                        noiseSelected = true;
                    }
                } else if (sound.type === 'alarm') {
                    alarmSelect.appendChild(option);
                    if (sound.id === savedAlarmId) {
                        alarmSelect.value = objectURL;
                        alarmSelected = true;
                    }
                }
            } catch (err) {
                console.error(`Error processing custom sound "${sound ? sound.name : 'unknown'}":`, err);
                // Self-heal: Delete corrupt sound so it won't crash on future reloads
                if (sound && sound.id) {
                    deleteSound(sound.id).catch(e => console.error("IndexedDB delete sound failed", e));
                }
            }
        }

        // Fallback or select defaults if no custom sound matches
        if (!noiseSelected && savedNoiseId) {
            for (let i = 0; i < whiteNoiseSelect.options.length; i++) {
                if (whiteNoiseSelect.options[i].value === savedNoiseId) {
                    whiteNoiseSelect.selectedIndex = i;
                    break;
                }
            }
        }
        if (!alarmSelected && savedAlarmId) {
            for (let i = 0; i < alarmSelect.options.length; i++) {
                if (alarmSelect.options[i].value === savedAlarmId) {
                    alarmSelect.selectedIndex = i;
                    break;
                }
            }
        }
    }

    // Synchronization function to broadcast state changes to Panopticon parent
    function syncStateToPanopticon() {
        if (window.parent === window) return;

        const selectedNoiseOption = whiteNoiseSelect.options[whiteNoiseSelect.selectedIndex];
        const noiseId = selectedNoiseOption ? (selectedNoiseOption.getAttribute('data-id') || whiteNoiseSelect.value) : whiteNoiseSelect.value;
        
        const selectedAlarmOption = alarmSelect.options[alarmSelect.selectedIndex];
        const alarmId = selectedAlarmOption ? (selectedAlarmOption.getAttribute('data-id') || alarmSelect.value) : alarmSelect.value;

        const state = {
            noiseVolume: noiseVolumeInput.value,
            alarmVolume: alarmVolumeInput.value,
            selectedNoiseId: noiseId,
            selectedAlarmId: alarmId
        };
        
        window.parent.postMessage({
            type: 'PANOPTICON_SYNC',
            payload: state
        }, '*');
    }

    // Handle Panopticon state loaded event
    window.addEventListener('message', (event) => {
        const { type, payload } = event.data || {};
        if (type === 'PANOPTICON_LOAD' && payload) {
            if (payload.noiseVolume !== undefined) {
                noiseVolumeInput.value = payload.noiseVolume;
                localStorage.setItem('noiseVolume', payload.noiseVolume);
                noiseVolumeInput.dispatchEvent(new Event('input', { bubbles: true }));
            }
            if (payload.alarmVolume !== undefined) {
                alarmVolumeInput.value = payload.alarmVolume;
                localStorage.setItem('alarmVolume', payload.alarmVolume);
                alarmVolumeInput.dispatchEvent(new Event('input', { bubbles: true }));
            }
            if (payload.selectedNoiseId !== undefined) {
                localStorage.setItem('selectedNoiseId', payload.selectedNoiseId);
                restoreSelectedOption(whiteNoiseSelect, payload.selectedNoiseId);
            }
            if (payload.selectedAlarmId !== undefined) {
                localStorage.setItem('selectedAlarmId', payload.selectedAlarmId);
                restoreSelectedOption(alarmSelect, payload.selectedAlarmId);
            }
        }
    });

    // Initialize application and announce availability to Panopticon
    async function initializeApp() {
        try {
            await loadCustomSounds();
        } catch (err) {
            console.error("Failed to load custom sounds:", err);
        }
        
        if (window.parent !== window) {
            window.parent.postMessage({ type: 'PANOPTICON_READY' }, '*');
        }
    }
    initializeApp();

    function showToast(message) {
        let toast = document.getElementById('toast-notification');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'toast-notification';
            document.body.appendChild(toast);
        }
        toast.innerText = message;
        toast.className = 'toast show';
        setTimeout(() => { toast.classList.remove('show'); }, 4000);
    }

    async function requestWakeLock() {
        try {
            if ('wakeLock' in navigator && !wakeLock) {
                wakeLock = await navigator.wakeLock.request('screen');
                console.log('Wake Lock active');
                wakeLock.addEventListener('release', () => {
                    console.log('Wake Lock released');
                });
            }
        } catch (err) {
            console.error('Wake Lock error:', err);
        }
    }

    function releaseWakeLock() {
        if (wakeLock !== null) {
            wakeLock.release();
            wakeLock = null;
        }
    }

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && isSleepMode) {
            requestWakeLock();
        }
    });

    networkBtn.addEventListener('click', () => networkModal.classList.remove('hidden'));
    closeModalBtn.addEventListener('click', () => networkModal.classList.add('hidden'));

    function updateNetworkUI(status, role, code = '') {
        const modalSubtitle = document.getElementById('modal-subtitle');
        const hostCodeDisplay = document.getElementById('host-code-display');

        networkBtn.classList.remove('icon-btn-host', 'icon-btn-client');
        if (role === 'Host') {
            networkBtn.classList.add('icon-btn-host');
        } else if (role === 'Client') {
            networkBtn.classList.add('icon-btn-client');
        }

        if (role === 'none') {
            networkStatusText.innerHTML = `Status: <strong>Disconnected</strong>`;
            sessionSetupView.classList.remove('hidden');
            sessionActiveView.classList.add('hidden');
            modalSubtitle.textContent = 'Sync across devices';
            modalSubtitle.style.display = 'block';
            hostCodeDisplay.classList.add('hidden');
            hostCodeDisplay.innerHTML = '';
        } else if (role === 'Host') {
            networkStatusText.innerHTML = `Status: <strong>Hosting</strong>`;
            sessionSetupView.classList.add('hidden');
            sessionActiveView.classList.remove('hidden');
            modalSubtitle.textContent = 'Session Code';
            modalSubtitle.style.display = 'block';
            hostCodeDisplay.classList.remove('hidden');
            
            if (code && hostCodeDisplay.innerHTML === '') {
                hostCodeDisplay.innerHTML = code.split('').map(char => `<div class="code-box">${char}</div>`).join('');
            }
        } else if (role === 'Client') {
            networkStatusText.innerHTML = `Status: <strong>${status}</strong>`;
            sessionSetupView.classList.add('hidden');
            sessionActiveView.classList.remove('hidden');
            modalSubtitle.style.display = 'none';
            hostCodeDisplay.classList.add('hidden');
        }
    }

    let currentHostCode = '';

    hostSessionBtn.addEventListener('click', () => {
        const code = Math.random().toString(36).substring(2, 6).toUpperCase();
        currentHostCode = code;
        initHostPeer();
    });

    function initHostPeer() {
        const peerId = `lullabark-session-${currentHostCode}`;
        if (peer) peer.destroy();
        peer = new Peer(peerId);
        const thisPeer = peer;
        networkRole = 'host';
        
        updateNetworkUI('Initializing Host...', 'Host');
        
        thisPeer.on('open', () => {
            if (thisPeer !== peer) return;
            updateNetworkUI('Hosting', 'Host', currentHostCode);
            sessionTagInput.value = '';
        });
        thisPeer.on('disconnected', () => {
            if (thisPeer !== peer) return;
            console.log('Host disconnected from signaling server, reconnecting...');
            thisPeer.reconnect();
        });
        thisPeer.on('connection', (conn) => {
            if (thisPeer !== peer) return;
            peerConnections.push(conn);
            conn.on('data', (data) => handleNetworkMessage(data, conn));
            conn.on('open', () => broadcastState());
            conn.on('close', () => { 
                peerConnections = peerConnections.filter(c => c !== conn); 
            });
            conn.on('error', err => console.error(err));
        });
        thisPeer.on('error', (err) => { 
            if (thisPeer !== peer) return;
            if (err.type === 'unavailable-id') {
                showToast("Generating new code...");
                currentHostCode = Math.random().toString(36).substring(2, 6).toUpperCase();
                initHostPeer();
            } else if (err.type === 'network') {
                showToast("Network Error... reconnecting");
            } else {
                showToast("Network Error: " + err.type); 
                cleanupNetwork(); 
            }
        });
    }

    let clientBaseTag = '';

    joinSessionBtn.addEventListener('click', () => {
        const tag = sessionTagInput.value.trim().toUpperCase();
        if (!tag) return showToast("Please enter a session code!");
        clientBaseTag = tag;
        initClientPeer();
    });

    function initClientPeer() {
        if (peer) peer.destroy();
        peer = new Peer();
        const thisPeer = peer;
        networkRole = 'client';
        updateNetworkUI('Connecting...', 'Client');

        thisPeer.on('open', () => {
            if (thisPeer !== peer) return;
            connectToHost();
        });
        thisPeer.on('disconnected', () => {
            if (thisPeer !== peer) return;
            console.log('Client disconnected from server, reconnecting...');
            thisPeer.reconnect();
        });
        thisPeer.on('error', (err) => { 
            if (thisPeer !== peer) return;
            if (err.type === 'peer-unavailable') {
                showToast("Host code not found. Retrying in 5s...");
                setTimeout(() => { if (thisPeer === peer && networkRole === 'client') initClientPeer(); }, 5000);
            } else if (err.type === 'network') {
                showToast("Network Error... reconnecting");
            } else {
                showToast("Network Error: " + err.type); 
                cleanupNetwork(); 
            }
        });
    }

    function connectToHost() {
        if (networkRole !== 'client' || !peer) return;
        currentHostId = `lullabark-session-${clientBaseTag}`;
        
        const conn = peer.connect(currentHostId);
        peerConnections = [conn];
        
        let connectionTimeout = setTimeout(() => {
            if (!peerConnections.includes(conn) || networkRole !== 'client') return;
            console.log(`Connection to ${currentHostId} timed out.`);
            conn.close();
            showToast("Host not responding. Retrying in 5s...");
            setTimeout(() => { if (networkRole === 'client') initClientPeer(); }, 5000);
        }, 5000);
        
        conn.on('open', () => {
            clearTimeout(connectionTimeout);
            if (!peerConnections.includes(conn)) return;
            updateNetworkUI(`Joined (${clientBaseTag})`, 'Client');
            sessionTagInput.value = '';
        });
        conn.on('data', (data) => {
            if (!peerConnections.includes(conn)) return;
            handleNetworkMessage(data, conn);
        });
        conn.on('close', () => { 
            clearTimeout(connectionTimeout);
            if (!currentHostId || !peerConnections.includes(conn)) return;
            showToast("Disconnected from host. Reconnecting..."); 
            updateNetworkUI('Reconnecting...', 'Client');
            
            setTimeout(connectToHost, 3000);
        });
        conn.on('error', err => {
            console.error('Connection error:', err);
            clearTimeout(connectionTimeout);
        });
    }

    leaveSessionBtn.addEventListener('click', () => {
        currentHostId = null;
        cleanupNetwork();
    });

    function cleanupNetwork() {
        currentHostId = null;
        if (peerConnections.length > 0) {
            peerConnections.forEach(conn => conn.close());
        }
        peerConnections = [];
        if (peer) { 
            peer.destroy(); 
            peer = null; 
        }
        networkRole = 'none';
        updateNetworkUI('Disconnected', 'none');
        resetApp(true);
        wakeTimeInput.value = '';
    }

    function broadcastState() {
        if (networkRole !== 'host') return;
        const state = {
            isSleepMode,
            wakeTime: wakeTimeInput.value,
            noiseVolume: noiseVolumeInput.value,
            alarmVolume: alarmVolumeInput.value
        };
        peerConnections.forEach(conn => {
            if (conn.open) conn.send({ type: 'STATE', state });
        });
    }

    function sendCommand(cmd, payload) {
        if (networkRole !== 'client' || peerConnections.length === 0) return;
        const conn = peerConnections[0];
        if (conn && conn.open) conn.send({ type: 'CMD', cmd, payload });
    }

    function handleNetworkMessage(data, conn) {
        if (networkRole === 'client' && data.type === 'STATE') {
            const state = data.state;
            wakeTimeInput.value = state.wakeTime;
            noiseVolumeInput.value = state.noiseVolume;
            alarmVolumeInput.value = state.alarmVolume;

            if (state.isSleepMode && !isSleepMode) {
                const [hours, minutes] = state.wakeTime.split(':').map(Number);
                const now = new Date();
                targetTime = new Date();
                targetTime.setHours(hours, minutes, 0, 0);
                if (targetTime < now) targetTime.setDate(targetTime.getDate() + 1);
                startSleepMode(true);
            } else if (!state.isSleepMode && isSleepMode) {
                resetApp(true);
            }
        } else if (networkRole === 'host' && data.type === 'CMD') {
            if (data.cmd === 'START') {
                if (!isSleepMode) startBtn.click();
            } else if (data.cmd === 'STOP') {
                if (isSleepMode) stopBtn.click();
            } else if (data.cmd === 'UPDATE_TIME') {
                wakeTimeInput.value = data.payload;
                broadcastState();
            } else if (data.cmd === 'UPDATE_NOISE_VOL') {
                noiseVolumeInput.value = data.payload;
                noiseVolumeInput.dispatchEvent(new Event('input', {bubbles:true}));
                broadcastState();
            } else if (data.cmd === 'UPDATE_ALARM_VOL') {
                alarmVolumeInput.value = data.payload;
                alarmVolumeInput.dispatchEvent(new Event('input', {bubbles:true}));
                broadcastState();
            }
        }
    }

    // Audio Objects
    const noiseAudios = [
        new Audio(whiteNoiseSelect.value),
        new Audio(whiteNoiseSelect.value)
    ];
    noiseAudios.forEach(a => a.loop = false);
    let activeNoiseIndex = 0;
    
    noiseAudios.forEach((audio, index) => {
        audio.addEventListener('timeupdate', () => {
            if (!isSleepMode) return;
            if (index !== activeNoiseIndex) return; // Only monitor the active one
            
            // Check if duration is valid and we are within 3 seconds of the end
            if (audio.duration && (audio.duration - audio.currentTime <= 3.0) && !audio.isFadingOut) {
                audio.isFadingOut = true;
                
                // Fade out current
                fadeAudioOut(audio, 3000);
                
                // Switch active index and start next
                activeNoiseIndex = 1 - activeNoiseIndex;
                const nextAudio = noiseAudios[activeNoiseIndex];
                nextAudio.isFadingOut = false;
                nextAudio.currentTime = 0;
                nextAudio.volume = 0;
                nextAudio.play().catch(e => console.error("Crossfade playback failed", e));
                fadeAudioIn(nextAudio, 3000, parseFloat(noiseVolumeInput.value));
            }
        });
    });
    
    // For alarm, use 4 audio elements to artificially boost the volume without Web Audio API (which fails on file://)
    const alarmAudios = [
        new Audio(alarmSelect.value),
        new Audio(alarmSelect.value),
        new Audio(alarmSelect.value),
        new Audio(alarmSelect.value)
    ];
    alarmAudios.forEach(a => a.loop = false);

    // Communication with Panopticon parent shell
    function updateParentAudioState() {
        const isPlaying = noiseAudios.some(a => !a.paused && !a.ended && a.currentTime > 0) ||
                          alarmAudios.some(a => !a.paused && !a.ended && a.currentTime > 0);
        window.parent.postMessage({
            type: 'PANOPTICON_AUDIO_PLAYING',
            payload: { isPlaying }
        }, '*');
    }

    // Attach listeners to all audio elements to automatically sync playing state
    [...noiseAudios, ...alarmAudios].forEach(audio => {
        audio.addEventListener('play', updateParentAudioState);
        audio.addEventListener('pause', updateParentAudioState);
        audio.addEventListener('ended', updateParentAudioState);
    });

    // State
    let isSleepMode = false;
    let timerInterval = null;
    let targetTime = null;
    let alarmPlayCount = 0;
    const MAX_ALARM_PLAYS = 1;

    // Handle File Uploads
    function handleFileUpload(input, selectElement, labelPrefix, type) {
        input.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (file) {
                const id = `custom_${type}_${Date.now()}`;
                const objectURL = URL.createObjectURL(file);
                
                const option = document.createElement('option');
                option.value = objectURL;
                option.text = `${labelPrefix}: ${file.name}`;
                option.setAttribute('data-id', id);
                
                selectElement.appendChild(option);
                selectElement.value = objectURL; // Auto-select the newly uploaded file
                
                // Save selection in localStorage
                localStorage.setItem(`selected${type === 'noise' ? 'Noise' : 'Alarm'}Id`, id);
                syncStateToPanopticon();
                
                // Save to IndexedDB
                try {
                    await saveSound(id, file.name, type, file);
                } catch (err) {
                    console.error("Failed to save uploaded file to IndexedDB:", err);
                }
            }
        });
    }

    handleFileUpload(uploadNoise, whiteNoiseSelect, "Custom", "noise");
    handleFileUpload(uploadAlarm, alarmSelect, "Custom", "alarm");

    // Track sound selection changes manually
    whiteNoiseSelect.addEventListener('change', () => {
        const selectedOption = whiteNoiseSelect.options[whiteNoiseSelect.selectedIndex];
        const customId = selectedOption.getAttribute('data-id');
        localStorage.setItem('selectedNoiseId', customId || whiteNoiseSelect.value);
        syncStateToPanopticon();
    });

    alarmSelect.addEventListener('change', () => {
        const selectedOption = alarmSelect.options[alarmSelect.selectedIndex];
        const customId = selectedOption.getAttribute('data-id');
        localStorage.setItem('selectedAlarmId', customId || alarmSelect.value);
        syncStateToPanopticon();
    });

    function setupTestButton(btn, selectElement, audioElOrArray, volumeInput) {
        const isArray = Array.isArray(audioElOrArray);
        const getFirst = () => isArray ? audioElOrArray[0] : audioElOrArray;
        
        const startTest = () => {
            if (isSleepMode) return;
            
            const newSrc = new URL(selectElement.value, window.location.href).href;
            if (getFirst().src !== newSrc) {
                if (isArray) audioElOrArray.forEach(a => a.src = selectElement.value);
                else audioElOrArray.src = selectElement.value;
            }
            
            if (isArray) {
                audioElOrArray.forEach(a => {
                    a.volume = volumeInput.value;
                    a.currentTime = 0;
                    a.play().catch(err => console.error("Test playback failed", err));
                });
            } else {
                audioElOrArray.volume = volumeInput.value;
                audioElOrArray.currentTime = 0;
                audioElOrArray.play().catch(err => console.error("Test playback failed", err));
            }
        };

        const stopTest = () => {
            if (isSleepMode) return;
            if (isArray) {
                audioElOrArray.forEach(a => {
                    a.pause();
                    a.currentTime = 0;
                });
            } else {
                audioElOrArray.pause();
                audioElOrArray.currentTime = 0;
            }
        };

        btn.addEventListener('mousedown', startTest);
        btn.addEventListener('mouseup', stopTest);
        btn.addEventListener('mouseleave', stopTest);
        
        // Use e.preventDefault() on touchstart to stop duplicate mouse events on mobile
        btn.addEventListener('touchstart', (e) => { e.preventDefault(); startTest(); }, {passive: false});
        btn.addEventListener('touchend', (e) => { e.preventDefault(); stopTest(); }, {passive: false});
        btn.addEventListener('touchcancel', (e) => { e.preventDefault(); stopTest(); }, {passive: false});
    }

    setupTestButton(testNoiseBtn, whiteNoiseSelect, noiseAudios, noiseVolumeInput);
    setupTestButton(testAlarmBtn, alarmSelect, alarmAudios, alarmVolumeInput);

    // Preset Logic
    const presetsContainer = document.getElementById('presets-container');
    const savePresetBtn = document.getElementById('save-preset-btn');
    
    let presets = JSON.parse(localStorage.getItem('pupSleepPresets') || '["06:00"]');

    function renderPresets() {
        if (!presetsContainer) return;
        presetsContainer.innerHTML = '';
        presets.forEach((timeStr, index) => {
            const btn = document.createElement('button');
            btn.className = 'preset-btn';
            
            const [h, m] = timeStr.split(':');
            const d = new Date();
            d.setHours(parseInt(h, 10), parseInt(m, 10));
            const timeFormatted = d.toLocaleTimeString([], {hour: 'numeric', minute:'2-digit'});

            const textSpan = document.createElement('span');
            textSpan.innerText = timeFormatted;
            textSpan.addEventListener('click', () => {
                wakeTimeInput.value = timeStr;
            });
            
            const delBtn = document.createElement('button');
            delBtn.className = 'preset-delete';
            delBtn.innerText = '✕';
            delBtn.title = "Delete Preset";
            delBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                presets.splice(index, 1);
                localStorage.setItem('pupSleepPresets', JSON.stringify(presets));
                renderPresets();
            });

            btn.appendChild(textSpan);
            btn.appendChild(delBtn);
            presetsContainer.appendChild(btn);
        });
    }

    if (savePresetBtn) {
        savePresetBtn.addEventListener('click', () => {
            const timeStr = wakeTimeInput.value;
            if (!timeStr) {
                showToast("Please select a time first!");
                return;
            }
            if (!presets.includes(timeStr)) {
                presets.push(timeStr);
                presets.sort();
                localStorage.setItem('pupSleepPresets', JSON.stringify(presets));
                renderPresets();
            }
        });
    }

    renderPresets();

    // Start Button
    startBtn.addEventListener('click', () => {
        if (!wakeTimeInput.value) {
            showToast("Please set a wake up time!");
            return;
        }

        if (networkRole === 'client') {
            sendCommand('START');
            return;
        }

        const [hours, minutes] = wakeTimeInput.value.split(':').map(Number);
        const now = new Date();
        targetTime = new Date();
        targetTime.setHours(hours, minutes, 0, 0);

        // If the target time is earlier today, assume it's for tomorrow
        if (targetTime < now) {
            targetTime.setDate(targetTime.getDate() + 1);
        }

        startSleepMode();
    });

    // Stop Button
    stopBtn.addEventListener('click', () => {
        if (networkRole === 'client') {
            sendCommand('STOP');
            return;
        }
        resetApp();
    });

    function startSleepMode(fromNetwork = false) {
        if (!fromNetwork && networkRole === 'client') {
            sendCommand('START');
            return;
        }

        isSleepMode = true;
        requestWakeLock();
        
        // Update UI
        startBtn.classList.add('hidden');
        stopBtn.classList.remove('hidden');
        statusDisplay.classList.remove('hidden');
        document.querySelectorAll('input:not([type=range]), select, button').forEach(el => {
            if (el.id !== 'stop-btn' && el.id !== 'network-btn' && el.id !== 'close-modal-btn' && el.id !== 'leave-session-btn') el.disabled = true;
        });
        document.querySelectorAll('.upload-btn').forEach(el => {
            el.classList.add('disabled-label');
        });

        statusText.innerText = "Sleep Mode Active 🐾";

        // Toggle Dark Mode with a smooth transition
        document.body.classList.add('theme-transitioning');
        document.body.classList.add('dark-mode');
        setTimeout(() => document.body.classList.remove('theme-transitioning'), 3000);

        // Start White Noise
        if (networkRole !== 'client') {
            const newNoiseSrc = new URL(whiteNoiseSelect.value, window.location.href).href;
            noiseAudios.forEach(a => {
                if (a.src !== newNoiseSrc) a.src = whiteNoiseSelect.value;
                a.isFadingOut = false;
            });
            activeNoiseIndex = 0;
            noiseAudios[0].volume = parseFloat(noiseVolumeInput.value);
            noiseAudios[0].currentTime = 0;
            noiseAudios[0].play().catch(e => {
                console.error("Audio playback failed", e);
                showToast("Please interact with the page first to allow audio playback.");
            });
        }

        // Start Timer
        timerInterval = setInterval(checkTime, 1000);
        checkTime(); // Initial call
        
        // Pre-load alarm to allow playback later
        if (networkRole !== 'client') {
            const newAlarmSrc = new URL(alarmSelect.value, window.location.href).href;
            if (alarmAudios[0].src !== newAlarmSrc) {
                alarmAudios.forEach(a => a.src = alarmSelect.value);
            }
            
            alarmAudios.forEach(a => {
                a.volume = 0;
                a.play().then(() => {
                    a.pause();
                    a.currentTime = 0;
                    a.volume = alarmVolumeInput.value;
                }).catch(e => console.log("Alarm preload info:", e));
            });
        }

        if (networkRole === 'host') broadcastState();
    }

    function checkTime() {
        const now = new Date();
        const diffMs = targetTime - now;

        if (diffMs <= 0) {
            // Time reached!
            triggerAlarm();
            return;
        }

        // Update countdown
        const hours = Math.floor(diffMs / (1000 * 60 * 60));
        const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((diffMs % (1000 * 60)) / 1000);

        countdownText.innerText = `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
    }

    function pad(num) {
        return num.toString().padStart(2, '0');
    }

    function triggerAlarm() {
        clearInterval(timerInterval);
        statusText.innerText = "Wake Up Time! 🌅";
        countdownText.innerText = "00:00:00";

        if (networkRole === 'client') return; // Do not play audio on client

        // Set up alarm audio
        const newAlarmSrc = new URL(alarmSelect.value, window.location.href).href;
        if (alarmAudios[0].src !== newAlarmSrc) {
            alarmAudios.forEach(a => a.src = alarmSelect.value);
        }
        
        alarmAudios.forEach(a => a.volume = 0); // Start at 0 for fade in
        alarmPlayCount = 0;

        // Transition: Fade out white noise
        noiseAudios.forEach(a => fadeAudioOut(a, 3000)); // fade over 3 seconds

        playAlarmSequence();
    }

    function playAlarmSequence() {
        if (alarmPlayCount < MAX_ALARM_PLAYS && isSleepMode) {
            alarmAudios.forEach(a => {
                a.currentTime = 0;
                a.play().catch(e => console.error("Alarm playback failed", e));
            });
            fadeAudioIn(alarmAudios, 2000, parseFloat(alarmVolumeInput.value));
            alarmPlayCount++;
        } else if (alarmPlayCount >= MAX_ALARM_PLAYS) {
            // Finished playing, reset app
            resetApp();
        }
    }

    // When alarm finishes, play again if count < MAX_ALARM_PLAYS (only attach listener to one instance)
    alarmAudios[0].addEventListener('ended', playAlarmSequence);

    function fadeAudioOut(audioElement, duration) {
        if (audioElement.paused) return; 
        
        const startVolume = audioElement.volume;
        const startTime = Date.now();

        const fadeInterval = setInterval(() => {
            if (!isSleepMode) {
                clearInterval(fadeInterval);
                return;
            }
            const elapsed = Date.now() - startTime;
            if (elapsed < duration) {
                const newVol = startVolume * (1 - (elapsed / duration));
                audioElement.volume = Math.max(0, newVol);
            } else {
                audioElement.volume = 0;
                audioElement.pause();
                clearInterval(fadeInterval);
            }
        }, 150);
    }

    function fadeAudioIn(audioElements, duration, targetVolume) {
        if (!Array.isArray(audioElements)) audioElements = [audioElements];
        
        const startVolumes = audioElements.map(a => a.volume);
        const startTime = Date.now();

        const fadeInterval = setInterval(() => {
            if (!isSleepMode) {
                clearInterval(fadeInterval);
                return;
            }
            const elapsed = Date.now() - startTime;
            if (elapsed < duration) {
                const progress = elapsed / duration;
                audioElements.forEach((a, idx) => {
                    const startVol = startVolumes[idx];
                    const newVol = startVol + ((targetVolume - startVol) * progress);
                    a.volume = Math.min(targetVolume, Math.max(0, newVol));
                });
            } else {
                audioElements.forEach(a => a.volume = targetVolume);
                clearInterval(fadeInterval);
            }
        }, 150);
    }

    function resetApp(fromNetwork = false) {
        if (!fromNetwork && networkRole === 'client') {
            sendCommand('STOP');
            return;
        }

        isSleepMode = false;
        releaseWakeLock();
        clearInterval(timerInterval);
        
        // Stop audios
        if (networkRole !== 'client') {
            noiseAudios.forEach(a => {
                a.pause();
                a.currentTime = 0;
                a.isFadingOut = false;
            });
            alarmAudios.forEach(a => {
                a.pause();
                a.currentTime = 0;
            });
            alarmPlayCount = 0;
        }

        // Remove Dark Mode with a smooth transition
        document.body.classList.add('theme-transitioning');
        document.body.classList.remove('dark-mode');
        setTimeout(() => document.body.classList.remove('theme-transitioning'), 3000);

        // Reset UI
        startBtn.classList.remove('hidden');
        stopBtn.classList.add('hidden');
        statusDisplay.classList.add('hidden');
        
        document.querySelectorAll('input, select, button').forEach(el => el.disabled = false);
        document.querySelectorAll('.upload-btn').forEach(el => {
            el.classList.remove('disabled-label');
        });
        countdownText.innerText = "";

        if (networkRole === 'host') broadcastState();
    }

    wakeTimeInput.addEventListener('change', () => {
        if (networkRole === 'client') sendCommand('UPDATE_TIME', wakeTimeInput.value);
        else if (networkRole === 'host') broadcastState();
    });

    // Live volume update
    noiseVolumeInput.addEventListener('input', (e) => {
        localStorage.setItem('noiseVolume', e.target.value);
        syncStateToPanopticon();
        if (networkRole === 'client') sendCommand('UPDATE_NOISE_VOL', e.target.value);
        else if (networkRole === 'host') broadcastState();

        if (isSleepMode && networkRole !== 'client') {
            noiseAudios.forEach(a => {
                if (!a.paused && !a.isFadingOut) {
                    a.volume = parseFloat(e.target.value);
                }
            });
        }
    });

    alarmVolumeInput.addEventListener('input', (e) => {
        localStorage.setItem('alarmVolume', e.target.value);
        syncStateToPanopticon();
        if (networkRole === 'client') sendCommand('UPDATE_ALARM_VOL', e.target.value);
        else if (networkRole === 'host') broadcastState();

        if (isSleepMode && networkRole !== 'client') {
            alarmAudios.forEach(a => a.volume = e.target.value);
        }
    });

    // Register Service Worker for PWA
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('./sw.js')
                .then(reg => {
                    console.log('Service Worker registered successfully.');
                    // Force an update check when the page loads
                    reg.update();
                })
                .catch(err => console.error('Service Worker registration failed:', err));
        });

        // Detect when a new service worker takes over and automatically reload the page
        let refreshing = false;
        navigator.serviceWorker.addEventListener('controllerchange', () => {
            if (!refreshing) {
                refreshing = true;
                window.location.reload();
            }
        });
    }
});
