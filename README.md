# Developer Companion

**Show your coding agent what you want, and what went wrong.**

Terminal agents like Claude Code, Cursor and Antigravity are great at code and bad at seeing. Developer Companion is a Chrome extension that gives them eyes: draw the UI you want, point at the bug you hit, and your agent reads both through one local connection.

- **Sketch it.** A Figma-style canvas right in the browser: frames, shapes, text, connectors, effects, layers, screenshots you can draw over, and flow diagrams for architecture.
- **Show the bug.** One click sends your page's console errors and failed network calls to the agent. No more copying from DevTools.
- **Keep your repos in reach.** Your GitHub repositories, tagged and summarized, are available to the agent as context.
- **Float over any tab.** Pop the editor over whatever page you are testing, move it, minimize it, keep drawing.

Everything runs on your machine. Nothing goes to a cloud service.

---

## How it works

```
   Chrome extension                      Local bridge                   Your agent
┌──────────────────────┐          ┌─────────────────────┐        ┌───────────────────┐
│ Canvas · Hover mode  │  HTTP    │ localhost:5959      │  MCP   │ Claude Code       │
│ Repos  · Browser logs│ ───────▶ │ Node.js + SQLite    │ ─────▶ │ Cursor            │
└──────────────────────┘          └─────────────────────┘        │ Antigravity …     │
                                                                 └───────────────────┘
```

The extension saves sketches, logs and your repo list to a small server on your computer. That same server speaks the Model Context Protocol (MCP), so your agent can ask for them with a tool call.

---

## Quickstart

### 1. Load the extension
1. Open `chrome://extensions/` and turn on **Developer mode**.
2. Click **Load unpacked** and choose this folder.
3. Click the Developer Companion icon in the toolbar to open the editor.

### 2. Start the local bridge
- **Mac / Linux:** double-click `Install-Mac-Linux.command`, or run:
  ```bash
  cd server
  npm install
  npm start
  ```
- **Windows:** double-click `Install-Windows.bat`.

The bridge listens on `http://127.0.0.1:5959` and keeps its data in `~/.developer-companion/`.

### 3. Connect your agent

**Claude Code**
```bash
claude mcp add developer-companion node /absolute/path/to/developer-companion/server/server.js
```

**Cursor** — Settings → Features → MCP → Add New MCP Server: name `developer-companion`, type `command`, command `node /absolute/path/to/developer-companion/server/server.js`.

**Antigravity, Gemini CLI and other MCP clients**
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

Then tell your agent: *"Check the latest sketch."*

---

## Using it

### Sketch your UI
- Pick tools from the floating dock at the bottom of the canvas.
- Style the selected shape in the **Design** tab on the right: fill, stroke, radius, opacity, effects, alignment.
- Manage structure in the **Layers** tab: drag to reorder or nest inside frames, collapse groups, rename with `F2`, right-click for more.
- **Add screenshot** (or `Ctrl/Cmd+Shift+K`, or just paste) brings in an image from your clipboard, a file, or a screen capture. Draw over it to say exactly what you mean.
- Add a comment pin to leave a note for the agent on a specific spot.
- Click **Send to project**. Your agent reads it with `get_latest_sketch`.

Choose how the sketch travels with **Send via**: a local file you drop into a project folder, or the MCP server. The gear next to it holds the folder, the path your agent sees (useful for VMs and shared folders), and a button that copies a ready-made prompt for your agent.

### Hover over tabs
Click **Hover over tabs** in the top bar and Chrome asks once for permission to show over web pages. Every tab then gets a small bubble:

- **Click** the bubble to open the editor in a floating window.
- **Drag** the header (or the bubble) anywhere. Drag the bottom-right corner to resize.
- **—** minimizes, **↗** opens the full-tab editor, **✕** hides it on that page until reload.

Your canvas is saved automatically and shared between tabs, so it follows you as you switch. A few sites with a strict Content-Security-Policy may refuse the floating editor; the full-tab editor always works.

