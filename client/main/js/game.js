// Connect to the same origin that served this page
const socket = io(window.location.origin);
let gameState = null;
let roomData = null;
let players = new Map();
let isHost = false;

// Initialize game when page loads
window.addEventListener('DOMContentLoaded', () => {
    initializeHost();
    animateLobbyStadium();
});

function initializeHost() {
    socket.emit('create-room', (response) => {
        roomData = response;
        isHost = true;

        // Display QR code and room info
        document.getElementById('qr-code').src = response.qrCode;
        document.getElementById('room-code').textContent = response.roomCode;
        document.getElementById('join-url').textContent = response.joinUrl;

        // Initialize race length from settings
        if (response.settings && response.settings.raceLength) {
            currentRaceLength = response.settings.raceLength;
        }

        // Set up host controls
        setupHostControls();
    });
}

function setupHostControls() {
    const startButton = document.getElementById('start-button');
    const raceLengthSelect = document.getElementById('race-length');
    const medalCountSelect = document.getElementById('medal-count');

    raceLengthSelect.addEventListener('change', () => {
        currentRaceLength = raceLengthSelect.value;
        socket.emit('update-settings', {
            roomCode: roomData.roomCode,
            settings: { raceLength: raceLengthSelect.value }
        });
    });

    medalCountSelect.addEventListener('change', () => {
        socket.emit('update-settings', {
            roomCode: roomData.roomCode,
            settings: { medalCount: parseInt(medalCountSelect.value) }
        });
    });

    startButton.addEventListener('click', () => {
        socket.emit('start-race', { roomCode: roomData.roomCode });
    });
}

// Socket event handlers
socket.on('settings-updated', (settings) => {
    // Update local race length when server settings change
    if (settings.raceLength) {
        currentRaceLength = settings.raceLength;
    }
});

socket.on('player-joined', (data) => {
    const { player, totalPlayers } = data;
    players.set(player.id, player);

    updatePlayerList();

    // Enable start button if we have enough players
    if (totalPlayers >= 2 && isHost) {
        const startButton = document.getElementById('start-button');
        startButton.disabled = false;
        startButton.textContent = `START RACE (${totalPlayers} PLAYERS)`;
    }
});

socket.on('player-left', (data) => {
    players.delete(data.playerId);
    updatePlayerList();

    if (data.totalPlayers < 2 && isHost) {
        const startButton = document.getElementById('start-button');
        startButton.disabled = true;
        startButton.textContent = 'WAITING FOR PLAYERS...';
    }
});

socket.on('countdown-started', () => {
    document.getElementById('lobby-screen').style.display = 'none';
    document.getElementById('race-screen').style.display = 'block';
    document.getElementById('countdown-overlay').style.display = 'flex';

    // Hide lobby background canvas during race
    const lobbyBg = document.getElementById('lobby-stadium-bg');
    if (lobbyBg) lobbyBg.style.display = 'none';
});

socket.on('countdown', (count) => {
    const countdownText = document.getElementById('countdown-text');

    if (count === 3) {
        countdownText.textContent = 'READY';
        countdownText.style.color = '#FF6B6B';
    } else if (count === 2) {
        countdownText.textContent = 'SET';
        countdownText.style.color = '#FFD93D';
    } else if (count === 1) {
        countdownText.textContent = 'GO!';
        countdownText.style.color = '#96CEB4';
    } else if (count === 0) {
        document.getElementById('countdown-overlay').style.display = 'none';
        startRace();
    }
});

let raceTimer = null;
let raceStartTime = null;

socket.on('race-started', () => {
    // Race has begun, initialize race visualization
    initializeRaceView();
    startRaceTimer();

    // Show host controls if host
    if (isHost) {
        document.getElementById('race-controls').classList.add('visible');
        setupForceFinish();
    }
});

function startRaceTimer() {
    raceStartTime = Date.now();
    const timerElement = document.getElementById('race-timer');

    raceTimer = setInterval(() => {
        const elapsed = Math.floor((Date.now() - raceStartTime) / 1000);
        const minutes = Math.floor(elapsed / 60);
        const seconds = elapsed % 60;
        timerElement.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;

        // Auto-end race after 2 minutes
        if (elapsed >= 120 && isHost) {
            timerElement.textContent += ' (MAX)';
            // Could auto-trigger force finish here
        }
    }, 100);
}

