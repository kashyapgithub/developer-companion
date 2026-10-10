# Developer Companion 🛠️✨

All-in-one developer companion combining **UI Sketch Canvas**, **GitHub Repository Dashboard**, and **Browser Log Streamer** into a single Chrome extension with a unified **Model Context Protocol (MCP)** and HTTP Agent Bridge.

---

## 🌟 What is Developer Companion?

Developer Companion unites three essential developer workflows into a single interface:

1. **🎨 UI Sketch Canvas (Primary UI)**
   - Full-tab interactive design canvas to draw wireframes, UI components, layouts, and annotations.
   - One-click **"Send to project"** pushes wireframe JSON structure and rendered PNG preview straight to your AI coding agent via MCP.

2. **🐙 GitHub Repo Dashboard**
   - Accessible straight from the Canvas toolbar via the **"GitHub Dashboard"** button.
   - Opens as an embedded in-canvas modal drawer or standalone window.
   - Search, filter, tag, organize into folders, view recent commits, and generate AI summaries for all your GitHub repos.
   - Automatically syncs repository catalog to your local AI agent.

3. **📋 Browser Log Streamer & Diagnostics**
   - Dedicated **"Send browser logs to agent"** button on the Canvas toolbar.
   - Captures console output (`log`, `warn`, `error`), uncaught exceptions, and failed network calls (4xx/5xx) using Chrome DevTools Protocol (`chrome.debugger`).
   - Integrated live logs viewer drawer with search, type filters, and one-click stream to the local agent server.

---

## ⚡ Unified Agent Communication Bridge

Instead of multiple servers on different ports, Developer Companion features **one unified bridge** running locally on port `5959`:

```
┌────────────────────────────────────────────────────────┐
│               Developer Companion Extension            │
│  (Canvas UI + GitHub Dashboard + CDP Browser Logger)  │
└──────────────┬─────────────────────────┬───────────────┘
               │ HTTP POST /save         │ HTTP POST /logs
               ▼                         ▼
┌────────────────────────────────────────────────────────┐
│        Developer Companion Server (Node.js)            │
│         Port: 5959  ·  SQLite Database: logs.db        │
└──────────────────────────┬─────────────────────────────┘
                           │ Model Context Protocol (stdio)
                           ▼
┌────────────────────────────────────────────────────────┐
│       AI Coding Agents (Claude Code, Cursor, AGY)      │
└────────────────────────────────────────────────────────┘
```

### Unified MCP Tools:
| Tool Name | Description |
| :--- | :--- |
| `get_latest_sketch` | Returns wireframe component coordinates, labels, hierarchy, and rendered PNG preview image. |
| `get_browser_logs` | Returns recent console errors, exceptions, and failed HTTP requests with app/level filters. |
| `get_github_repos` | Returns cached repository catalog, stars, language, and AI descriptions from GitHub Dashboard. |
| `send_browser_command` | Sends remote commands to the user's active browser tabs (e.g. reload, localstorage snapshot). |
| `get_companion_status` | Overview of sketch, total captured logs, and sync status. |

---

## 🚀 Quick Start

### 1. Load the Chrome Extension
1. Open Google Chrome and navigate to `chrome://extensions/`.
2. Turn on **Developer mode** (top-right toggle).
3. Click **Load unpacked** (top-left).
4. Select this project root directory (`developer-companion`).
5. Click the extension icon in your Chrome toolbar — it immediately opens the full **UI Sketch Canvas** tab!

### 2. Start the Agent Bridge Server
Run the automated installer for your operating system:

- **macOS / Linux**: Double-click `Install-Mac-Linux.command` or run:
  ```bash
  cd server
  npm install
  node setup.js
  ```
- **Windows**: Double-click `Install-Windows.bat`

Or run manually anytime:
```bash
node server/server.js
```
The server will start on `http://127.0.0.1:5959` and initialize SQLite storage for logs and sketches.

### 3. Connect to Your AI Coding Agent

#### Claude Code:
Add to `~/.claude/mcp.json` or run:
```bash
claude mcp add developer-companion node /path/to/developer-companion/server/server.js
```

#### Cursor:
Go to **Cursor Settings** -> **Features** -> **MCP** -> **+ Add New MCP Server**:
- **Name**: `developer-companion`
- **Type**: `command`
- **Command**: `node /path/to/developer-companion/server/server.js`

#### Antigravity / Gemini CLI:
Add to your MCP configuration:
```json
{
  "mcpServers": {
    "developer-companion": {
      "command": "node",
      "args": ["/path/to/developer-companion/server/server.js"]
    }
  }
}
```

---

## 🖥️ Command-Line Log Querying

You can inspect captured browser logs right from your terminal anytime:

```bash
# Query recent logs from the past 60 minutes
node server/query_logs.js recent

# Filter by application and level
node server/query_logs.js recent --app localhost --level error

# Inspect grouped errors and fingerprints
node server/query_logs.js groups

# Inspect companion stats
node server/query_logs.js status
```

*(Python users can also use `python3 server/query_logs.py recent` — both run against the same SQLite database!)*

---

## 📁 Repository Structure

```
developer-companion/
├── manifest.json              # Chrome Manifest V3
├── background.js              # Unified service worker (CDP capture & messaging)
├── icons/                     # 16px, 48px, 128px icons
├── editor/                    # UI Sketch Canvas (Primary UI)
│   ├── editor.html            # Canvas HTML with Companion tools & modals
│   ├── editor.css             # Styling with companion buttons & drawer panels
│   ├── companion-bridge.js    # In-canvas GitHub modal & logs dispatch bridge
│   ├── main.js                # Canvas engine bootstrap
│   └── modules/               # Drawing tools, history, alignment, export, etc.
├── overlay/                   # GitHub Repo Dashboard
│   ├── overlay.html           # Standalone / iframe dashboard
│   ├── overlay.css            # macOS-style dashboard UI
│   ├── overlay.js             # Controller with auto-sync to companion agent
│   └── modules/               # GitHub API, AI summaries, storage, export
├── logs/                      # Browser logs viewer & options
│   ├── logs.html              # Full log viewer page
│   ├── logs.js                # Viewer logic
│   ├── options.html           # Debugger allowlist settings
│   └── options.js             # Allowlist settings controller
├── lib/                       # Shared browser libraries
│   ├── allowlist.js           # Domain allowlist (defaults to localhost)
│   ├── debugger-capture.js    # CDP event listeners (Console, Log, Network)
│   ├── log-sender.js          # Batched HTTP sender to port 5959
│   ├── forward-config.js      # Forwarding preferences
│   └── commands.js            # Browser remote commands execution
├── server/                    # Unified MCP Server & HTTP Bridge
│   ├── server.js              # Dual-mode MCP (stdio) + HTTP (5959) server
│   ├── storage.js             # SQLite logs database & sketch file manager
│   ├── config.js              # Config & LAN mode authorization
│   ├── query_logs.js          # Node CLI log inspector
│   ├── query_logs.py          # Python CLI log inspector (backward compatibility)
│   ├── server.py              # Python server fallback
│   └── setup.js               # Cross-platform login auto-start installer
├── Install-Mac-Linux.command  # Quick installer script
├── Install-Windows.bat        # Windows installer script
└── README.md
```

---

## 📄 License

MIT License. Designed and built with ❤️ by [Kashyap](https://github.com/kashyapgithub).
