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
  allowEIO3: true, // Allow different Socket.io versions
  // Increase timeouts for production environments
  pingInterval: 25000, // How often to ping clients (25 seconds)
  pingTimeout: 60000, // How long to wait for pong before disconnecting (60 seconds)
  connectTimeout: 45000, // Connection timeout (45 seconds)
  // Allow larger payloads
  maxHttpBufferSize: 1e6
});

// Serve static files
app.use(express.static(path.join(__dirname, '../client')));

// Serve main display
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../client/main/index.html'));
});

// Health check endpoint for monitoring services (before room code route)
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    rooms: gameRooms.size,
    uptime: process.uptime()
  });
});

// Serve controller - simplified URL without /play/
app.get('/:roomCode', (req, res) => {
  // Check if it's a valid room code (6 chars, alphanumeric)
  const roomCode = req.params.roomCode.toUpperCase();
  if (roomCode.length === 6 && /^[A-Z0-9]+$/.test(roomCode)) {
    res.sendFile(path.join(__dirname, '../client/controller/index.html'));
  } else {
    // If not a valid room code, redirect to main page
    res.redirect('/');
  }
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
  // Use the actual port the server is running on
  const port = server.address() ? server.address().port : (process.env.PORT || 3000);
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

    // Generate QR code for joining - simplified URL
    const baseUrl = getBaseURL();
    const joinUrl = `${baseUrl}/${roomCode}`;
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
      if (callback) return callback({ error: 'Room not found' });
      return;
    }

    // Get full color indices (0-49, includes pattern)
    const takenColors = Array.from(room.players.values()).map(p => {
      // Calculate full index from color and pattern
      const colorIdx = p.colorIndex || 0;
      const patternIdx = GAME_CONSTANTS.PLAYER_PATTERNS.indexOf(p.pattern);
      return patternIdx * 10 + colorIdx;
    });

    if (callback) {
      callback({
        success: true,
        takenColors: takenColors,
        playerCount: room.players.size
      });
    }
  });

  // Handle player reconnection
  socket.on('reconnect-player', ({ roomCode, sessionId }, callback) => {
    console.log(`Reconnection attempt - Room: ${roomCode}, Session: ${sessionId}`);

    const room = gameRooms.get(roomCode);
    if (!room) {
      console.log(`⚠️  Room ${roomCode} not found for reconnection`);
      if (callback) return callback({ success: false, error: 'Room not found' });
      return;
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

          if (callback) {
            return callback({
              success: true,
              player: reconnectedPlayer,
              state: room.state
            });
          }
          return;
        }
      }
    }

    // No matching session found
    if (callback) callback({ success: false });
  });

  // Player joins room
  socket.on('join-room', ({ roomCode, playerName, colorIndex, sessionId }, callback) => {
    console.log(`Join request - Room: ${roomCode}, Name: ${playerName}, ColorIndex: ${colorIndex}, Session: ${sessionId}`);

    const room = gameRooms.get(roomCode);

    if (!room) {
      console.log(`⚠️  Room ${roomCode} not found`);
      if (callback) return callback({ error: 'Room not found' });
      return;
    }

    if (room.state !== GAME_CONSTANTS.GAME_STATES.LOBBY) {
      if (callback) return callback({ error: 'Game already in progress' });
      return;
    }

    if (room.players.size >= GAME_CONSTANTS.MAX_PLAYERS) {
      if (callback) return callback({ error: 'Room is full' });
      return;
    }

    const playerNumber = room.players.size;

    // Simplified color assignment - no blocking, just rotate patterns
    let finalColorIndex;
    let patternIndex;

    if (colorIndex !== undefined && colorIndex !== null) {
      // Player selected a color - count how many already have it and assign next pattern
      finalColorIndex = colorIndex;

      // Count how many players already have this color
      const playersWithThisColor = Array.from(room.players.values()).filter(p =>
        p.colorIndex === finalColorIndex
      ).length;

      // Assign next pattern in rotation
      patternIndex = playersWithThisColor % GAME_CONSTANTS.PLAYER_PATTERNS.length;

      console.log(`Player choosing color ${finalColorIndex}, ${playersWithThisColor} already have it, assigning pattern ${patternIndex} (${GAME_CONSTANTS.PLAYER_PATTERNS[patternIndex]})`);
    } else {
      // Default assignment based on join order
      finalColorIndex = playerNumber % 10;
      patternIndex = Math.floor(playerNumber / 10) % GAME_CONSTANTS.PLAYER_PATTERNS.length;
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

    if (callback) {
      callback({
        success: true,
        player,
        roomState: room.getState()
      });
    }

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

    // Use the updateSettings method to properly update all related values
    room.updateSettings(settings);
    room.updateActivity();

    io.to(roomCode).emit('settings-updated', {
      raceLength: room.raceLength,
      medalCount: room.medalCount,
      tapsRequired: room.tapsRequired
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

        // Auto-finish race after timeout (scaled by race length)
        const raceConfig = GAME_CONSTANTS.RACE_CONFIG.lengths[room.raceLength];
        const timeout = raceConfig.timeout;
        console.log(`⏱️  Race started with ${timeout / 1000}s timeout (${raceConfig.label})`);

        const raceTimeout = setTimeout(() => {
          if (room.state === GAME_CONSTANTS.GAME_STATES.RACING) {
            console.log(`⏱️  Race timeout in room ${roomCode} - marking unfinished players as DNF`);

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
            clearInterval(updateInterval);
          }
        }, timeout);

        // Clear timeout if race ends normally
        const originalEndRace = room.endRace.bind(room);
        room.endRace = function() {
          clearTimeout(raceTimeout);
          return originalEndRace();
        };
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
        const wasHost = socket.id === room.hostId;
        room.removePlayer(socket.id);

        io.to(roomCode).emit('player-left', {
          playerId: socket.id,
          totalPlayers: room.players.size
        });

        // Notify if host changed
        if (wasHost && room.players.size > 0) {
          console.log(`🎮 New host assigned in room ${roomCode}: ${room.hostId}`);
          io.to(roomCode).emit('host-changed', {
            newHostId: room.hostId
          });
        }

        if (room.players.size === 0) {
          console.log(`🗑️  Deleting empty room: ${roomCode}`);
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

// Periodic cleanup of inactive and stale rooms
setInterval(() => {
  const now = Date.now();
  const roomsToDelete = [];

  for (const [roomCode, room] of gameRooms.entries()) {
    // Remove rooms with no players that are >1 hour old
    if (room.players.size === 0 && room.disconnectedPlayers.size === 0) {
      const oneHour = 60 * 60 * 1000;
      if (now - room.createdAt > oneHour) {
        roomsToDelete.push(roomCode);
        console.log(`🧹 Cleaning up empty room: ${roomCode} (${Math.round((now - room.createdAt) / 60000)} minutes old)`);
      }
    }
    // Remove inactive rooms (no activity for 2 hours, even with players)
    else if (room.isInactive && room.isInactive()) {
      roomsToDelete.push(roomCode);
      console.log(`🧹 Cleaning up inactive room: ${roomCode} (${room.players.size} players, ${Math.round((now - room.lastActivity) / 60000)} minutes inactive)`);
    }

    // Clean up old disconnected players (older than 10 minutes)
    if (room.disconnectedPlayers.size > 0) {
      const tenMinutes = 10 * 60 * 1000;
      for (const [playerId, player] of room.disconnectedPlayers.entries()) {
        if (now - player.disconnectedAt > tenMinutes) {
          room.disconnectedPlayers.delete(playerId);
          console.log(`🧹 Removed stale disconnected player from room ${roomCode}`);
        }
      }
    }
  }

  // Delete marked rooms
  for (const roomCode of roomsToDelete) {
    gameRooms.delete(roomCode);
  }

  // Log memory stats every cleanup cycle
  if (gameRooms.size > 0 || roomsToDelete.length > 0) {
    console.log(`📊 Active rooms: ${gameRooms.size}, Cleaned: ${roomsToDelete.length}`);
  }
}, 10 * 60 * 1000); // Run cleanup every 10 minutes

const PORT = GAME_CONSTANTS.PORT;

// Handle port conflicts - automatically find an available port
server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.log(`⚠️  Port ${PORT} is already in use, finding an available port...`);
    server.listen(0); // 0 means assign any available port
  } else {
    console.error('Server error:', error);
    process.exit(1);
  }
});

// Try the default port first, then find an available one
server.listen(PORT, () => {
  const networkIP = getNetworkIP();
  console.log('\n🎮 Retro 100m Dash Server Started!');
  console.log('=====================================');
  console.log(`📺 Main Display: http://localhost:${server.address().port}`);
  console.log(`📱 Local Network: http://${networkIP}:${server.address().port}`);

  if (process.env.BASE_URL) {
    console.log(`🌍 Public URL: ${process.env.BASE_URL}`);
  } else {
    console.log('\n💡 Tip: Phones on same WiFi can join via:');
    console.log(`   http://${networkIP}:${server.address().port}`);
    console.log('\n🔧 For remote testing, consider:');
    console.log(`   1. ngrok: npx ngrok http ${server.address().port}`);
    console.log(`   2. localtunnel: npx localtunnel --port ${server.address().port}`);
  }
  console.log('=====================================\n');
});