function setupForceFinish() {
    const forceFinishButton = document.getElementById('force-finish-button');

    forceFinishButton.onclick = () => {
        if (confirm('End the race now? Players who haven\'t finished will be marked as DNF.')) {
            socket.emit('force-finish', { roomCode: roomData.roomCode });
        }
    };
}

socket.on('position-update', (positions) => {
    updateRacePositions(positions);

    // Update active player count
    if (isHost) {
        const finished = positions.filter(p => p.finished).length;
        const total = positions.length;
        document.getElementById('active-players').textContent = `Finished: ${finished}/${total}`;
    }
});

socket.on('race-ended', (results) => {
    if (raceTimer) {
        clearInterval(raceTimer);
        raceTimer = null;
    }
    document.getElementById('race-controls').classList.remove('visible');
    showResults(results);
});

// Helper functions
function updatePlayerList() {
    const playerList = document.getElementById('player-list');
    playerList.innerHTML = '';

    players.forEach(player => {
        const playerCard = document.createElement('div');
        playerCard.className = 'player-card';

        const playerSprite = document.createElement('div');
        playerSprite.className = `player-sprite ${player.pattern}`;
        playerSprite.style.setProperty('--player-color', player.color);

        const playerInfo = document.createElement('div');
        playerInfo.innerHTML = `
            <div>#${player.number}</div>
            <div>${player.name}</div>
        `;

        playerCard.appendChild(playerSprite);
        playerCard.appendChild(playerInfo);
        playerList.appendChild(playerCard);
    });
}

let raceCanvas, raceContext, spriteScale;
let currentPlayerCount = 0; // Track current player count for lane drawing
let currentRaceLength = 'medium'; // Track current race length setting

function initializeRaceView() {
    raceCanvas = document.getElementById('race-track');
    raceContext = raceCanvas.getContext('2d');

    // Set canvas size
    raceCanvas.width = window.innerWidth;
    raceCanvas.height = window.innerHeight * 0.7;

    // Determine sprite scale based on player count
    const playerCount = players.size;
    currentPlayerCount = playerCount; // Store for track drawing

    if (playerCount <= 12) {
        spriteScale = { size: 32, lanes: playerCount, showNames: true };
    } else if (playerCount <= 20) {
        spriteScale = { size: 24, lanes: 8, showNames: false };
        document.getElementById('minimap').style.display = 'block';
    } else if (playerCount <= 35) {
        spriteScale = { size: 16, lanes: 8, focusView: true };
        document.getElementById('minimap').style.display = 'block';
    } else {
        spriteScale = { size: 12, lanes: 8, minimapOnly: true };
        document.getElementById('minimap').style.display = 'block';
    }

    drawRaceTrack();
}

// Draw pixelated stadium crowd
function drawStadiumCrowd() {
    const crowdHeight = raceCanvas.height * 0.25;
    const crowdTop = raceCanvas.height * 0.15;

    // Stadium background
    const stadiumGradient = raceContext.createLinearGradient(0, crowdTop, 0, crowdTop + crowdHeight);
    stadiumGradient.addColorStop(0, '#2C3E50');
    stadiumGradient.addColorStop(1, '#34495E');
    raceContext.fillStyle = stadiumGradient;
    raceContext.fillRect(0, crowdTop, raceCanvas.width, crowdHeight);

    // Draw pixelated crowd
    const pixelSize = 4;
    const crowdColors = ['#FF6B6B', '#4ECDC4', '#FFD93D', '#96CEB4', '#DDA0DD', '#F4A460'];

    for (let x = 0; x < raceCanvas.width; x += pixelSize * 2) {
        for (let y = crowdTop; y < crowdTop + crowdHeight; y += pixelSize * 2) {
            if (Math.random() > 0.3) {
                raceContext.fillStyle = crowdColors[Math.floor(Math.random() * crowdColors.length)];
                raceContext.fillRect(x, y, pixelSize, pixelSize);
            }
        }
    }

    // Stadium lights
    const lightPositions = [0.2, 0.4, 0.6, 0.8];
    lightPositions.forEach(pos => {
        const x = raceCanvas.width * pos;

        // Light pole
        raceContext.fillStyle = '#1A1A1A';
        raceContext.fillRect(x - 3, crowdTop - 40, 6, 40);

        // Light
        raceContext.fillStyle = '#FFFF00';
        raceContext.fillRect(x - 15, crowdTop - 45, 30, 8);

        // Light glow effect
        raceContext.fillStyle = 'rgba(255, 255, 0, 0.2)';
        raceContext.beginPath();
        raceContext.arc(x, crowdTop - 41, 20, 0, Math.PI * 2);
        raceContext.fill();
    });

    // Stadium banner
    raceContext.fillStyle = 'rgba(255, 255, 255, 0.9)';
    raceContext.fillRect(raceCanvas.width/2 - 150, crowdTop + 10, 300, 30);
    raceContext.fillStyle = '#FF6B6B';
    raceContext.font = 'bold 16px "Press Start 2P"';
    raceContext.textAlign = 'center';

    // Display actual race length
    const raceLengths = {
        'short': '60M DASH',
        'medium': '100M DASH',
        'long': '200M DASH'
    };
    const bannerText = raceLengths[currentRaceLength] || '100M DASH';
    raceContext.fillText(bannerText, raceCanvas.width/2, crowdTop + 30);
    raceContext.textAlign = 'left';
}

