// Connect to the same origin that served this page
const socket = io(window.location.origin);

// Get room code from URL
const pathParts = window.location.pathname.split('/');
const roomCode = pathParts[pathParts.length - 1].toUpperCase();

// Game state
let playerData = null;
let selectedColorIndex = 0;  // 0-49 (includes pattern)
let tapCount = 0;
let raceActive = false;
let tapSound = null;

// Get or create session ID for reconnection
function getSessionId() {
    const key = `retro100m_session_${roomCode}`;
    let sessionId = localStorage.getItem(key);

    if (!sessionId) {
        sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        localStorage.setItem(key, sessionId);
    }

    return sessionId;
}

const sessionId = getSessionId();

// Color options
const COLORS = [
    '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7',
    '#DDA0DD', '#F4A460', '#98D8C8', '#FFD93D', '#6C5CE7'
];

const PATTERNS = ['solid', 'striped', 'dotted', 'checker', 'diagonal'];

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    setupColorSelection();
    setupJoinButton();
    setupTapButton();
    setupLeaveButtons();
    setupRematchButton();
    setupTapSound();

    // Try to reconnect if we have a session
    attemptReconnection();
});

function attemptReconnection() {
    // Try to reconnect with session ID
    socket.emit('reconnect-player', {
        roomCode: roomCode,
        sessionId: sessionId
    }, (response) => {
        if (response.success) {
            console.log('Reconnected successfully!');
            playerData = response.player;

            // Skip to appropriate screen based on game state
            if (response.state === 'RACING') {
                showRaceScreen();
            } else if (response.state === 'RESULTS' || response.state === 'PODIUM') {
                // Wait for race results
            } else {
                showWaitingScreen();
            }
        } else {
            // No previous session, show join screen normally
            console.log('No previous session found');

            // Check for taken colors
            socket.emit('get-room-info', { roomCode }, (response) => {
                if (response.success) {
                    updateColorGrid(response.takenColors || []);
                }
            });
        }
    });
}

function setupTapSound() {
    // Initialize tap sound (optional - runs on device)
    try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        const audioContext = new AudioContext();

        // Create a simple click sound
        function playTapSound() {
            if (!raceActive) return;

            const oscillator = audioContext.createOscillator();
            const gainNode = audioContext.createGain();

            oscillator.connect(gainNode);
            gainNode.connect(audioContext.destination);

            oscillator.frequency.value = 800;
            oscillator.type = 'square';

            gainNode.gain.setValueAtTime(0.1, audioContext.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.05);

            oscillator.start(audioContext.currentTime);
            oscillator.stop(audioContext.currentTime + 0.05);
        }

        tapSound = playTapSound;
    } catch (e) {
        console.log('Audio not available');
    }
}

function setupColorSelection() {
    const colorGrid = document.getElementById('color-grid');
    colorGrid.innerHTML = ''; // Clear existing

    // Create color options - show base colors first
    COLORS.forEach((color, colorIdx) => {
        const container = document.createElement('div');
        container.className = 'color-container';
        container.style.display = 'inline-block';
        container.style.position = 'relative';

        const colorOption = document.createElement('div');
        colorOption.className = 'color-option';
        colorOption.style.backgroundColor = color;
        colorOption.dataset.colorIndex = colorIdx;
        colorOption.dataset.pattern = 'solid';

        colorOption.addEventListener('click', () => selectColor(colorIdx));

        container.appendChild(colorOption);
        colorGrid.appendChild(container);
    });

    // Select first color by default
    selectColor(0);
}

function selectColor(colorIdx) {
    // Find first available pattern for this color
    const patternIdx = findFirstAvailablePattern(colorIdx);

    if (patternIdx === null) {
        alert('All patterns for this color are taken (5 players already have it)');
        return;
    }

    const fullIndex = patternIdx * 10 + colorIdx;

    // Clear all selections
    document.querySelectorAll('.color-option').forEach(opt => {
        opt.classList.remove('selected');
    });

    // Select this option
    const option = document.querySelector(`[data-color-index="${colorIdx}"]`);
    if (option) {
        option.classList.add('selected');
        selectedColorIndex = fullIndex;

        // Update the option to show which pattern will be used
        updateColorOptionDisplay(option, colorIdx, patternIdx);

        // Show preview with pattern
        updateColorPreview(colorIdx, patternIdx);
    }
}

