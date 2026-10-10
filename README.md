# Developer Companion

> **The ultimate bridge between your browser and AI coding agents.**  
> Draw UI wireframes, search and summarize your GitHub repos, and stream browser console errors straight to Claude Code, Cursor, or Antigravity - all in **one single Chrome extension**.

---

## 30-Second Summary

Instead of juggling three separate tools and multiple servers, **Developer Companion** combines everything into **one extension and one unified background bridge**:

| Feature | What it does | How it helps your AI Agent |
| :--- | :--- | :--- |
| **UI Sketch Canvas** | Draw wireframes and UI designs in a full browser tab. | AI gets exact coordinates, labels, hierarchy and high-res PNG to code your UI accurately. |
| **GitHub Dashboard** | Access all your repositories with AI summaries and tags. | AI gets a real-time catalog of your projects, dependencies, and codebases. |
| **Browser Logs to Agent** | One-click capture of console errors and network failures. | AI diagnoses frontend crashes and API bugs without you copy-pasting DevTools. |

---

## How It Works

```
┌────────────────────────────────────────────────────────────────────────┐
│                        DEVELOPER COMPANION EXTENSION                   │
│                                                                        │
│   [ Canvas Workspace ]       [ GitHub Dashboard ]       [ Send Logs ]  │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ Single connection to localhost:5959
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                    DEVELOPER COMPANION LOCAL BRIDGE                    │
│                        Node.js  ·  SQLite Database                     │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ Model Context Protocol (stdio)
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│               YOUR AI AGENT (Claude Code / Cursor / Windsurf)          │
│       "I see your wireframe sketch and 2 browser console errors!"       │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 3-Minute Quickstart

### Step 1: Load the Chrome Extension
1. Open Google Chrome and go to `chrome://extensions/`.
2. Turn on **Developer mode** (toggle in the top-right corner).
3. Click **Load unpacked** (top-left).
4. Select this folder: `developer-companion`.
5. Click the **Developer Companion** icon in your Chrome toolbar to open the Canvas.

---

### Step 2: Start the Local Agent Bridge
The extension talks to a local server on your computer that saves your sketches and logs.

- **Mac / Linux**: Double-click `Install-Mac-Linux.command` or run:
  ```bash
  cd server
  npm install
  npm start
  ```
- **Windows**: Double-click `Install-Windows.bat`

*The server will start at `http://127.0.0.1:5959` and create a local SQLite database for your logs.*

---

### Step 3: Connect to Your AI Coding Agent

#### Option A: Claude Code
Run this command in your terminal:
```bash
claude mcp add developer-companion node /absolute/path/to/developer-companion/server/server.js
```
*(Or add it to your `~/.claude/mcp.json` file)*

#### Option B: Cursor IDE
1. Open **Cursor Settings** (`Cmd+,` or `Ctrl+,`).
2. Go to **Features** -> **MCP** -> **+ Add New MCP Server**.
3. Fill in:
   - **Name**: `developer-companion`
   - **Type**: `command`
   - **Command**: `node /absolute/path/to/developer-companion/server/server.js`

#### Option C: Antigravity / Gemini CLI
Add this to your MCP configuration:
```json
{
  "mcpServers": {
    "developer-companion": {
      "command": "node",
      "args": ["/absolute/path/to/developer-companion/server/server.js"]
    }
  }
}
```

---

## How to Use the 3 Tools

### 1. UI Sketch Canvas (Main UI)
- **Click the extension icon** in Chrome -> The canvas opens in a full tab.
- Pick shapes, boxes, buttons, text, and connectors from the floating bottom dock.
- When your sketch is ready, click **"Send to project"** in the top toolbar.
- Your AI agent can now run `get_latest_sketch` to inspect your design and generate the matching frontend code.

### 2. GitHub Repo Dashboard
- Inside the canvas, click the **"GitHub Dashboard"** button in the top toolbar.
- A clean modal pops up showing all your public, private, and forked repos.
- Filter by language, search by keyword, view commit history, or let AI generate repo summaries.
- Clicking **"Pop out"** opens the dashboard in its own standalone floating window.
- The repo catalog is automatically shared with your local agent.

### 3. Send Browser Logs to Agent
- Whenever you test your web app on `localhost`:
  - The extension automatically monitors console logs, uncaught exceptions, and failed 4xx/5xx network calls.
- Just click **"Send browser logs to agent"** on the toolbar.
- An instant toast confirms: `Sent 14 logs to Agent Server`.
- Your agent can now run `get_browser_logs` to immediately find the bug and write the fix.
- Want to view the logs yourself? Click the icon next to the button to open the **Live Logs Drawer**.

---

## MCP Tools Reference (What Your Agent Can Do)

Your AI agent automatically gets access to these 5 tools:

| MCP Tool | What the Agent Can Ask For |
| :--- | :--- |
| `get_latest_sketch` | "Show me the UI sketch the user just drew on canvas." |
| `get_browser_logs` | "Get recent JavaScript errors and failed network calls from localhost." |
| `get_github_repos` | "List the user's GitHub repositories and their AI descriptions." |
| `send_browser_command` | "Tell the browser to reload or capture local storage." |
| `get_companion_status` | "Check if the server is healthy and how many logs are stored." |

---

## Terminal Commands

You can also view your logs directly in your terminal:

```bash
# View recent browser logs
node server/query_logs.js recent

# View only error logs from localhost
node server/query_logs.js recent --app localhost --level error

# View grouped errors and how many times they happened
node server/query_logs.js groups
```

*(Python users: `python3 server/query_logs.py recent` works identically)*

---

## Frequently Asked Questions

**Q: Do I need to start multiple servers?**  
No. Everything uses a single port (`5959`). Both sketches and browser logs talk to this single endpoint.

**Q: Does it send my data to the cloud?**  
No. All logs and sketches are stored 100% locally on your machine in a local SQLite file (`logs.db`).

**Q: What domains does the logger capture?**  
By default, it automatically captures `localhost` and `127.0.0.1`. You can add more domains in the extension settings page.

---

## License

MIT License. Designed and built by [Kashyap](https://github.com/kashyapgithub).