// Draw checkered finish line
function drawFinishLine() {
    const finishX = raceCanvas.width - 60;
    const trackTop = raceCanvas.height * 0.4;
    const trackHeight = raceCanvas.height * 0.6;

    // Finish line base
    raceContext.fillStyle = 'white';
    raceContext.fillRect(finishX - 2, trackTop, 4, trackHeight);

    // Checkered pattern
    const checkerSize = 12;
    const checkerWidth = 40;

    for (let y = trackTop; y < raceCanvas.height; y += checkerSize) {
        for (let x = finishX; x < finishX + checkerWidth; x += checkerSize) {
            const isBlack = ((x - finishX) / checkerSize + (y - trackTop) / checkerSize) % 2 < 1;
            raceContext.fillStyle = isBlack ? 'black' : 'white';
            raceContext.fillRect(x, y, checkerSize, checkerSize);
        }
    }

    // Finish text
    raceContext.save();
    raceContext.translate(finishX + 20, trackTop - 10);
    raceContext.rotate(-Math.PI / 2);
    raceContext.fillStyle = 'white';
    raceContext.font = 'bold 14px "Press Start 2P"';
    raceContext.fillText('FINISH', 0, 0);
    raceContext.restore();
}

function drawRaceTrack() {
    // Clear canvas
    raceContext.clearRect(0, 0, raceCanvas.width, raceCanvas.height);

    // Draw sky gradient
    const skyGradient = raceContext.createLinearGradient(0, 0, 0, raceCanvas.height * 0.4);
    skyGradient.addColorStop(0, '#87CEEB');
    skyGradient.addColorStop(1, '#B8E6F5');
    raceContext.fillStyle = skyGradient;
    raceContext.fillRect(0, 0, raceCanvas.width, raceCanvas.height * 0.4);

    // Draw stadium crowd (pixelated)
    drawStadiumCrowd();

    // Draw track base
    const trackGradient = raceContext.createLinearGradient(0, raceCanvas.height * 0.4, 0, raceCanvas.height);
    trackGradient.addColorStop(0, '#D2691E');
    trackGradient.addColorStop(0.5, '#A0522D');
    trackGradient.addColorStop(1, '#8B4513');
    raceContext.fillStyle = trackGradient;
    raceContext.fillRect(0, raceCanvas.height * 0.4, raceCanvas.width, raceCanvas.height * 0.6);

    // Draw track lanes with proper perspective
    const trackTop = raceCanvas.height * 0.4;
    const trackHeight = raceCanvas.height * 0.6;

    // Determine actual lanes to draw based on player count
    const lanesToDraw = Math.min(currentPlayerCount || spriteScale.lanes, 8);
    const laneHeight = trackHeight / lanesToDraw;

    // Draw lane lines
    for (let i = 0; i <= lanesToDraw; i++) {
        const y = trackTop + (laneHeight * i);

        // White lane lines
        raceContext.strokeStyle = 'rgba(255, 255, 255, 0.8)';
        raceContext.lineWidth = 3;
        raceContext.setLineDash([20, 10]);
        raceContext.beginPath();
        raceContext.moveTo(0, y);
        raceContext.lineTo(raceCanvas.width, y);
        raceContext.stroke();
    }

    // Draw lane numbers at start
    raceContext.setLineDash([]);
    raceContext.fillStyle = 'white';
    raceContext.font = '14px "Press Start 2P"';
    for (let i = 0; i < lanesToDraw; i++) {
        const y = trackTop + (laneHeight * i) + laneHeight/2 + 6;
        raceContext.fillText(`${i + 1}`, 10, y);
    }

    // Draw start line
    raceContext.fillStyle = 'white';
    raceContext.fillRect(40, trackTop, 4, trackHeight);

    // Draw distance markers based on race length
    let distances, totalDistance;
    switch(currentRaceLength) {
        case 'short':
            distances = [15, 30, 45];
            totalDistance = 60;
            break;
        case 'long':
            distances = [50, 100, 150];
            totalDistance = 200;
            break;
        default: // medium
            distances = [25, 50, 75];
            totalDistance = 100;
    }

    distances.forEach(dist => {
        const x = (dist / totalDistance) * (raceCanvas.width - 100) + 50;
        raceContext.strokeStyle = 'rgba(255, 255, 255, 0.3)';
        raceContext.lineWidth = 2;
        raceContext.setLineDash([5, 5]);
        raceContext.beginPath();
        raceContext.moveTo(x, trackTop);
        raceContext.lineTo(x, raceCanvas.height);
        raceContext.stroke();

        // Distance labels
        raceContext.setLineDash([]);
        raceContext.fillStyle = 'rgba(255, 255, 255, 0.5)';
        raceContext.font = '10px "Press Start 2P"';
        raceContext.fillText(`${dist}m`, x - 15, trackTop - 5);
    });

    // Draw finish line with checkered pattern
    drawFinishLine();
}