function findFirstAvailablePattern(colorIdx) {
    const takenColors = window.takenColorIndices || [];

    for (let p = 0; p < PATTERNS.length; p++) {
        const fullIndex = p * 10 + colorIdx;
        if (!takenColors.includes(fullIndex)) {
            return p;
        }
    }
    return null;
}

function findNextAvailablePattern(colorIdx, startPattern) {
    for (let p = startPattern + 1; p < PATTERNS.length; p++) {
        const fullIndex = p * 10 + colorIdx;
        const takenColors = window.takenColorIndices || [];
        if (!takenColors.includes(fullIndex)) {
            return p;
        }
    }
    return null;
}

function updateColorGrid(takenColorIndices) {
    window.takenColorIndices = takenColorIndices;
    const colorGrid = document.getElementById('color-grid');

    // Clear and rebuild
    colorGrid.innerHTML = '';

    COLORS.forEach((color, colorIdx) => {
        const container = document.createElement('div');
        container.className = 'color-container';
        container.style.display = 'inline-block';
        container.style.marginRight = '5px';

        // Check how many patterns are taken for this color
        const takenPatterns = [];
        for (let p = 0; p < PATTERNS.length; p++) {
            const fullIdx = p * 10 + colorIdx;
            if (takenColorIndices.includes(fullIdx)) {
                takenPatterns.push(p);
            }
        }

        // Create color option
        const colorOption = document.createElement('div');
        colorOption.className = 'color-option';
        colorOption.style.backgroundColor = color;
        colorOption.dataset.colorIndex = colorIdx;

        // Show the pattern that will be assigned if selected
        const nextAvailablePattern = findFirstAvailablePattern(colorIdx);
        if (nextAvailablePattern !== null && nextAvailablePattern > 0) {
            // Add pattern overlay to show what you'll get
            const pattern = document.createElement('div');
            pattern.className = `pattern-overlay ${PATTERNS[nextAvailablePattern]}`;
            colorOption.appendChild(pattern);
        }

        // Mark as unavailable if all patterns taken
        if (takenPatterns.length >= PATTERNS.length) {
            colorOption.classList.add('taken');
            colorOption.style.opacity = '0.3';
        }

        colorOption.addEventListener('click', () => selectColor(colorIdx));

        container.appendChild(colorOption);

        // Show how many slots available
        if (takenPatterns.length > 0) {
            const indicator = document.createElement('div');
            indicator.style.cssText = 'font-size: 8px; text-align: center; color: white;';
            const remaining = PATTERNS.length - takenPatterns.length;
            if (remaining > 0) {
                indicator.textContent = `${remaining}/5`;
            } else {
                indicator.textContent = 'FULL';
            }
            container.appendChild(indicator);
        }

        colorGrid.appendChild(container);
    });

    // Auto-select first color with available pattern
    for (let i = 0; i < COLORS.length; i++) {
        if (findFirstAvailablePattern(i) !== null) {
            selectColor(i);
            break;
        }
    }
}

function updateColorOptionDisplay(option, colorIdx, patternIdx) {
    // Clear existing overlays
    const existingOverlay = option.querySelector('.pattern-overlay');
    if (existingOverlay) {
        existingOverlay.remove();
    }

    // Add pattern overlay if not solid
    if (patternIdx > 0) {
        const pattern = document.createElement('div');
        pattern.className = `pattern-overlay ${PATTERNS[patternIdx]}`;
        option.appendChild(pattern);
    }
}

function updateColorPreview(colorIdx, patternIdx) {
    // Update any preview element to show selected color+pattern
    const previewText = `${COLORS[colorIdx]} - ${PATTERNS[patternIdx]}`;
    console.log('Selected:', previewText);
}

