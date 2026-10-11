/**
 * setup.js — Service registration & MCP Agent Config Generator
 *
 * Registers the Developer Companion server to start automatically at login,
 * then connects it to every coding agent found on this computer (see agents.js).
 */

import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { buildAgents } from "./agents.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_PATH = path.join(__dirname, "server.js");
const NODE_PATH = process.execPath;
const LOG_DIR = path.join(os.homedir(), ".developer-companion");

function installLinux() {
  const serviceDir = path.join(os.homedir(), ".config/systemd/user");
  const servicePath = path.join(serviceDir, "developer-companion.service");
  fs.mkdirSync(serviceDir, { recursive: true });
  fs.mkdirSync(LOG_DIR, { recursive: true });

  const unit = `[Unit]
Description=Developer Companion Agent Bridge
After=network.target

[Service]
ExecStart=${NODE_PATH} ${SERVER_PATH}
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
`;
  fs.writeFileSync(servicePath, unit, "utf8");
  try {
    execSync("systemctl --user daemon-reload");
    execSync("systemctl --user enable --now developer-companion.service");
    console.log(`\n✓ Installed systemd user service: ${servicePath}`);
    console.log("Developer Companion server is now running in the background and will start on login.\n");
  } catch (err) {
    console.log(`\nNote: systemd setup skipped (${err.message}). You can run manually with: node server.js\n`);
  }
}

function installMac() {
  const label = "com.developercompanion.server";
  const plistPath = path.join(os.homedir(), "Library/LaunchAgents", `${label}.plist`);
  fs.mkdirSync(path.dirname(plistPath), { recursive: true });
  fs.mkdirSync(LOG_DIR, { recursive: true });

  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${label}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${NODE_PATH}</string>
    <string>${SERVER_PATH}</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${path.join(LOG_DIR, "server.log")}</string>
  <key>StandardErrorPath</key><string>${path.join(LOG_DIR, "server.err.log")}</string>
</dict>
</plist>
`;
  fs.writeFileSync(plistPath, plist, "utf8");
  try { execSync(`launchctl unload "${plistPath}"`, { stdio: "ignore" }); } catch {}
  execSync(`launchctl load -w "${plistPath}"`);
  console.log(`\n✓ Installed LaunchAgent: ${plistPath}`);
}

function installWindows() {
  const startupDir = path.join(
    os.homedir(),
    "AppData", "Roaming", "Microsoft", "Windows", "Start Menu", "Programs", "Startup"
  );
  const vbsPath = path.join(startupDir, "developer-companion-server.vbs");
  fs.mkdirSync(startupDir, { recursive: true });
  fs.mkdirSync(LOG_DIR, { recursive: true });

  const vbs = `Set WshShell = CreateObject("WScript.Shell")\nWshShell.Run """${NODE_PATH}"" ""${SERVER_PATH}""", 0, False\n`;
  fs.writeFileSync(vbsPath, vbs, "ascii");
  console.log(`\n✓ Installed Windows startup script: ${vbsPath}`);
}

const platform = os.platform();
if (platform === "linux") installLinux();
else if (platform === "darwin") installMac();
else if (platform === "win32") installWindows();

// One click: register with every coding agent found on this computer.
console.log("\nConnecting Developer Companion to your coding agents:\n");
for (const agent of buildAgents(SERVER_PATH, NODE_PATH)) {
  let status = "not found — skipped";
  if (agent.detect()) {
    try { status = agent.register(); } catch (e) { status = `failed (${e.message})`; }
    if (status === "unreadable") status = "config has comments/invalid JSON — left untouched, add it by hand (see README)";
  }
  console.log(`  ${agent.name.padEnd(12)} ${status}`);
}
console.log("\nRestart any agent that was already open, then ask it to \"check the latest sketch\".");
console.log("Other agent? Add this to its MCP config:\n");
console.log(JSON.stringify({ mcpServers: { "developer-companion": { command: NODE_PATH, args: [SERVER_PATH] } } }, null, 2));
console.log("\nUsing a VM or another computer? Run: npm run lan -- on\n");