### Record a session and send it to your agent
Testing your app and something breaks? Press **Record logs** in the top bar, reproduce the problem, then press **Stop & send**.

- A live timer and counters (`2 errors · 1 failed request`) show what's being captured. With **Hover over tabs** on, the page bubble turns red and shows the same timer, so you can stay on your app.
- The flag button drops a marker ("the button did nothing here") into the timeline.
- Recording captures everything: console output, exceptions, and every network request and response, not just errors. It also builds a timeline of where you navigated and what you clicked (never what you typed), and takes a small screenshot at each marker and the first time each error appears, so the agent sees what you saw.
- On stop, the whole session goes to your agent in one piece. Ask it to *"check the latest recording"* (`get_latest_recording`): it gets a summary with repeated errors grouped, your markers, the timeline, the screenshots, and the log lines in time order.
- If the agent server isn't running when you stop, the recording is kept and a **Retry** button appears.

Only sites in your allowlist are recorded (`localhost` and `127.0.0.1` by default; add more in the extension's settings page). **Send logs** still sends whatever was captured recently, without a recording. The log viewer next to it lets you read the logs yourself.

### GitHub dashboard
Click **GitHub** to browse your repositories with language filters, search, tags, folders and AI summaries (bring your own provider key). Pop it out into its own window if you like. The catalog is shared with your agent through `get_github_repos`.

---

## What your agent can call

| Tool | Use |
| :--- | :--- |
| `get_latest_sketch` | The sketch you just drew: shapes, layers, labels, coordinates, and a PNG preview. |
| `get_latest_recording` | The session you just recorded: summary, grouped errors, markers, timeline, and screenshots. |
| `capture_tab` | A screenshot of your running app, so the agent can check its own UI changes. |
| `get_browser_logs` | Recent console errors and failed network calls, without a recording. |
| `get_github_repos` | Your repository catalog with tags and summaries. |
| `send_browser_command` | Ask the browser to flush logs, attach to a tab, or report status. |
| `get_companion_status` | Server health and how much is stored. |

You can also query logs from a terminal:

```bash
node server/query_logs.js recent
node server/query_logs.js recent --app localhost --level error
node server/query_logs.js groups
```

---

## Privacy and security

- **Local only.** Sketches and logs live on your computer (`~/.developer-companion/`). Your GitHub token and AI keys stay in the browser's extension storage and are never sent to the bridge.
- **Web pages can't reach the bridge.** The server only answers the extension and local tools. Requests from ordinary websites, and DNS-rebinding tricks, are refused.
- **Secrets are masked.** When an error is captured, localStorage values that look like tokens, passwords, sessions or API keys are replaced with `[REDACTED]` before they are stored.
- **Opt-in remote access.** To let an agent on another machine or VM reach the bridge, set `{ "lan": true, "token": "your-code" }` in `~/.developer-companion/config.json`. Remote callers must then send that access code; callers on the same computer don't need it.
- If you need an extra trusted web origin (for example a hosted viewer), list it in the `COMPANION_ALLOWED_ORIGINS` environment variable.

---

## Project layout

| Folder | What lives there |
| :--- | :--- |
| `editor/` | The canvas editor: engine, tools, layers, effects, and the UI chrome in `editor/ui/`. |
| `hover/` | The floating-window content scripts. |
| `overlay/` | The GitHub dashboard. |
| `logs/` | The log viewer and settings page. |
| `lib/` | Extension background modules (log capture, allowlist, commands, hover manager). |
| `server/` | The local bridge and MCP server. |
| `background.js` | The extension's service worker. |

---

## FAQ

**Do I need more than one server?** No. One process on port `5959` handles sketches, logs, repos and the MCP connection.

**Does it work with agents running in a VM?** Yes. Share a folder with the VM and set the agent path, or enable remote access as described above.

**Which sites are captured?** `localhost` and `127.0.0.1` by default. You choose any others.

---

## License

MIT. Designed and built by [Kashyap](https://github.com/kashyapgithub).