function setupJoinButton() {
    const joinButton = document.getElementById('join-button');
    const playerNameInput = document.getElementById('player-name');

    joinButton.addEventListener('click', () => {
        const playerName = playerNameInput.value.trim() || `Player`;

        console.log(`Joining with color index: ${selectedColorIndex} (color: ${selectedColorIndex % 10}, pattern: ${Math.floor(selectedColorIndex / 10)})`);

        socket.emit('join-room', {
            roomCode: roomCode,
            playerName: playerName,
            colorIndex: selectedColorIndex,  // Send full index (includes pattern)
            sessionId: sessionId  // Send session ID for reconnection
        }, (response) => {
            if (response.error) {
                alert(response.error);
                console.error('Join error:', response.error);
                return;
            }

            console.log('Joined successfully:', response.player);
            playerData = response.player;
            showWaitingScreen();

            // Enable vibration if available
            if ('vibrate' in navigator) {
                navigator.vibrate(100);
            }
        });
    });
}

function setupTapButton() {
    const tapButton = document.getElementById('tap-button');
    const tapVisual = document.getElementById('tap-visual');
    let lastTapTime = 0;
    const minTapInterval = 50; // Prevent too rapid tapping

    // Handle both touch and click events
    const handleTap = (e) => {
        e.preventDefault();

        if (!raceActive) return;

        const now = Date.now();
        if (now - lastTapTime < minTapInterval) return;
        lastTapTime = now;

        tapCount++;
        socket.emit('tap', { roomCode: roomCode });

        // Update UI
        document.getElementById('tap-count').textContent = `TAPS: ${tapCount}`;

        // Visual feedback
        tapVisual.classList.remove('tap-visual');
        void tapVisual.offsetWidth; // Force reflow
        tapVisual.classList.add('tap-visual');

        // Play sound if available
        if (tapSound) tapSound();

        // Haptic feedback
        if ('vibrate' in navigator) {
            navigator.vibrate(10);
        }
    };

    tapButton.addEventListener('touchstart', handleTap, { passive: false });
    tapButton.addEventListener('mousedown', handleTap);

    // Prevent default touch behaviors
    tapButton.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
    tapButton.addEventListener('contextmenu', (e) => e.preventDefault());
}

function setupLeaveButtons() {
    document.getElementById('leave-waiting').addEventListener('click', () => {
        socket.emit('leave-room', { roomCode: roomCode });
        returnToJoinScreen();
    });

    document.getElementById('leave-results').addEventListener('click', () => {
        socket.emit('leave-room', { roomCode: roomCode });
        returnToJoinScreen();
    });
}

function returnToJoinScreen() {
    // Reset player data but keep room code
    playerData = null;
    tapCount = 0;
    raceActive = false;

    // Show join screen again
    document.querySelectorAll('.screen').forEach(screen => {
        screen.classList.remove('active');
    });
    document.getElementById('join-screen').classList.add('active');

    // Re-fetch room info to update taken colors
    socket.emit('get-room-info', { roomCode }, (response) => {
        if (response.success) {
            updateColorGrid(response.takenColors || []);
        }
    });
}

function setupRematchButton() {
    document.getElementById('rematch-button').addEventListener('click', () => {
        tapCount = 0;
        raceActive = false;
        showWaitingScreen();
    });
}

function showWaitingScreen() {
    document.querySelectorAll('.screen').forEach(screen => {
        screen.classList.remove('active');
    });
    document.getElementById('waiting-screen').classList.add('active');

    // Update player display
    const avatar = document.getElementById('player-avatar');
    avatar.style.backgroundColor = playerData.color;

    // Add pattern if needed
    if (playerData.pattern !== 'solid') {
        const pattern = document.createElement('div');
        pattern.className = `pattern-overlay ${playerData.pattern}`;
        avatar.appendChild(pattern);
    }

    document.getElementById('player-number').textContent = `#${playerData.number}`;
    document.getElementById('display-name').textContent = playerData.name;
}

