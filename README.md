# 🏃 Retro 100m Dash

A multiplayer 8-bit style racing game where players tap to run! Supports 2-50 concurrent players with dynamic scaling.

## 🎮 Features

- **Multiplayer Racing** - Up to 50 players in a single race
- **Color + Pattern System** - Unique visual identification for all players
- **Dynamic Scaling** - Sprites automatically resize based on player count
- **Mobile Controls** - Tap anywhere on phone screen to run
- **Host Controls** - Adjustable race length and medal count
- **NES-Style Graphics** - Colorful 8-bit aesthetic
- **QR Code Joining** - Easy mobile access

## 🚀 Quick Start

### Local Network Testing (Same WiFi)

```bash
npm install
npm start
```

The server will display:
- **Main Display URL**: Open on TV/computer
- **Local Network URL**: Share with phones on same WiFi

### Remote Testing Options

#### Option 1: ngrok (Recommended for Testing)

```bash
# Install ngrok globally (one time)
npm install -g ngrok

# Run with ngrok tunnel
npx ngrok http 3000
```

Copy the HTTPS URL (like `https://abc123.ngrok.io`) and update your `.env`:
```
BASE_URL=https://abc123.ngrok.io
```

Then run:
```bash
npm start
```

#### Option 2: localtunnel (Alternative)

```bash
npm run start:tunnel
```

This creates a public URL like `https://retro100m.loca.lt`

#### Option 3: Manual Port Forwarding

1. Forward port 3000 on your router
2. Find your public IP: https://whatismyip.com
3. Update `.env`:
```
BASE_URL=http://YOUR_PUBLIC_IP:3000
```

## 📱 How to Play

1. **Host** opens main display (http://localhost:3000)
2. **Players** scan QR code or enter room URL
3. Players choose color and enter name
4. Host starts race when ready (min 2 players)
5. **TAP FAST** to run!
6. Top finishers get medals 🥇🥈🥉

## ⚙️ Configuration

### Environment Variables (.env)

```bash
# For local network
# Leave empty - will auto-detect

# For public access
BASE_URL=https://your-domain.com

# Server port
PORT=3000
```

### Game Settings (Host Controls)

- **Race Length**: 60m Sprint / 100m Classic / 200m Endurance
- **Medal Count**: Top 3 / Top 5 / Top 10

## 🎨 Player Scaling

| Players | Sprite Size | View Mode | Special Features |
|---------|------------|-----------|------------------|
| 2-12    | 32px       | Full view | Names visible |
| 13-20   | 24px       | 2 lanes   | Minimap enabled |
| 21-35   | 16px       | 3 lanes   | Focus view + minimap |
| 36-50   | 12px       | 4 lanes   | Minimap only |

## 🌐 Deployment

### Heroku

```bash
# Create Heroku app
heroku create your-app-name

# Deploy
git push heroku main

# Set environment variable
heroku config:set BASE_URL=https://your-app-name.herokuapp.com
```

### Railway/Render

1. Connect GitHub repo
2. Set environment variables in dashboard
3. Deploy automatically on push

### VPS (Digital Ocean, Linode, etc)

```bash
# Install Node.js and npm
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Clone and install
git clone https://github.com/yourusername/retro-100m.git
cd retro-100m
npm install

# Use PM2 for production
npm install -g pm2
pm2 start server/index.js --name retro-100m
pm2 save
pm2 startup

# Setup nginx reverse proxy (optional)
sudo apt-get install nginx
# Configure nginx to proxy port 3000
```

## 🛠️ Development

```bash
# Run with auto-restart on changes
npm run dev

# Test with specific number of mock players
# (Add test script in future update)
```

## 📝 Tech Stack

- **Backend**: Node.js, Express, Socket.io
- **Frontend**: HTML5 Canvas, Vanilla JS
- **Real-time**: WebSockets
- **Graphics**: Canvas API with pixel art styling

## 🐛 Troubleshooting

### "Connection Lost" on Mobile
- Ensure phone and server are on same WiFi network
- Check firewall isn't blocking port 3000
- Try using ngrok for remote testing

### QR Code Shows Wrong URL
- Update `BASE_URL` in `.env` file
- Restart server after changing environment variables

### Lag with Many Players
- Ensure good WiFi connection
- Consider reducing race length for 40+ players
- Host on stronger network/server

## 📄 License

MIT