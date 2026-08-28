#!/usr/bin/env node

import { exec, execSync } from 'node:child_process';
import { existsSync, writeFileSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { startServer } from '../src/server.js';
import { parseLogs } from '../src/parser/index.js';
import { buildCurlCommand } from '../src/builder/curlBuilder.js';

const args = process.argv.slice(2);
const command = args[0] || '';

// Help Menu
if (args.includes('--help') || args.includes('-h') || command === 'help') {
  console.log(`
🔍 cURL Finder CLI

Usage:
  curl-finder                Start web server & auto-open browser
  curl-finder clip           Directly parse macOS clipboard & copy cURL back!
  curl-finder daemon start   Run in background permanently (no terminal needed)
  curl-finder daemon stop    Stop background service
  curl-finder daemon status  Check background service status
  cat log.txt | curl-finder  Parse piped log stream to terminal

Options:
  --port <number>            Custom port (default: 3000)
  --no-open                  Do not auto-open browser
  --verbose, -v              Enable verbose curl flag (-v)
  --single                   Output single-line curl
`);
  process.exit(0);
}

// 1. CLIPBOARD INSTANT MODE: "curl-finder clip"
if (command === 'clip' || args.includes('--clip')) {
  try {
    const clipboardText = execSync('pbpaste', { encoding: 'utf-8' });
    if (!clipboardText.trim()) {
      console.log('⚠️ Clipboard is empty. Copy some logs first!');
      process.exit(1);
    }

    const requests = parseLogs(clipboardText);
    if (requests.length === 0) {
      console.log('❌ No HTTP requests or logs detected in clipboard.');
      process.exit(1);
    }

    // Sort by completeness (best first)
    requests.sort((a, b) => (b.completenessScore || 0) - (a.completenessScore || 0));

    const isMultiline = !args.includes('--single');
    const isVerbose = args.includes('-v') || args.includes('--verbose');

    console.log(`\n✨ Found ${requests.length} request(s) in clipboard. Best match (Line ${requests[0].lineNumber}):\n`);
    
    const bestCurl = buildCurlCommand(requests[0], { multiline: isMultiline, verbose: isVerbose });
    console.log(bestCurl);
    console.log('\n');

    // Copy back to clipboard
    try {
      execSync('pbcopy', { input: bestCurl });
      console.log('📋 Copied best cURL command to your clipboard! Ready to paste.\n');
    } catch {}

    process.exit(0);
  } catch (err) {
    console.error('Failed to read clipboard:', err.message);
    process.exit(1);
  }
}

// 2. MACOS DAEMON MODE: "curl-finder daemon start | stop | status"
const PLIST_LABEL = 'com.fathurk.curlfinder';
const PLIST_PATH = join(homedir(), 'Library', 'LaunchAgents', `${PLIST_LABEL}.plist`);
const APP_DIR = join(import.meta.dirname, '..');

if (command === 'daemon') {
  const sub = args[1] || 'status';

  if (sub === 'start') {
    const plistContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${PLIST_LABEL}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${process.execPath}</string>
        <string>${join(APP_DIR, 'src', 'server.js')}</string>
    </array>
    <key>WorkingDirectory</key>
    <string>${APP_DIR}</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>${join(APP_DIR, 'logs', 'daemon.log')}</string>
    <key>StandardErrorPath</key>
    <string>${join(APP_DIR, 'logs', 'daemon_err.log')}</string>
</dict>
</plist>`;

    try {
      writeFileSync(PLIST_PATH, plistContent, 'utf-8');
      try { execSync(`launchctl unload "${PLIST_PATH}" 2>/dev/null`); } catch {}
      execSync(`launchctl load "${PLIST_PATH}"`);
      console.log('🚀 cURL Finder background daemon started successfully!');
      console.log('🌐 Web app is now always active at: http://localhost:3000');
      console.log('💡 It will automatically stay running in the background across restarts.');
      exec('open http://localhost:3000');
    } catch (err) {
      console.error('Failed to install daemon:', err.message);
    }
    process.exit(0);
  }

  if (sub === 'stop') {
    try {
      if (existsSync(PLIST_PATH)) {
        try { execSync(`launchctl unload "${PLIST_PATH}"`); } catch {}
        unlinkSync(PLIST_PATH);
        console.log('🛑 Background daemon stopped and unregistered.');
      } else {
        console.log('Daemon is not installed.');
      }
    } catch (err) {
      console.error('Failed to stop daemon:', err.message);
    }
    process.exit(0);
  }

  if (sub === 'status') {
    try {
      const out = execSync('launchctl list | grep curlfinder || true', { encoding: 'utf-8' });
      if (out.trim()) {
        console.log('🟢 Background daemon is RUNNING.');
        console.log('🌐 Access the app at: http://localhost:3000');
      } else {
        console.log('⚪ Background daemon is NOT running.');
        console.log('💡 Run "curl-finder daemon start" to start it.');
      }
    } catch {
      console.log('⚪ Background daemon is not running.');
    }
    process.exit(0);
  }
}

// 3. STDIN PIPE MODE: "cat server.log | curl-finder"
if (!process.stdin.isTTY) {
  let stdinData = '';
  process.stdin.setEncoding('utf-8');
  process.stdin.on('data', chunk => { stdinData += chunk; });
  process.stdin.on('end', () => {
    if (!stdinData.trim()) {
      console.log('No input received via pipe.');
      process.exit(0);
    }
    const requests = parseLogs(stdinData);
    if (requests.length === 0) {
      console.log('No HTTP requests found in input.');
      process.exit(0);
    }
    requests.sort((a, b) => (b.completenessScore || 0) - (a.completenessScore || 0));
    
    console.log(`\n✨ Found ${requests.length} request(s):\n`);
    for (const req of requests) {
      console.log(buildCurlCommand(req, { multiline: !args.includes('--single') }));
      console.log('\n----------------------------------------\n');
    }
    process.exit(0);
  });
} else {
  // 4. DEFAULT INTERACTIVE SERVER MODE: "curl-finder"
  const portIndex = args.indexOf('--port');
  const port = portIndex !== -1 && args[portIndex + 1] ? parseInt(args[portIndex + 1], 10) : (process.env.PORT || 3000);
  const shouldOpen = !args.includes('--no-open');

  const server = startServer(port, () => {
    const url = `http://localhost:${port}`;
    console.log(`🚀 cURL Finder running at: ${url}`);
    if (shouldOpen) {
      exec(`open ${url}`);
    }
  });

  process.on('SIGINT', () => {
    console.log('\nShutting down cURL Finder server...');
    server.close(() => process.exit(0));
  });
}
