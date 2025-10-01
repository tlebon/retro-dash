const GAME_CONSTANTS = {
  // Color system for up to 50 players
  PLAYER_COLORS: [
    '#FF6B6B', // Red
    '#4ECDC4', // Teal
    '#45B7D1', // Blue
    '#96CEB4', // Green
    '#FFEAA7', // Yellow
    '#DDA0DD', // Plum
    '#F4A460', // Sandy
    '#98D8C8', // Mint
    '#FFD93D', // Gold
    '#6C5CE7'  // Purple
  ],

  PLAYER_PATTERNS: [
    'solid',     // Players 1-10
    'striped',   // Players 11-20
    'dotted',    // Players 21-30
    'checker',   // Players 31-40
    'diagonal'   // Players 41-50
  ],

  // Sprite scaling based on player count
  SPRITE_SCALES: {
    small: { max: 12, size: 32, lanes: 1, showNames: true },
    medium: { max: 20, size: 24, lanes: 2, showNames: false },
    large: { max: 35, size: 16, lanes: 3, focusView: true },
    xlarge: { max: 50, size: 12, lanes: 4, minimapOnly: true }
  },

  // Race configuration
  RACE_CONFIG: {
    lengths: {
      short: { meters: 60, taps: 180, label: '60m Sprint', timeout: 2 * 60 * 1000 }, // 2 min
      medium: { meters: 100, taps: 300, label: '100m Classic', timeout: 3 * 60 * 1000 }, // 3 min
      long: { meters: 200, taps: 600, label: '200m Endurance', timeout: 6 * 60 * 1000 } // 6 min
    },
    defaultLength: 'medium',
    medalCounts: [3, 5, 10],
    defaultMedals: 3,
    tapToMeterRatio: 3 // 3 taps = 1 meter
  },

  // Game states
  GAME_STATES: {
    WAITING: 'waiting',
    LOBBY: 'lobby',
    COUNTDOWN: 'countdown',
    RACING: 'racing',
    FINISH: 'finish',
    PODIUM: 'podium',
    RESULTS: 'results'
  },

  // Timing
  TIMINGS: {
    countdownDuration: 3000, // 3 seconds
    podiumDuration: 5000,    // 5 seconds
    resultsDuration: 10000,  // 10 seconds
    updateInterval: 50       // Position updates every 50ms
  },

  // Network
  MAX_PLAYERS: 50,
  MIN_PLAYERS: 2,
  PORT: process.env.PORT || 3000
};

// For Node.js
if (typeof module !== 'undefined' && module.exports) {
  module.exports = GAME_CONSTANTS;
}