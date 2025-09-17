const socket = io();
let gameState = null;
let roomData = null;
let players = new Map();
let isHost = false;

// Initialize game when page loads
window.addEventListener('DOMContentLoaded', () => {
    initializeHost();
});

function initializeHost() {
    socket.emit('create-room', (response) => {
        roomData = response;
        isHost = true;

        // Display QR code and room info
        document.getElementById('qr-code').src = response.qrCode;
        document.getElementById('room-code').textContent = response.roomCode;
        document.getElementById('join-url').textContent = response.joinUrl;

        // Set up host controls
        setupHostControls();
    });
}

function setupHostControls() {
    const startButton = document.getElementById('start-button');
    const raceLengthSelect = document.getElementById('race-length');
    const medalCountSelect = document.getElementById('medal-count');

    raceLengthSelect.addEventListener('change', () => {
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

function initializeRaceView() {
    raceCanvas = document.getElementById('race-track');
    raceContext = raceCanvas.getContext('2d');

    // Set canvas size
    raceCanvas.width = window.innerWidth;
    raceCanvas.height = window.innerHeight * 0.7;

    // Determine sprite scale based on player count
    const playerCount = players.size;

    if (playerCount <= 12) {
        spriteScale = { size: 32, lanes: 1, showNames: true };
    } else if (playerCount <= 20) {
        spriteScale = { size: 24, lanes: 2, showNames: false };
        document.getElementById('minimap').style.display = 'block';
    } else if (playerCount <= 35) {
        spriteScale = { size: 16, lanes: 3, focusView: true };
        document.getElementById('minimap').style.display = 'block';
    } else {
        spriteScale = { size: 12, lanes: 4, minimapOnly: true };
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
    raceContext.fillText('100M DASH', raceCanvas.width/2, crowdTop + 30);
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
    const laneHeight = trackHeight / spriteScale.lanes;

    // Draw lane lines
    for (let i = 0; i <= spriteScale.lanes; i++) {
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
    raceContext.font = '16px "Press Start 2P"';
    for (let i = 0; i < spriteScale.lanes && i < 8; i++) {
        const y = trackTop + (laneHeight * i) + laneHeight/2 + 6;
        raceContext.fillText(`${i + 1}`, 10, y);
    }

    // Draw start line
    raceContext.fillStyle = 'white';
    raceContext.fillRect(40, trackTop, 4, trackHeight);

    // Draw distance markers
    const distances = [25, 50, 75];
    distances.forEach(dist => {
        const x = (dist / 100) * (raceCanvas.width - 100) + 50;
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
    const laneHeight = trackHeight / Math.min(spriteScale.lanes, 8);
    const raceDistance = raceCanvas.width - 140; // From start line to finish
    const startX = 50; // Start line position

    // Sort by position for drawing order (back to front)
    const sortedPositions = [...positions].sort((a, b) => a.position - b.position);

    // Draw runners
    sortedPositions.forEach((player, index) => {
        const lane = (player.number - 1) % Math.min(spriteScale.lanes, 8);
        const x = startX + (player.position / 100) * raceDistance;
        const y = trackTop + (lane * laneHeight) + (laneHeight / 2) - (spriteScale.size / 2);

        // Draw shadow under runner
        raceContext.fillStyle = 'rgba(0, 0, 0, 0.3)';
        raceContext.ellipse(x + spriteScale.size/2, y + spriteScale.size,
                           spriteScale.size/2, spriteScale.size/4, 0, 0, Math.PI * 2);
        raceContext.fill();

        // Draw runner sprite
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

    // Apply pattern overlay
    applyRunnerPattern(x, y, size, player.pattern);
}

function applyRunnerPattern(x, y, size, pattern) {
    if (pattern === 'solid') return;

    raceContext.save();
    raceContext.globalAlpha = 0.3;

    if (pattern === 'striped') {
        raceContext.fillStyle = 'black';
        for (let i = 0; i < size; i += 6) {
            raceContext.fillRect(x, y + i, size, 3);
        }
    } else if (pattern === 'dotted') {
        raceContext.fillStyle = 'black';
        for (let dx = 2; dx < size; dx += 6) {
            for (let dy = 2; dy < size; dy += 6) {
                raceContext.beginPath();
                raceContext.arc(x + dx, y + dy, 2, 0, Math.PI * 2);
                raceContext.fill();
            }
        }
    } else if (pattern === 'checker') {
        raceContext.fillStyle = 'black';
        for (let dx = 0; dx < size; dx += 6) {
            for (let dy = 0; dy < size; dy += 6) {
                if ((dx + dy) % 12 === 0) {
                    raceContext.fillRect(x + dx, y + dy, 3, 3);
                }
            }
        }
    } else if (pattern === 'diagonal') {
        raceContext.strokeStyle = 'black';
        raceContext.lineWidth = 2;
        for (let i = -size; i < size * 2; i += 6) {
            raceContext.beginPath();
            raceContext.moveTo(x + i, y);
            raceContext.lineTo(x + i - size, y + size);
            raceContext.stroke();
        }
    }

    raceContext.restore();
}

function drawRunner(x, y, player, size) {
    // Simple animation frame based on position
    const animFrame = Math.floor(player.position / 5) % 3;

    // Draw pixelated runner shape (simplified)
    if (size >= 24) {
        // Larger sprite - more detail
        drawDetailedRunner(x, y, player, size, animFrame);
    } else {
        // Smaller sprite - simple square with color
        raceContext.fillStyle = player.color;
        raceContext.fillRect(x, y, size, size);
        applyRunnerPattern(x, y, size, player.pattern);
    }

    // Draw player number
    raceContext.fillStyle = 'white';
    raceContext.font = `${Math.floor(size/3)}px "Press Start 2P"`;
    raceContext.fillText(player.number, x + 2, y + size/2);
}

function showResults(results) {
    document.getElementById('race-screen').style.display = 'none';
    document.getElementById('results-screen').style.display = 'block';

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
});

function startRace() {
    // Initialize any race-specific animations or sounds here
    console.log('Race started!');
}