function updateRacePositions(positions) {
    if (!raceCanvas) return;

    drawRaceTrack();

    const trackTop = raceCanvas.height * 0.4;
    const trackHeight = raceCanvas.height * 0.6;

    // Calculate number of lanes based on player count
    const totalPlayers = positions.length;
    const maxLanesVisible = Math.min(totalPlayers, 8); // Max 8 lanes visible
    const laneHeight = trackHeight / maxLanesVisible;

    const raceDistance = raceCanvas.width - 140; // From start line to finish
    const startX = 50; // Start line position

    // Sort by position for drawing order (back to front)
    const sortedPositions = [...positions].sort((a, b) => a.position - b.position);

    // Draw runners - each in their own lane
    sortedPositions.forEach((player) => {
        // Use player number - 1 as lane index for consistent lane assignment
        let laneIndex = player.number - 1;

        // If more than 8 players, wrap around but offset slightly
        if (totalPlayers > 8) {
            const row = Math.floor(laneIndex / 8);
            laneIndex = laneIndex % 8;
            // Slight offset for multiple rows
            var xOffset = row * 10;
        } else {
            var xOffset = 0;
        }

        const x = startX + xOffset + (player.position / 100) * raceDistance;
        const y = trackTop + (laneIndex * laneHeight) + (laneHeight / 2) - (spriteScale.size / 2);

        // Skip shadow - it's causing the visual issue
        // Just draw the runner sprite directly
        drawRunner(x, y, player, spriteScale.size);

        // Draw name/position indicator if enabled
        if (spriteScale.showNames && spriteScale.size >= 24) {
            // Name tag background
            raceContext.fillStyle = 'rgba(0, 0, 0, 0.7)';
            raceContext.fillRect(x - 20, y - 15, 60, 12);

            raceContext.fillStyle = 'white';
            raceContext.font = '8px "Press Start 2P"';
            raceContext.fillText(player.name.substring(0, 8), x - 18, y - 6);
        }

        // Draw position number for leading players
        const leaderIndex = positions.findIndex(p => p.id === player.id);
        if (leaderIndex < 3) {
            const medals = ['🥇', '🥈', '🥉'];
            raceContext.font = '16px sans-serif';
            raceContext.fillText(medals[leaderIndex], x - 5, y - 20);
        }
    });
}

