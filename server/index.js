require('dotenv').config();
const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const QRCode = require('qrcode');
const os = require('os');
const GAME_CONSTANTS = require('../shared/constants');
const GameRoom = require('./game-room');

const app = express();

// Add CORS headers for mobile browsers
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  next();
});

const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
    credentials: true
  },
  // Add fallback transports for problematic networks
  transports: ['websocket', 'polling'],
  allowEIO3: true // Allow different Socket.io versions
});

// Serve static files
app.use(express.static(path.join(__dirname, '../client')));

// Serve main display
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../client/main/index.html'));
});

// Serve controller
app.get('/play/:roomCode', (req, res) => {
  res.sendFile(path.join(__dirname, '../client/controller/index.html'));
});

// Game rooms storage
const gameRooms = new Map();

// Generate room code
function generateRoomCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

// Get network IP address
function getNetworkIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      // Skip internal and non-IPv4 addresses
      if (iface.internal || iface.family !== 'IPv4') continue;
      return iface.address;
    }
  }
  return 'localhost';
}

// Get base URL for QR codes
function getBaseURL() {
  if (process.env.BASE_URL) {
    return process.env.BASE_URL;
  }
  const ip = getNetworkIP();
  const port = process.env.PORT || 3000;
  return `http://${ip}:${port}`;
}