function showRaceScreen() {
    document.querySelectorAll('.screen').forEach(screen => {
        screen.classList.remove('active');
    });
    document.getElementById('race-screen').classList.add('active');

    raceActive = true;
    tapCount = 0;
}

function showPersonalResults(data) {
    document.querySelectorAll('.screen').forEach(screen => {
        screen.classList.remove('active');
    });
    document.getElementById('results-screen').classList.add('active');

    raceActive = false;

    // Show finish position with medal if applicable
    const medals = ['🥇', '🥈', '🥉'];
    const medal = data.position <= 3 ? medals[data.position - 1] : '';
    const positionText = medal || `#${data.position}`;

    document.getElementById('finish-position').textContent = positionText;
    document.getElementById('finish-time').textContent = `TIME: ${(data.finishTime / 1000).toFixed(2)}s`;
    document.getElementById('tap-stats').textContent = `TAPS: ${data.taps}`;

    // Add a congratulations message
    const resultCard = document.querySelector('.result-card');
    if (data.position === 1) {
        resultCard.style.borderColor = '#FFD700';
    } else if (data.position === 2) {
        resultCard.style.borderColor = '#C0C0C0';
    } else if (data.position === 3) {
        resultCard.style.borderColor = '#CD7F32';
    }

    // Show position out of total
    const positionDisplay = document.createElement('div');
    positionDisplay.style.cssText = 'color: #96CEB4; font-size: 0.8rem; margin-top: 0.5rem;';
    positionDisplay.textContent = `Position ${data.position} of ${data.totalPlayers}`;
    resultCard.appendChild(positionDisplay);
}

function showResultsScreen(results) {
    document.querySelectorAll('.screen').forEach(screen => {
        screen.classList.remove('active');
    });
    document.getElementById('results-screen').classList.add('active');

    raceActive = false;

    // Find player's result
    const playerResult = results.finishOrder.find(p => p.id === socket.id) ||
                        results.dnf.find(p => p.id === socket.id);

    if (playerResult) {
        const position = playerResult.finishPosition || 'DNF';
        const medal = playerResult.medal || '';

        document.getElementById('finish-position').textContent = medal || `#${position}`;
        document.getElementById('finish-time').textContent =
            playerResult.finishTime ? `TIME: ${(playerResult.finishTime / 1000).toFixed(2)}s` : 'DNF';
        document.getElementById('tap-stats').textContent = `TAPS: ${tapCount}`;
    }
}

// Socket event handlers
socket.on('countdown-started', () => {
    showRaceScreen();
    document.getElementById('tap-visual').textContent = 'READY...';
});

socket.on('countdown', (count) => {
    const tapVisual = document.getElementById('tap-visual');

    if (count === 2) {
        tapVisual.textContent = 'SET...';
    } else if (count === 1) {
        tapVisual.textContent = 'GO!';
    } else if (count === 0) {
        tapVisual.textContent = 'TAP!';
    }
});

socket.on('race-started', () => {
    raceActive = true;
    document.getElementById('tap-visual').textContent = 'TAP!';
});

// Handle player's own finish
socket.on('player-finished', (data) => {
    raceActive = false;
    showPersonalResults(data);
});

// Notification when someone else finishes
socket.on('someone-finished', (data) => {
    // Could show a notification that someone finished
    console.log(`${data.playerName} finished in position ${data.position}!`);
});

socket.on('position-update', (positions) => {
    if (!raceActive) return;

    // Find player's position
    const playerIndex = positions.findIndex(p => p.id === socket.id);
    if (playerIndex >= 0) {
        document.getElementById('position-display').textContent = `POS: ${playerIndex + 1}/${positions.length}`;
    }
});

socket.on('race-ended', (results) => {
    showResultsScreen(results);
});

socket.on('rematch-started', () => {
    tapCount = 0;
    raceActive = false;
    showWaitingScreen();
});

// Handle connection errors
socket.on('connect_error', () => {
    alert('Connection lost. Please refresh the page.');
});

socket.on('disconnect', () => {
    alert('Disconnected from server. Please refresh the page.');
});