function drawDetailedRunner(x, y, player, size, animFrame) {
    const pixelSize = size / 8;

    // Runner body shape (8x8 grid)
    const runnerFrames = [
        // Frame 1 - Arms and legs extended
        [
            [0,0,1,1,1,0,0,0],
            [0,1,1,1,1,1,0,0],
            [0,0,1,2,1,0,0,0],
            [0,1,1,1,1,1,0,0],
            [1,0,1,1,1,0,1,0],
            [0,0,1,0,1,0,0,0],
            [0,1,0,0,0,1,0,0],
            [1,0,0,0,0,0,1,0]
        ],
        // Frame 2 - Mid stride
        [
            [0,0,1,1,1,0,0,0],
            [0,1,1,1,1,1,0,0],
            [0,0,1,2,1,0,0,0],
            [0,0,1,1,1,0,0,0],
            [0,1,1,1,1,1,0,0],
            [0,1,0,1,0,1,0,0],
            [0,1,0,0,0,1,0,0],
            [0,0,0,0,0,0,0,0]
        ],
        // Frame 3 - Opposite extension
        [
            [0,0,1,1,1,0,0,0],
            [0,1,1,1,1,1,0,0],
            [0,0,1,2,1,0,0,0],
            [0,1,1,1,1,1,0,0],
            [0,1,0,1,1,0,1,0],
            [0,0,0,1,0,1,0,0],
            [0,0,1,0,0,0,1,0],
            [0,1,0,0,0,0,0,1]
        ]
    ];

    const frame = runnerFrames[animFrame];

    for (let row = 0; row < 8; row++) {
        for (let col = 0; col < 8; col++) {
            const pixel = frame[row][col];
            if (pixel > 0) {
                if (pixel === 2) {
                    // Face/skin tone
                    raceContext.fillStyle = '#FFDBAC';
                } else {
                    // Jersey color
                    raceContext.fillStyle = player.color;
                }
                raceContext.fillRect(x + col * pixelSize, y + row * pixelSize, pixelSize, pixelSize);
            }
        }
    }

    // For larger sprites, add a subtle pattern indicator
    if (player.pattern !== 'solid') {
        // Add small accent to indicate pattern variant
        raceContext.fillStyle = 'rgba(255,255,255,0.5)';

        if (player.pattern === 'striped') {
            // Armband
            raceContext.fillRect(x + size * 0.1, y + size * 0.4, size * 0.8, pixelSize);
        } else if (player.pattern === 'dotted') {
            // Shoulder dots
            raceContext.fillRect(x + pixelSize, y + pixelSize * 2, pixelSize, pixelSize);
            raceContext.fillRect(x + size - pixelSize * 2, y + pixelSize * 2, pixelSize, pixelSize);
        } else if (player.pattern === 'checker') {
            // Belt
            raceContext.fillRect(x + size * 0.2, y + size * 0.5, size * 0.6, pixelSize);
        } else if (player.pattern === 'diagonal') {
            // Sash
            for (let i = 0; i < 3; i++) {
                raceContext.fillRect(x + i * pixelSize * 2, y + i * pixelSize * 2, pixelSize, pixelSize);
            }
        }
    }
}

function applyRunnerPattern(x, y, size, pattern) {
    if (pattern === 'solid') return;

    // For detailed sprites, apply subtle pattern to jersey area only
    // Skip patterns - they make the sprite too busy
    // Instead, we'll use other indicators
}

function drawRunner(x, y, player, size) {
    // Simple animation frame based on position
    const animFrame = Math.floor(player.position / 5) % 3;

    // Draw pixelated runner shape (simplified)
    if (size >= 24) {
        // Larger sprite - more detail
        drawDetailedRunner(x, y, player, size, animFrame);
    } else {
        // Smaller sprite - simple colored rectangle
        raceContext.fillStyle = player.color;
        raceContext.fillRect(x, y, size, size);

        // Add pattern indicator as a small badge/accent instead of overlay
        if (player.pattern !== 'solid') {
            drawPatternIndicator(x, y, size, player.pattern, player.color);
        }
    }

    // Draw player number with better contrast
    raceContext.fillStyle = 'black';
    raceContext.fillRect(x + 1, y + size/2 - 4, size - 2, 8);
    raceContext.fillStyle = 'white';
    raceContext.font = `${Math.floor(size/3)}px "Press Start 2P"`;
    raceContext.fillText(player.number, x + 2, y + size/2 + 2);
}

