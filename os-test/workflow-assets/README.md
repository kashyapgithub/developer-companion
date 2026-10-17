# Cross-OS Test — Workflow Assets

These files belong in the **repository you want to test**, not in Developer
Companion itself. They are the exact assets this extension dispatches and
polls:

| File | Where it goes in the target repo |
| :--- | :--- |
| `screenshot-test.yml` | `.github/workflows/screenshot-test.yml` |
| `scripts/capture.js` | `scripts/capture.js` (Playwright capture runner) |
| `scripts/serve.js` | `scripts/serve.js` (zero-dependency static server, used in GitHub Repo mode) |
| `package.json` | `package.json` (pins Playwright locally; runners run `npm ci` + `npx playwright install`) |

Source: [kashyapgithub/website-cross-operating-system-testing](https://github.com/kashyapgithub/website-cross-operating-system-testing).

## One-time setup in the target repo

1. Commit the files above to `main` (workflow under `.github/workflows/`).
2. Create an empty `results` branch — it stores the screenshots:

   ```bash
   git checkout --orphan results
   git rm -rf .
   git commit --allow-empty -m "Initial empty results branch"
   git push origin results
   git checkout main
   ```

3. In the extension: canvas toolbar → **Cross-OS Test** → ⚙ setup → save
   your GitHub token (or reuse the Dashboard token), the repo owner, and
   this repo's name.
4. Open any site, click **Run test** — Windows, macOS, and Linux runners
   capture screenshots and stream them into the studio window as each one
   finishes.

Notes:
- Public repos get **unlimited free** Actions minutes; private repos get
  2,000 free minutes/month (macOS runs consume 10× that quota).
- The workflow requires an empty `results` branch to exist, or the
  "Checkout results branch" step fails.
