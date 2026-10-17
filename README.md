# Developer Companion

**Show your coding agent what you want, and what went wrong.**

Terminal agents like Claude Code, Cursor and Antigravity are great at code and bad at seeing. Developer Companion is a Chrome extension that gives them eyes: draw the UI you want, point at the bug you hit, and your agent reads both through one local connection.

- **Sketch it.** A Figma-style canvas right in the browser: frames, shapes, text, connectors, effects, layers, and flow diagrams for architecture.
- **Point at your app.** Capture a tab onto the canvas, or click any element on a page to bring in its screenshot, selector, HTML and styles. Draw over it to say exactly what you mean.
- **Record a video review.** Pause on any moment and write what you want next to what's happening; the agent gets every frame with your notes.
- **X-ray any web product.** Hover to see what every element is and where it sits in the page, select it, and send it to your agent.
- **Compare design and reality.** Lay your sketch over the live page, semi-transparent.
- **Show the bug.** Record a session while you test: console errors, failed requests, your clicks and page changes, and screenshots at the moments that matter. One click sends it all to the agent.
- **Let the agent look and test.** Your agent can screenshot your running app, and even record a session while it clicks through to reproduce a bug on its own.
- **Keep your repos in reach.** Your GitHub repositories, tagged and summarized, are available to the agent as context.
- **Float over any tab.** Pop the editor over whatever page you are testing, move it, minimize it, keep drawing.
- **One-click setup.** The installer connects Claude Code, Cursor, opencode and Antigravity for you, and works for agents in a VM too.

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

### 2. Connect your agent (about 2 minutes)