function drawPatternIndicator(x, y, size, pattern, color) {
    // Draw a small indicator instead of full pattern overlay
    raceContext.save();

    const indicatorSize = Math.max(4, size / 6);
    const indicatorX = x + size - indicatorSize - 1;
    const indicatorY = y + 1;

    // Draw small pattern badge in corner
    if (pattern === 'striped') {
        // Single stripe across top
        raceContext.fillStyle = 'rgba(255,255,255,0.7)';
        raceContext.fillRect(x, y, size, 2);
    } else if (pattern === 'dotted') {
        // Single dot in corner
        raceContext.fillStyle = 'rgba(255,255,255,0.7)';
        raceContext.beginPath();
        raceContext.arc(indicatorX + indicatorSize/2, indicatorY + indicatorSize/2, indicatorSize/2, 0, Math.PI * 2);
        raceContext.fill();
    } else if (pattern === 'checker') {
        // Small checker in corner
        raceContext.fillStyle = 'rgba(255,255,255,0.7)';
        raceContext.fillRect(indicatorX, indicatorY, indicatorSize/2, indicatorSize/2);
        raceContext.fillRect(indicatorX + indicatorSize/2, indicatorY + indicatorSize/2, indicatorSize/2, indicatorSize/2);
    } else if (pattern === 'diagonal') {
        // Small diagonal line
        raceContext.strokeStyle = 'rgba(255,255,255,0.7)';
        raceContext.lineWidth = 2;
        raceContext.beginPath();
        raceContext.moveTo(x, y);
        raceContext.lineTo(x + size/3, y + size/3);
        raceContext.stroke();
    }

    raceContext.restore();
}

function showResults(results) {
    document.getElementById('race-screen').style.display = 'none';
    document.getElementById('results-screen').style.display = 'block';

    // Show lobby background animations
    const lobbyBg = document.getElementById('lobby-stadium-bg');
    if (lobbyBg) lobbyBg.style.display = 'block';

    // Show podium (only for finished players)
    const podium = document.getElementById('podium');
    podium.innerHTML = '';

    // Only show podium if there are finished players
    if (results.finishOrder.length > 0) {
        results.finishOrder.slice(0, 3).forEach((player, index) => {
            const place = document.createElement('div');
            place.className = `podium-place ${['gold', 'silver', 'bronze'][index]}`;

            const playerDiv = document.createElement('div');
            playerDiv.className = 'podium-player';
            playerDiv.innerHTML = `
                <div style="font-size: 2rem">${player.medal}</div>
                <div>${player.name}</div>
                <div style="font-size: 0.7rem">${(player.finishTime / 1000).toFixed(2)}s</div>
            `;

            const platform = document.createElement('div');
            platform.className = `podium-platform ${['gold', 'silver', 'bronze'][index]}`;
            platform.textContent = index + 1;

            place.appendChild(playerDiv);
            place.appendChild(platform);
            podium.appendChild(place);
        });
    } else {
        podium.innerHTML = '<div style="color: #FF6B6B; padding: 2rem;">No players finished!</div>';
    }

    // Show full leaderboard
    const leaderboard = document.getElementById('leaderboard');
    leaderboard.innerHTML = '<h2>FULL RESULTS</h2>';

    // Add race stats
    const statsDiv = document.createElement('div');
    statsDiv.style.cssText = 'color: #96CEB4; margin: 1rem 0; font-size: 0.8rem;';
    statsDiv.innerHTML = `
        Race Duration: ${(results.raceStats.duration / 1000).toFixed(1)}s |
        Finished: ${results.raceStats.finishedCount} |
        DNF: ${results.raceStats.dnfCount}
    `;
    leaderboard.appendChild(statsDiv);

    // Show finished players
    results.finishOrder.forEach((player, index) => {
        const entry = document.createElement('div');
        entry.className = 'leaderboard-entry';
        entry.innerHTML = `
            <span>${index + 1}. ${player.name}</span>
            <span>${(player.finishTime / 1000).toFixed(2)}s - ${player.taps} taps</span>
        `;
        leaderboard.appendChild(entry);
    });

    // Show DNF players
    if (results.dnf && results.dnf.length > 0) {
        const dnfHeader = document.createElement('div');
        dnfHeader.style.cssText = 'color: #FF6B6B; margin-top: 1rem; padding: 0.5rem; border-top: 1px solid rgba(255,255,255,0.3);';
        dnfHeader.textContent = 'DID NOT FINISH';
        leaderboard.appendChild(dnfHeader);

        results.dnf.forEach((player) => {
            const entry = document.createElement('div');
            entry.className = 'leaderboard-entry';
            entry.style.opacity = '0.6';
            entry.innerHTML = `
                <span>DNF - ${player.name}</span>
                <span>${player.taps} taps</span>
            `;
            leaderboard.appendChild(entry);
        });
    }

    // Set up rematch button
    if (isHost) {
        const rematchButton = document.getElementById('rematch-button');
        rematchButton.style.display = 'block';
        rematchButton.addEventListener('click', () => {
            socket.emit('request-rematch', { roomCode: roomData.roomCode });
        });
    }
}

