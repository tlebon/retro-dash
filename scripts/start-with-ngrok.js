#!/usr/bin/env node

const { spawn } = require('child_process');
const ngrok = require('ngrok');
const fs = require('fs');
const path = require('path');

async function start() {
  const PORT = process.env.PORT || 3000;

  console.log('🚀 Starting Retro 100m Dash with ngrok tunnel...\n');

  try {
    // Start ngrok tunnel
    const url = await ngrok.connect({
      addr: PORT,
      region: 'us' // Change to your preferred region: us, eu, ap, au
    });

    console.log(`✅ Ngrok tunnel established: ${url}`);

    // Create/update .env file with ngrok URL
    const envPath = path.join(__dirname, '../.env');
    let envContent = '';

    if (fs.existsSync(envPath)) {
      envContent = fs.readFileSync(envPath, 'utf8');
      // Update existing BASE_URL
      if (envContent.includes('BASE_URL=')) {
        envContent = envContent.replace(/BASE_URL=.*/, `BASE_URL=${url}`);
      } else {
        envContent += `\nBASE_URL=${url}`;
      }
    } else {
      envContent = `BASE_URL=${url}\nPORT=${PORT}`;
    }

    fs.writeFileSync(envPath, envContent);
    console.log('✅ Updated .env with ngrok URL\n');

    // Start the server
    const server = spawn('node', ['server/index.js'], {
      stdio: 'inherit',
      env: { ...process.env, BASE_URL: url }
    });

    // Handle shutdown
    process.on('SIGINT', async () => {
      console.log('\n👋 Shutting down...');
      server.kill();
      await ngrok.kill();
      process.exit(0);
    });

  } catch (error) {
    console.error('❌ Error starting ngrok:', error);
    process.exit(1);
  }
}

start();