// Socket.io connection handling
io.on('connection', (socket) => {
  const clientIP = socket.handshake.address;
  const transport = socket.conn.transport.name;
  console.log(`✅ New connection: ${socket.id}`);
  console.log(`   IP: ${clientIP}, Transport: ${transport}`);

  // Host creates a new game room
  socket.on('create-room', (callback) => {
    const roomCode = generateRoomCode();
    const room = new GameRoom(roomCode, socket.id);
    gameRooms.set(roomCode, room);

    socket.join(roomCode);
    socket.join(`${roomCode}-host`);

    // Generate QR code for joining
    const baseUrl = getBaseURL();
    const joinUrl = `${baseUrl}/play/${roomCode}`;
    QRCode.toDataURL(joinUrl, (err, qrCode) => {
      callback({
        roomCode,
        qrCode,
        joinUrl,
        settings: {
          raceLength: room.raceLength,
          medalCount: room.medalCount
        }
      });
    });
  });

  // Get room info (for checking taken colors)
  socket.on('get-room-info', ({ roomCode }, callback) => {
    const room = gameRooms.get(roomCode);
    if (!room) {
      return callback({ error: 'Room not found' });
    }

    // Get full color indices (0-49, includes pattern)
    const takenColors = Array.from(room.players.values()).map(p => {
      // Calculate full index from color and pattern
      const colorIdx = p.colorIndex || 0;
      const patternIdx = GAME_CONSTANTS.PLAYER_PATTERNS.indexOf(p.pattern);
      return patternIdx * 10 + colorIdx;
    });

    callback({
      success: true,
      takenColors: takenColors,
      playerCount: room.players.size
    });
  });

  // Handle player reconnection
  socket.on('reconnect-player', ({ roomCode, sessionId }, callback) => {
    console.log(`Reconnection attempt - Room: ${roomCode}, Session: ${sessionId}`);

    const room = gameRooms.get(roomCode);
    if (!room) {
      return callback({ success: false, error: 'Room not found' });
    }

    // Check disconnected players for this session
    for (const [oldSocketId, player] of room.disconnectedPlayers) {
      if (player.sessionId === sessionId) {
        // Found the player, reconnect them
        const reconnectedPlayer = room.reconnectPlayer(socket.id, oldSocketId);

        if (reconnectedPlayer) {
          socket.join(roomCode);

          // Notify others that player reconnected
          io.to(roomCode).emit('player-reconnected', {
            player: reconnectedPlayer,
            totalPlayers: room.players.size
          });

          return callback({
            success: true,
            player: reconnectedPlayer,
            state: room.state
          });
        }
      }
    }

    // No matching session found
    callback({ success: false });
  });

  // Player joins room
  socket.on('join-room', ({ roomCode, playerName, colorIndex, sessionId }, callback) => {
    console.log(`Join request - Room: ${roomCode}, Name: ${playerName}, ColorIndex: ${colorIndex}, Session: ${sessionId}`);

    const room = gameRooms.get(roomCode);

    if (!room) {
      return callback({ error: 'Room not found' });
    }

    if (room.state !== GAME_CONSTANTS.GAME_STATES.LOBBY) {
      return callback({ error: 'Game already in progress' });
    }

    if (room.players.size >= GAME_CONSTANTS.MAX_PLAYERS) {
      return callback({ error: 'Room is full' });
    }

    const playerNumber = room.players.size;

    // Use selected color if provided, otherwise default
    let finalColorIndex;
    let patternIndex;

    if (colorIndex !== undefined && colorIndex !== null) {
      // Player selected a specific color+pattern combo
      // The client already sends the correct next available pattern
      finalColorIndex = colorIndex % 10;
      patternIndex = Math.floor(colorIndex / 10);

      // Log current players' colors
      console.log('Current players:');
      Array.from(room.players.values()).forEach(p => {
        console.log(`  - ${p.name}: color=${p.colorIndex}, pattern=${p.pattern}`);
      });

      // Double-check this combination isn't taken (shouldn't happen if client is working correctly)
      const isTaken = Array.from(room.players.values()).some(p => {
        const pColorIdx = p.colorIndex || 0;
        const pPatternIdx = GAME_CONSTANTS.PLAYER_PATTERNS.indexOf(p.pattern);
        const matches = pPatternIdx === patternIndex && pColorIdx === finalColorIndex;
        if (matches) {
          console.log(`  Conflict found: Player ${p.name} has color ${pColorIdx} with pattern ${p.pattern} (index ${pPatternIdx})`);
        }
        return matches;
      });

      if (isTaken) {
        // Instead of erroring, find the next available pattern for this color
        console.log(`Pattern ${patternIndex} for color ${finalColorIndex} is taken, finding next...`);

        let foundAvailable = false;
        for (let p = patternIndex + 1; p < GAME_CONSTANTS.PLAYER_PATTERNS.length; p++) {
          const patternTaken = Array.from(room.players.values()).some(player => {
            const pColorIdx = player.colorIndex || 0;
            const pPatternIdx = GAME_CONSTANTS.PLAYER_PATTERNS.indexOf(player.pattern);
            return pPatternIdx === p && pColorIdx === finalColorIndex;
          });

          if (!patternTaken) {
            patternIndex = p;
            foundAvailable = true;
            console.log(`Assigned pattern ${p} instead`);
            break;
          }
        }

        if (!foundAvailable) {
          return callback({ error: 'All patterns for this color are already taken' });
        }
      }
    } else {
      // Default assignment based on join order
      finalColorIndex = playerNumber % 10;
      patternIndex = Math.floor(playerNumber / 10);
    }

    const player = {
      id: socket.id,
      sessionId: sessionId,  // Store session ID for reconnection
      name: playerName || `Player ${playerNumber + 1}`,
      number: playerNumber + 1,
      color: GAME_CONSTANTS.PLAYER_COLORS[finalColorIndex],
      pattern: GAME_CONSTANTS.PLAYER_PATTERNS[patternIndex],
      colorIndex: finalColorIndex,  // Store for reference
      position: 0,
      taps: 0,
      tapsPerSecond: 0,
      finished: false,
      finishTime: null
    };

    console.log(`Creating player: ${player.name} with color ${finalColorIndex} and pattern ${GAME_CONSTANTS.PLAYER_PATTERNS[patternIndex]}`);

    room.addPlayer(player);
    socket.join(roomCode);

    // Notify all clients
    io.to(roomCode).emit('player-joined', {
      player,
      totalPlayers: room.players.size
    });

    callback({
      success: true,
      player,
      roomState: room.getState()
    });

    console.log(`Player ${player.name} joined successfully`);
  });

  // Handle player tap
  socket.on('tap', ({ roomCode }) => {
    const room = gameRooms.get(roomCode);
    if (!room || room.state !== GAME_CONSTANTS.GAME_STATES.RACING) return;

    const player = room.players.get(socket.id);
    if (!player || player.finished) return;

    player.taps++;
    player.position = Math.min(
      (player.taps / room.tapsRequired) * 100,
      100
    );

    // Check if player finished
    if (player.position >= 100 && !player.finished) {
      player.finished = true;
      player.finishTime = Date.now() - room.raceStartTime;
      player.finishPosition = room.finishOrder.length + 1;
      room.finishOrder.push(player);

      // Send personal finish notification to the player who just finished
      socket.emit('player-finished', {
        position: player.finishPosition,
        finishTime: player.finishTime,
        taps: player.taps,
        totalPlayers: room.players.size
      });

      // Notify all players about the finisher
      io.to(roomCode).emit('someone-finished', {
        playerId: socket.id,
        playerName: player.name,
        position: player.finishPosition
      });

      // Check if race is over
      if (room.finishOrder.length === room.players.size) {
        room.endRace();
        io.to(roomCode).emit('race-ended', room.getResults());
      }
    }
  });

  // Host controls
  socket.on('update-settings', ({ roomCode, settings }) => {
    const room = gameRooms.get(roomCode);
    if (!room || socket.id !== room.hostId) return;

    if (settings.raceLength) {
      room.raceLength = settings.raceLength;
    }
    if (settings.medalCount) {
      room.medalCount = settings.medalCount;
    }

    io.to(roomCode).emit('settings-updated', {
      raceLength: room.raceLength,
      medalCount: room.medalCount
    });
  });

  socket.on('start-race', ({ roomCode }) => {
    const room = gameRooms.get(roomCode);
    if (!room || socket.id !== room.hostId) return;
    if (room.players.size < GAME_CONSTANTS.MIN_PLAYERS) return;

    room.startCountdown();
    io.to(roomCode).emit('countdown-started');

    // Countdown sequence
    let count = 3;
    const countdownInterval = setInterval(() => {
      io.to(roomCode).emit('countdown', count);

      if (count === 0) {
        clearInterval(countdownInterval);
        room.startRace();
        io.to(roomCode).emit('race-started');

        // Start position update loop
        const updateInterval = setInterval(() => {
          if (room.state !== GAME_CONSTANTS.GAME_STATES.RACING) {
            clearInterval(updateInterval);
            return;
          }

          io.to(roomCode).emit('position-update', room.getPositions());
        }, GAME_CONSTANTS.TIMINGS.updateInterval);
      }
      count--;
    }, 1000);
  });

  socket.on('force-finish', ({ roomCode }) => {
    const room = gameRooms.get(roomCode);
    if (!room || socket.id !== room.hostId) return;
    if (room.state !== GAME_CONSTANTS.GAME_STATES.RACING) return;

    console.log(`⚠️ Host force-ending race in room ${roomCode}`);

    // Mark all unfinished players as DNF
    for (const player of room.players.values()) {
      if (!player.finished) {
        player.finished = true;
        player.dnf = true;
        player.finishTime = null;
      }
    }

    room.endRace();
    io.to(roomCode).emit('race-ended', room.getResults());
  });

  socket.on('request-rematch', ({ roomCode }) => {
    const room = gameRooms.get(roomCode);
    if (!room || socket.id !== room.hostId) return;

    room.resetForRematch();
    io.to(roomCode).emit('rematch-started', room.getState());
  });

  socket.on('leave-room', ({ roomCode }) => {
    const room = gameRooms.get(roomCode);
    if (!room) return;

    room.removePlayer(socket.id);
    socket.leave(roomCode);

    io.to(roomCode).emit('player-left', {
      playerId: socket.id,
      totalPlayers: room.players.size
    });

    if (room.players.size === 0) {
      gameRooms.delete(roomCode);
    }
  });

  socket.on('disconnect', (reason) => {
    console.log(`❌ Disconnected: ${socket.id}, Reason: ${reason}`);

    // Find and remove player from any room they were in
    for (const [roomCode, room] of gameRooms) {
      if (room.players.has(socket.id)) {
        room.removePlayer(socket.id);
        io.to(roomCode).emit('player-left', {
          playerId: socket.id,
          totalPlayers: room.players.size
        });

        if (room.players.size === 0) {
          gameRooms.delete(roomCode);
        }
        break;
      }
    }
  });

  socket.on('error', (error) => {
    console.error(`⚠️ Socket error for ${socket.id}:`, error);
  });
});

const PORT = GAME_CONSTANTS.PORT;
server.listen(PORT, () => {
  const networkIP = getNetworkIP();
  console.log('\n🎮 Retro 100m Dash Server Started!');
  console.log('=====================================');
  console.log(`📺 Main Display: http://localhost:${PORT}`);
  console.log(`📱 Local Network: http://${networkIP}:${PORT}`);

  if (process.env.BASE_URL) {
    console.log(`🌍 Public URL: ${process.env.BASE_URL}`);
  } else {
    console.log('\n💡 Tip: Phones on same WiFi can join via:');
    console.log(`   http://${networkIP}:${PORT}`);
    console.log('\n🔧 For remote testing, consider:');
    console.log('   1. ngrok: npx ngrok http 3000');
    console.log('   2. localtunnel: npx localtunnel --port 3000');
  }
  console.log('=====================================\n');
});