socket.on('rematch-started', (state) => {
    // Reset to lobby
    document.getElementById('results-screen').style.display = 'none';
    document.getElementById('lobby-screen').style.display = 'block';

    gameState = state;
    players = new Map(state.players.map(p => [p.id, p]));
    updatePlayerList();

    // Show lobby background canvas again
    const lobbyBg = document.getElementById('lobby-stadium-bg');
    if (lobbyBg) lobbyBg.style.display = 'block';
});

socket.on('host-changed', (data) => {
    console.log('New host assigned:', data.newHostId);
    // Check if we are the new host (main display is always the host)
    if (socket.id === data.newHostId) {
        isHost = true;
        console.log('You are now the host');
    }
});

function startRace() {
    // Initialize any race-specific animations or sounds here
    console.log('Race started!');
}

// Lobby stadium animation state
let lobbyAnimationFrame = 0;
let lobbyRunners = [];

// Initialize lobby runners
function initLobbyRunners() {
    lobbyRunners = [];
    const skinTones = ['#FFE0BD', '#F1C27D', '#D4A373', '#8D5524', '#5C4033'];
    for (let i = 0; i < 5; i++) {
        lobbyRunners.push({
            x: Math.random() * window.innerWidth,
            y: window.innerHeight * (0.5 + Math.random() * 0.3), // Random lane
            speed: 2 + Math.random() * 3,
            color: ['#FF6B6B', '#4ECDC4', '#FFD93D', '#96CEB4', '#DDA0DD'][i],
            skinTone: skinTones[i],
            size: 12
        });
    }
}

