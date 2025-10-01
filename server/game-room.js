const GAME_CONSTANTS = require('../shared/constants');

class GameRoom {
  constructor(roomCode, hostId) {
    this.roomCode = roomCode;
    this.hostId = hostId;
    this.players = new Map();
    this.disconnectedPlayers = new Map(); // Store disconnected players for reconnection
    this.state = GAME_CONSTANTS.GAME_STATES.LOBBY;

    // Settings (with defaults)
    this.raceLength = 'medium'; // 100m
    this.medalCount = 3;

    // Race data
    this.raceStartTime = null;
    this.finishOrder = [];
    this.tapsRequired = GAME_CONSTANTS.RACE_CONFIG.lengths.medium.taps;

    // Track last activity for cleanup
    this.lastActivity = Date.now();
    this.createdAt = Date.now();
  }

  // Update last activity timestamp
  updateActivity() {
    this.lastActivity = Date.now();
  }

  // Check if room is inactive (no activity for 30 minutes)
  isInactive() {
    const thirtyMinutes = 30 * 60 * 1000;
    return Date.now() - this.lastActivity > thirtyMinutes;
  }

  // Check if room is old and empty (created >2 hours ago with no players)
  isStale() {
    const twoHours = 2 * 60 * 60 * 1000;
    return this.players.size === 0 && (Date.now() - this.createdAt > twoHours);
  }

  addPlayer(player) {
    this.players.set(player.id, player);
    this.updateActivity();
  }

  removePlayer(playerId, temporary = true) {
    const player = this.players.get(playerId);

    if (player && temporary) {
      // Store player data for potential reconnection (keep for 5 minutes)
      this.disconnectedPlayers.set(playerId, {
        ...player,
        disconnectedAt: Date.now()
      });
    }

    this.players.delete(playerId);

    // If host left, assign new host
    if (playerId === this.hostId && this.players.size > 0) {
      this.hostId = this.players.keys().next().value;
    }
  }

  // Check if a player can reconnect
  canReconnect(playerId) {
    const disconnected = this.disconnectedPlayers.get(playerId);
    if (!disconnected) return false;

    // Allow reconnection within 5 minutes
    const fiveMinutes = 5 * 60 * 1000;
    return (Date.now() - disconnected.disconnectedAt) < fiveMinutes;
  }

  // Reconnect a player
  reconnectPlayer(socketId, oldPlayerId) {
    const disconnected = this.disconnectedPlayers.get(oldPlayerId);
    if (!disconnected) return null;

    // Restore player with new socket ID
    const player = {
      ...disconnected,
      id: socketId,
      disconnectedAt: undefined
    };

    this.players.set(socketId, player);
    this.disconnectedPlayers.delete(oldPlayerId);

    return player;
  }

  updateSettings(settings) {
    if (settings.raceLength && GAME_CONSTANTS.RACE_CONFIG.lengths[settings.raceLength]) {
      this.raceLength = settings.raceLength;
      this.tapsRequired = GAME_CONSTANTS.RACE_CONFIG.lengths[settings.raceLength].taps;
    }

    if (settings.medalCount !== undefined) {
      // Validate medal count is between 1 and 10
      const medalCount = parseInt(settings.medalCount);
      if (medalCount >= 1 && medalCount <= 10) {
        this.medalCount = medalCount;
      }
    }
  }

  startCountdown() {
    this.state = GAME_CONSTANTS.GAME_STATES.COUNTDOWN;
    this.resetPlayerStats();
  }

  startRace() {
    this.state = GAME_CONSTANTS.GAME_STATES.RACING;
    this.raceStartTime = Date.now();
    this.finishOrder = [];
  }

  endRace() {
    this.state = GAME_CONSTANTS.GAME_STATES.FINISH;

    // Move to podium after a delay
    setTimeout(() => {
      this.state = GAME_CONSTANTS.GAME_STATES.PODIUM;
    }, 1000);

    // Move to results after podium
    setTimeout(() => {
      this.state = GAME_CONSTANTS.GAME_STATES.RESULTS;
    }, GAME_CONSTANTS.TIMINGS.podiumDuration + 1000);
  }

  resetForRematch() {
    this.state = GAME_CONSTANTS.GAME_STATES.LOBBY;
    this.raceStartTime = null;
    this.finishOrder = [];
    this.resetPlayerStats();
  }

  resetPlayerStats() {
    for (const player of this.players.values()) {
      player.position = 0;
      player.taps = 0;
      player.tapsPerSecond = 0;
      player.finished = false;
      player.finishTime = null;
      player.finishPosition = null;
    }
  }

  getState() {
    return {
      roomCode: this.roomCode,
      hostId: this.hostId,
      state: this.state,
      players: Array.from(this.players.values()),
      settings: {
        raceLength: this.raceLength,
        medalCount: this.medalCount,
        tapsRequired: this.tapsRequired
      }
    };
  }

  getPositions() {
    const positions = Array.from(this.players.values())
      .map(player => ({
        id: player.id,
        name: player.name,
        number: player.number,
        color: player.color,
        pattern: player.pattern,
        position: player.position,
        taps: player.taps,
        finished: player.finished
      }))
      .sort((a, b) => b.position - a.position);

    return positions;
  }

  getResults() {
    // Separate finished players from DNF players
    const finishedPlayers = this.finishOrder.filter(p => !p.dnf);
    const dnfPlayers = Array.from(this.players.values()).filter(p => p.dnf);

    const results = {
      finishOrder: finishedPlayers.map((player, index) => ({
        ...player,
        medal: index < this.medalCount ? this.getMedal(index) : null
      })),
      dnf: dnfPlayers.map(p => ({
        ...p,
        position: 'DNF',
        finishTime: null
      })),
      raceStats: {
        duration: Date.now() - this.raceStartTime,
        totalPlayers: this.players.size,
        finishedCount: finishedPlayers.length,
        dnfCount: dnfPlayers.length,
        raceLength: GAME_CONSTANTS.RACE_CONFIG.lengths[this.raceLength].label
      }
    };

    return results;
  }

  getMedal(position) {
    const medals = ['🥇', '🥈', '🥉'];
    if (position < 3) {
      return medals[position];
    }
    if (position < this.medalCount) {
      return `${position + 1}th`;
    }
    return null;
  }

  getSpriteScale() {
    const playerCount = this.players.size;

    for (const [key, scale] of Object.entries(GAME_CONSTANTS.SPRITE_SCALES)) {
      if (playerCount <= scale.max) {
        return scale;
      }
    }

    return GAME_CONSTANTS.SPRITE_SCALES.xlarge;
  }
}

module.exports = GameRoom;