You need [Node.js 22+](https://nodejs.org). Then:

```bash
git clone https://github.com/kashyapgithub/developer-companion
cd developer-companion/server
npm install
npm run setup        # starts the bridge at login AND connects your agents
```

On Windows or Mac you can double-click `Install-Windows.bat` / `Install-Mac-Linux.command` instead.

`npm run setup` finds the agents on your computer and registers Developer Companion with each one. You'll see something like:

```
  Claude Code  added
  Cursor       added
  opencode     not found — skipped
  Antigravity  not found — skipped
```

**Now restart your agent** (a new session is enough for Claude Code) and try it:

1. In the extension, draw a box and click **Send to project** (with **Send via → MCP server** selected).
2. Tell your agent: *"Check the latest sketch."*

If it answers with what you drew, you're connected. That's the whole setup.

#### Prove it works in 10 seconds
Ask your agent: *"List your Developer Companion tools."* You should see `get_latest_sketch`, `get_browser_logs`, `get_latest_recording` and the rest of the [tool list](#what-your-agent-can-call). Or run `claude mcp list` in a terminal; `developer-companion` should show as connected.

#### Connect by hand (any agent)
Installed an agent later? Run `npm run connect` again; it's safe to repeat and never overwrites your other MCP servers (it backs up a config before changing it). Prefer to do it yourself?

| Agent | Command or file |
| :--- | :--- |
| **Claude Code** | `claude mcp add --scope user developer-companion -- node /full/path/to/developer-companion/server/server.js` |
| **Cursor** | `~/.cursor/mcp.json` |
| **Antigravity** | `~/.gemini/config/mcp_config.json` |
| **opencode** | `~/.config/opencode/opencode.json` (uses `"mcp"` with a `command` array) |
| **Anything else** | Its MCP config, same snippet as below |

For the JSON-style configs, add:
```json
{
  "mcpServers": {
    "developer-companion": {
      "command": "node",
      "args": ["/full/path/to/developer-companion/server/server.js"]
    }
  }
}
```
Use the **full absolute path**; `~` and relative paths are the most common reason an agent says "server failed to start".

#### Not working?
| You see | Do this |
| :--- | :--- |
| Agent says it has no such tool | Restart the agent, then run `npm run connect` and check your agent shows `added`. |
| Agent says "No sketch has been exported yet" | You're connected. Click **Send to project** in the editor first. |
| Editor says **Can't reach this computer** | The bridge isn't running. Run `npm run setup` again, or `npm start` inside `server/`. Press **Test** in the Agent connection gear. |
| "Port 5959 already in use" in a log | Harmless: another copy of the bridge is already running and the agent shares its data. |
| Cursor/opencode config "left untouched" | Your config has comments. Add the snippet above by hand. |

To remove the autostart entry, run `npm run uninstall-setup`.

### 3. Agent in a VM, or on another computer?
Run this on the machine where the bridge lives:
```bash
cd server
npm run lan -- on
```
It prints an address, a port and an **access code** (like `K7QD-4MXR`). In the extension, open the gear next to **Send via** (Agent connection), choose *In a VM or another computer*, type the address, port and code, and press **Test** (the dot turns green). Remote callers must present the code; the same computer never needs it. Wrong code? The editor says so and nothing is sent. `npm run lan -- off` goes back to this-computer-only.

Your agent still connects to the bridge with the steps above, on the machine it runs on.

---

## Using it

### Sketch your UI
- Pick tools from the floating dock at the bottom of the canvas.
- Style the selected shape in the **Design** tab on the right: fill, stroke, radius, opacity, effects, alignment.
- Manage structure in the **Layers** tab: drag to reorder or nest inside frames, collapse groups, rename with `F2`, right-click for more.
- **Add screenshot** (or `Ctrl/Cmd+Shift+K`, or just paste) brings in an image. The menu has:
  - **Paste from clipboard** and **Upload image**.
  - **Capture this tab**: screenshots the web page you were just on, without a picker.
  - **Pick an element on the page**: click any part of a page (arrow keys move to its parent or child, `Esc` cancels) and the canvas gets a cropped screenshot. The agent also gets the element's selector, HTML and computed styles, with form values left out.
  - **Capture screen / window**: the browser's screen-share picker.
  Draw over any of them to say exactly what you mean.
- Add a comment pin to leave a note for the agent on a specific spot.
- Click **Send to project**. Your agent reads it with `get_latest_sketch`.

Choose how the sketch travels with **Send via**: a local file you drop into a project folder, or the MCP server. The gear next to it holds the folder, the path your agent sees (useful for VMs and shared folders), and a button that copies a ready-made prompt for your agent.

### Video review: show exactly what you want vs what's happening
Press the video button in the top bar. A small window opens:

1. **Choose what to record** and pick the browser tab with your app. Console and network logs are captured alongside (untick to skip).
2. Use your app as normal. When you reach the moment that matters, press **Pause & annotate**. The video freezes on that exact frame.
3. Write **What I want** and **What's happening**. You can also draw straight on the paused frame with **Arrow**, **Box** or **Pen** (colour picker, Undo, Clear); the marks are burned into the frame your agent receives. **Save moment & resume** keeps recording; **Draw on it** puts the frame on your canvas instead.
4. **Mark moment** is the one-click version while recording: it keeps the frame without stopping.
5. **Stop & send.** The video file and every moment go to your agent.

Ask your agent to *"check the video review"* (`get_video_review`). It gets each moment with its screenshot, your two notes and the time, plus the video file's path for tools that can watch video, and the id of the log recording made at the same time. Frames and notes are what coding agents read best; the video is there for tools and people that can watch it.

### X-ray: hover any page, see what each element is
Press the X-ray button in the top bar (or `Alt+Shift+X` on any page) and hover over a web product:

- Each element gets a name chip: its framework component (React or Vue, when the page exposes it), test id or label, then `tag#id.class` and its size.
- **Click** to select it (the page doesn't react), **Shift+click** to add more.
- The bar at the bottom shows the **hierarchy** (`body › div#app › form › button`). Click any crumb to jump to that ancestor; ↑ and ↓ also move to the parent or first child.
- **Add to canvas** drops the selection onto your sketch as cropped images with their details attached. **Send to agent** sends them straight to your agent, which reads them with `get_selected_elements` (selector, component, hierarchy, HTML, styles and a screenshot of each). **Copy selector** does what it says.
- `Esc` leaves X-ray.

It works on any normal web page once you've allowed page access. Chrome's own pages (`chrome://…`, the Web Store) are off limits, and content inside cross-origin iframes isn't reachable.

### Inspiration library: keep screenshots from around the web
Found a design you love? Save it, sort it, and tell your agent *"match the style of my Dashboards folder."*

- **Save:** select any image on the canvas and press **Save to inspiration** in the Design panel. Or open **Add screenshot** and turn on **Also save to Inspiration**, and every capture, paste or upload is kept automatically (tab captures remember the page URL).
- **Organise:** the **Inspiration** tab has folders, search, a note for each image ("why I saved this") and a rename/move/delete for everything. Drag a thumbnail onto a folder chip to file it. Deleting a folder never deletes its images; they go back to *Unsorted*.
- **Use:** double-click a thumbnail (or **Add to canvas**) to put it on the canvas next to your sketch.
- **Your agent:** `get_inspiration` returns the images with their notes and source URLs. Ask for a folder by name, search by text, or call it with no arguments to see your folders.
- **Where it lives:** plain files in `~/.developer-companion/inspiration/` on the machine running the bridge, so it survives reinstalling the extension.

### Stream: let your agent watch everything live `[testing purpose]`
Press **Stream** in the top bar (it turns red and carries a **[testing purpose]** tag so you don't leave it on by accident). While it's on, **everything** from your allowed tabs goes to your agent within a moment, whatever your log settings say:

- every console line, warning and uncaught error;
- every network request as one line when it finishes: `POST /api/orders → 201 (84ms, 1.2KB)`, with the request and response bodies (secrets and passwords masked, long bodies cut);
- page navigation and every click or form submit.

Your agent follows along with `watch_console`: it waits until something new appears, returns it with a cursor, and calls again from that cursor, so nothing is missed or repeated. Ask it *"watch everything while I click through the checkout"*. It can narrow things down with `kinds` (`console`, `network`, `navigation`, `action`), `app` (a site) and `min_level`. Turn Stream off when you're done: with it off, only the categories ticked in your log settings are sent.

### Full-stack debugging tools (agent side)
These are for the agent, not buttons. Once connected, just ask in plain words. They only touch tabs on your allowed sites (localhost by default).

- **Network inspector** (`get_network_requests`): "what did POST /api/orders send and get back?" Headers and JSON bodies, newest first, filter by URL, method or `failed`/`4xx`/`5xx`. Passwords, tokens and cookies are masked. Kept in memory only.
- **Front-to-back trace** (`get_trace`): joins a failing browser request with your server's log lines by request id and time. Run your dev server through the wrapper so its output is captured: `node /full/path/to/developer-companion/server/tail.js --name api -- npm run dev` (it prints everything as usual and also sends the lines to the bridge).
- **Visual diff** (`visual_diff`): saves a baseline screenshot by name, then later reports what changed, with a diff image and the changed regions. Pass `update_baseline: true` to accept a change.
- **Design tokens** (`get_design_tokens`, also **Add screenshot > Design tokens of this page**): the colours, fonts, radii, shadows and spacing a page really uses, as CSS variables and a Tailwind snippet.
- **Responsive check** (`capture_responsive`): screenshots at 375 / 768 / 1280 (or your widths) and flags pages that scroll sideways.
- **Network throttle** (`set_network_throttle`): `slow-3g`, `fast-3g`, `offline` or `none`, to see loading and error states.
- **Page state** (`get_page_state`): localStorage, sessionStorage, cookie names (never values) and framework globals such as `__NEXT_DATA__`. Secrets are masked.
- **Accessibility + performance** (`audit_page`): missing alt text, unnamed buttons, unlabelled fields, heading order, low contrast, plus FCP, LCP, layout shift and page weight, each rated good / needs work / poor. A quick scan, not a full WCAG audit.
- **API mocks** (`set_mock`, `list_mocks`, `clear_mocks`): answer a request with a fake 500, an empty list, a slow reply or a dropped connection to see how your UI copes. `from_recorded` starts from the last real response. Mocks last until cleared or the tab closes.

### Explain flow to agent: draw a flowchart and send it
Press **Explain flow** in the top bar. The panel gives you **Start**, **Step**, **Decision** and **End** blocks. Select a block and press a kind: the new block appears next to it, already joined by an arrow (out of a decision the exits come pre-labelled **Yes** and **No**). Double-click a block or arrow to name it, or use the **Arrow tool** to join blocks yourself. Type the story in your own words, then press **Explain flow to agent**.

**Tidy up** re-arranges your blocks into clean rows. **Draw from Mermaid** turns a pasted flow (your agent can write one) into blocks on the canvas in one undo step, and **Copy Mermaid** goes the other way. Your explanation is remembered between sessions, and the flow travels in handoff files.

Your agent calls `get_latest_flow` and gets your explanation, the flow as Mermaid text and as structured blocks and arrows, a picture, and a list of anything that looks unfinished (a decision with one exit, an unlabeled arrow, a dead end that isn't marked End), so it can ask you instead of guessing.

### API client: a Postman replacement, built in
Press the **API** button in the editor's top bar. A small window opens (not a tab) with:
- **Collections** with folders, and a **history** of what you sent.
- **Environments** with `{{variables}}` (plus `{{$guid}}`, `{{$timestamp}}`, `{{$isoTimestamp}}`, `{{$randomInt}}`). Pick the active one in the top bar.
- A request builder: method, URL, params, headers, auth (bearer, basic, API key) and body (JSON, text, form).
- **Tests**: simple checks on the response (status, JSON field, header, body, time). No scripting needed.
- **Extract**: save a value from a response (for example a login token) into the environment, so the next request can use `{{token}}`. **Run collection** (the ▶ next to a collection) runs everything in order.
- **Import** from a curl command or a Postman v2.1 collection / environment (common `pm.test` and `pm.environment.set` scripts become Tests and Extract rules; anything else is listed, never silently dropped), or pull calls your app made from **From traffic**. **Copy curl** goes the other way.

Requests are sent by the local bridge, so they come from the computer the bridge runs on (matters if it runs in a VM). Your agent can use the same collections with `api_list`, `api_run`, `api_run_collection` and `api_save`. The agent may only call `localhost` and hosts that appear in your environments or collections; you can call anything from the window. Saved data lives in the bridge's store folder under `api/`.

### Security checks, load and double-submit tests
Open a request in the API window and press **Security**, **Load** or **Double-submit**. The 🛡 next to a collection checks every request in it.
- **Security** tries the request without a token, with a bad token, as another user (paste a second user's token to test "can I read someone else's data?"), with extra fields (mass assignment), broken and oversized JSON, injection strings, and looks for missing security headers and leaked secrets or stack traces in responses. Each finding says what was sent and what came back.
- **Load** sends many requests with a few at a time (up to 500 / 50) and reports requests per second, errors and p50 / p95 / p99.
- **Double-submit** fires the same request several times at once (up to 20) and tells you if it created duplicate records, the classic double-click and retry bug.

Security also checks that a **retry with the same `Idempotency-Key`** doesn't create a second record, and (if you set an environment variable `expiredToken`) that an **old, logged-out token is refused**.

Only point these at servers you own. These tests send **real requests**, so for anything that isn't a GET the window asks first (use a dev database), and your agent has to pass `allow_changes: true` after you agreed; otherwise `api_security` and `api_stress` refuse and say why.

### Spot N+1 queries with the optional backend helper
A browser can't see inside your server, so the folder `probe/` is a tiny zero-dependency helper for your Node backend:

```js
import { queryCounter, instrument } from "./probe/index.js";
app.use(queryCounter({ enabled: process.env.NODE_ENV !== "production" }));  // before your routes
instrument(pool);                                                            // pg, mysql2, knex… (.query) or better-sqlite3 / node:sqlite
```

Responses then carry `x-dc-queries` and `x-dc-query-ms`. The API client shows a **N queries** chip, warns on the N+1 shape (about as many queries as items in the list), and you can add a test **DB queries < 10**. The agent's `api_run` gets the same numbers. Prisma: `prisma.$on("query", (e) => count(Number(e.duration)))`.

### 3D motion: draw how things should move
Press the **3D motion** button in the editor's top bar. A window opens with a 3D space (floor grid, axes, and a box showing your element's size).
- Pick the **plane** you draw on (front, floor or side) and its **offset**, then **Draw** a freehand curve, or use **Points** to click a path. Change the plane and **Shift+drag** to continue the same curve in another direction, which is how a curve becomes truly 3D. **Edit** drags a point in the plane facing you (hold **Shift** to move it along the chosen plane and change its depth). Right-drag turns the view, the wheel zooms.
- Every curve has its own **colour**, **label**, what it moves (`.card`, `logo`…), duration, easing, loop and notes. Labels show on the curves.
- Set the **perspective** and the element size, and write the motion in your own words.

**Send motion to agent** gives your agent `get_latest_motion`: each curve with its label and colour, ready CSS `@keyframes` using `translate3d` (relative to the start, so 0% is where the element sits), the `perspective` to use, the control points, your words and a picture. Axes follow CSS: x right, y down, z toward you.

### Acceptance checks: prove it works
Your agent runs `run_checks` with plain Given/When/Then text and your real browser does it, with real clicks and typing:

```
Scenario: Sign in
  Given I open /login
  When I type "a@b.co" into #email
  And I click "Sign in"
  Then I see "Welcome"
  And the url contains /dashboard
  And POST /api/login returned 200
  And there are no console errors
```

A check stops at its first failing step and returns evidence: the step and why, a screenshot, console errors, failed requests and what the page said instead. `checks_from_recording` turns a session you recorded into a draft check, and adds "I see …" lines from what the page shows at the end (typed values are never recorded, so you add those). Only allowed sites are driven.

### Web vitals: did it get slower?
`get_vitals` measures LCP, INP and CLS (plus FCP, TTFB and main-thread blocking) in your real tab, rated good / needs work / poor, with the reason: which element is the LCP, what shifts the layout, which click was slow and whether it was waiting, running or painting. Save a **baseline** before a change and **compare** after it to see if it regressed. INP needs an interaction first, so click around or run `run_checks` before asking.

### Session handoff: move your work to another machine
Open the gear (Agent settings) and press **Export handoff**. You get one `.json` file with your sketch, X-ray selection, video review notes and frames (not the video file), and your inspiration library. On the other computer or VM, press **Import handoff** and pick the file. Importing twice doesn't duplicate your inspiration images. Your agent can also create the file itself with `export_handoff`.

### Overlay your sketch on the live app
Press **Overlay** to lay your sketch (or the frame you have selected) over the page you were just on, semi-transparent, so you can compare design and reality. The page stays clickable. A small bar on the page has an opacity slider, **Align** (drag the sketch into place) and ✕. Press Overlay again to remove it.

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
| `start_recording`, `stop_recording` | The agent records a session itself, then reads it with `get_latest_recording`. |
| `interact_with_page` | The agent clicks, fills inputs, navigates or reloads in your app (allowed sites only) to reproduce a bug. |
| `get_video_review` | Your screen recording: each paused moment with its frame, what you want vs what's happening, and the video file. |
| `get_selected_elements` | The elements you selected with X-ray: selector, component, hierarchy, HTML, styles, screenshots. |
| `capture_tab` | A screenshot of your running app, so the agent can check its own UI changes. |
| `get_browser_logs` | Recent console errors and failed network calls, without a recording. |
| `get_github_repos` | Your repository catalog with tags and summaries. |
| `send_browser_command` | Ask the browser to flush logs, attach to a tab, or report status, and get the answer back. |
| `get_inspiration` | Your saved inspiration screenshots, by folder or search, with your notes and source URLs. |
| `get_companion_status` | Server health and how much is stored. |
| `get_network_requests` | Recorded requests with headers and bodies (secrets masked), filtered by URL, method or status. |
| `get_trace` | One failing request joined with the server log lines it caused. |
| `visual_diff` | Compare the live page with a saved baseline: diff image and changed regions. |
| `get_design_tokens` | The colours, fonts, spacing and shadows a page uses, as CSS and Tailwind. |
| `capture_responsive` | Screenshots at several widths, with a sideways-scroll check. |
| `set_network_throttle` | Slow 3G, fast 3G, offline or normal network for your app tab. |
| `get_page_state` | localStorage, sessionStorage, cookie names and framework state, secrets masked. |
| `audit_page` | Quick accessibility checks and load performance. |
| `set_mock`, `list_mocks`, `clear_mocks` | Fake API responses (errors, empty, slow, failing) for your running app. |
| `get_latest_flow` | The flowchart you sent with **Explain flow**: your explanation, Mermaid, blocks and arrows, a picture, and anything unfinished. |
| `api_list`, `api_run`, `api_run_collection`, `api_save` | Use your API client collections: list them, send a request, run a whole collection with its tests, save a new request. |
| `api_security`, `api_stress` | Security probes (no auth, bad token, other user, mass assignment, injection, headers, leaks) and load / double-submit tests for requests you own. |
| `get_latest_motion` | The 3D curves you drew: labels, colours, CSS `translate3d` keyframes, perspective, your words and a picture. |
| `run_checks`, `checks_from_recording` | Run Given/When/Then checks in your real tab with evidence on failure; draft a check from a recording. |
| `get_vitals` | LCP, INP, CLS with causes, plus baseline save and compare. |
| `watch_console` | Follows your browser live (needs **Stream** on): console, network requests with bodies, navigation and clicks, with a cursor to continue. |
| `export_handoff` | Packs the whole session into one file to hand over. |

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
- **Opt-in remote access.** Off by default. `npm run lan -- on` turns it on and creates an access code; remote callers must send it, callers on the same computer don't.
- If you need an extra trusted web origin (for example a hosted viewer), list it in the `COMPANION_ALLOWED_ORIGINS` environment variable.

---

## Project layout

| Folder | What lives there |
| :--- | :--- |
| `editor/` | The canvas editor: engine, tools, layers, effects, and the UI chrome in `editor/ui/`. |
| `hover/` | The floating-window content scripts. |
| `overlay/` | The GitHub dashboard. |
| `logs/` | The log viewer and settings page. |
| `lib/` | Extension background modules (log capture, allowlist, commands, hover manager). `lib/agent-tools/` holds one small file per agent browser tool (network, tokens, audit, mocks…). |
| `api/` | The API client window (request editor, collections, environments, import). Its engine is in `server/api/`. |
| `server/` | The local bridge and MCP server, plus the installer, agent-connect and LAN tools. |
| `video/` | The Video review window: recording, pause, notes, drawing on frames. |
| `picker/`, `xray/`, `sketch-overlay/` | Scripts injected into a page for element picking, X-ray mode and the sketch overlay. |
| `test/` | Tests: `node/` (fast) and `browser/` (real Chromium with the real extension). |
| `background.js` | The extension's service worker. |

---

## Development

```bash
npm install            # test tooling (puppeteer-core)
npm run test:node      # fast tests: recording, agent connect
# npm run test:browser also runs the full send-to-agent flow:
# editor -> server -> a real MCP client (test/browser/send-to-agent.test.mjs)
npm run test:browser   # loads the real extension in Chromium (set CHROMIUM_PATH if needed)
npm test               # everything
```

GitHub Actions runs both on every push.

---

## FAQ

**Do I need more than one server?** No. One process on port `5959` handles sketches, logs, repos and the MCP connection.

**Does it work with agents running in a VM?** Yes. Share a folder with the VM and set the agent path, or enable remote access as described above.

**Which sites are captured?** `localhost` and `127.0.0.1` by default. You choose any others.

---

## License

MIT. Designed and built by [Kashyap](https://github.com/kashyapgithub).



> **Colours:** the Design panel has preset swatches, recent colours and an eyedropper under both Fill and Stroke. The pencil also leaves a dot on a plain click, and stroke width goes up to 24.