// Draw stadium background for lobby
function drawLobbyStadium() {
    const canvas = document.getElementById('lobby-stadium-bg');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    // Initialize runners on first draw
    if (lobbyRunners.length === 0) {
        initLobbyRunners();
    }

    // Sky gradient (top section)
    const skyHeight = canvas.height * 0.2;
    const skyGradient = ctx.createLinearGradient(0, 0, 0, skyHeight);
    skyGradient.addColorStop(0, '#87CEEB');
    skyGradient.addColorStop(1, '#98D8C8');
    ctx.fillStyle = skyGradient;
    ctx.fillRect(0, 0, canvas.width, skyHeight);

    // Stadium crowd (bigger stands)
    const crowdHeight = canvas.height * 0.4;
    const crowdTop = skyHeight;

    // Stadium background
    const stadiumGradient = ctx.createLinearGradient(0, crowdTop, 0, crowdTop + crowdHeight);
    stadiumGradient.addColorStop(0, '#2C3E50');
    stadiumGradient.addColorStop(1, '#34495E');
    ctx.fillStyle = stadiumGradient;
    ctx.fillRect(0, crowdTop, canvas.width, crowdHeight);

    // Pixelated crowd (with gaps)
    const pixelSize = 6;
    const crowdColors = ['#FF6B6B', '#4ECDC4', '#FFD93D', '#96CEB4', '#DDA0DD', '#F4A460'];

    for (let x = 0; x < canvas.width; x += pixelSize * 2) {
        for (let y = crowdTop; y < crowdTop + crowdHeight; y += pixelSize * 2) {
            // Random threshold creates gaps - 50% chance of drawing
            if (Math.random() > 0.5) {
                ctx.fillStyle = crowdColors[Math.floor(Math.random() * crowdColors.length)];
                ctx.fillRect(x, y, pixelSize, pixelSize);
            }
        }
    }

    // Stadium lights (animated) - from top of stands into sky
    const lightPositions = [0.15, 0.35, 0.65, 0.85];
    lightPositions.forEach((pos, i) => {
        const x = canvas.width * pos;
        const poleHeight = 60;
        const poleBottom = crowdTop; // Start at top of stands

        // Light pole
        ctx.fillStyle = '#1A1A1A';
        ctx.fillRect(x - 4, poleBottom - poleHeight, 8, poleHeight);

        // Animated light brightness (slower pulse)
        const pulseOffset = i * Math.PI / 2;
        const brightness = 0.7 + Math.sin(lobbyAnimationFrame / 60 + pulseOffset) * 0.3;

        // Light fixture (at top of pole, in the sky)
        ctx.fillStyle = `rgba(255, 255, 0, ${brightness})`;
        ctx.fillRect(x - 20, poleBottom - poleHeight - 10, 40, 12);

        // Light glow (pulsing)
        const glowSize = 30 + Math.sin(lobbyAnimationFrame / 60 + pulseOffset) * 5;
        ctx.fillStyle = `rgba(255, 255, 0, ${brightness * 0.3})`;
        ctx.beginPath();
        ctx.arc(x, poleBottom - poleHeight - 4, glowSize, 0, Math.PI * 2);
        ctx.fill();
    });

    // Track
    const trackTop = canvas.height * 0.5;
    const trackHeight = canvas.height * 0.5;

    // Track gradient
    const trackGradient = ctx.createLinearGradient(0, trackTop, 0, canvas.height);
    trackGradient.addColorStop(0, '#8B4513');
    trackGradient.addColorStop(1, '#A0522D');
    ctx.fillStyle = trackGradient;
    ctx.fillRect(0, trackTop, canvas.width, trackHeight);

    // Track lanes
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.lineWidth = 2;
    for (let i = 1; i < 8; i++) {
        const y = trackTop + (trackHeight / 8) * i;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(canvas.width, y);
        ctx.stroke();
    }

    // Finish line
    const finishX = canvas.width - 100;
    const checkerSize = 15;
    const checkerWidth = 50;

    for (let y = trackTop; y < canvas.height; y += checkerSize) {
        for (let x = finishX; x < finishX + checkerWidth; x += checkerSize) {
            const isBlack = ((x - finishX) / checkerSize + (y - trackTop) / checkerSize) % 2 < 1;
            ctx.fillStyle = isBlack ? 'black' : 'white';
            ctx.fillRect(x, y, checkerSize, checkerSize);
        }
    }

    // Draw and animate runners
    lobbyRunners.forEach(runner => {
        // Update position
        runner.x += runner.speed;

        // Wrap around
        if (runner.x > canvas.width + 20) {
            runner.x = -20;
            runner.y = trackTop + Math.random() * trackHeight * 0.8;
        }

        // Draw simple runner sprite (facing right)
        const size = runner.size;

        // Shadow
        ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
        ctx.fillRect(runner.x - 2, runner.y + size + 2, size + 4, 2);

        // Body (horizontal)
        ctx.fillStyle = runner.color;
        ctx.fillRect(runner.x, runner.y, size * 1.2, size);

        // Head (in front)
        ctx.fillStyle = runner.skinTone;
        ctx.fillRect(runner.x + size * 1.2 - 2, runner.y - size/3, size * 0.8, size * 0.8);

        // Running animation (legs - horizontal movement)
        const legOffset = Math.sin(runner.x / 10) * 3;
        ctx.fillStyle = runner.skinTone;
        // Back leg
        ctx.fillRect(runner.x + 2, runner.y + size, 2, 4 + legOffset);
        // Front leg
        ctx.fillRect(runner.x + size - 2, runner.y + size, 2, 4 - legOffset);

        // Arms (pumping motion)
        ctx.fillStyle = runner.skinTone;
        const armSwing = Math.sin(runner.x / 10) * 2;
        // Back arm
        ctx.fillRect(runner.x + 2, runner.y + 2, 2, 3 - armSwing);
        // Front arm
        ctx.fillRect(runner.x + size, runner.y + 2, 2, 3 + armSwing);
    });

    // Increment animation frame
    lobbyAnimationFrame++;
}

// Animate the lobby stadium
function animateLobbyStadium() {
    drawLobbyStadium();
    requestAnimationFrame(animateLobbyStadium);
}