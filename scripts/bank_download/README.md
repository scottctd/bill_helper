# Bank Download Automation

> **Status: WIP (work in progress)**  
> Experimental headed-Chrome automation for downloading bank transaction exports. Not integrated with the Bill Helper agent or import pipeline yet.

## Purpose

This package supports a manual-login, automated-export workflow:

1. You sign in to your bank in a normal Chrome window.
2. A JSON **recipe** drives the post-login clicks (filters, export menu, download).
3. Downloaded files land in a known output directory for later parsing or agent ingestion.

Current target: **Scotiabank chequing → Excel export**. CSV is not offered on the recorded export menu.

## Why CDP attach (not Playwright launch)

Two separate problems led to the current design:

| Problem | Symptom | Mitigation |
|---------|---------|------------|
| Playwright-launched Chrome | Bank login blocked (“couldn't complete your request”) | Do **not** use `playwright codegen` or `launch_persistent_context` for login |
| Remote debugging on main Chrome profile | `ECONNREFUSED` on port 9222; Chrome prints “DevTools remote debugging requires a non-default data directory” | Use a **dedicated** user-data dir under `~/.local/share/bill_helper/chrome-bank-debug` |

**Recommended flow:** launch Chrome yourself with remote debugging → log in manually → attach Playwright over CDP for recording or recipe execution.

## Layout

```
scripts/
  download_bank_statements.py   # Run a recipe (launch or CDP attach)
  record_bank_flow.py           # Attach Inspector to record clicks
  bank_download/
    README.md                   # This file
    browser.py                  # Chrome launch / CDP connect helpers
    locators.py                 # Selector string → Playwright locator
    models.py                   # Recipe JSON schema + loader
    runner.py                     # Login wait + step execution
    recipes/
      template.json
      scotiabank.example.json
      scotiabank-chequing-excel.json
      scotiabank-chequing-excel-custom-range.json
```

Download artifacts (gitignored):

- `output/bank_downloads/` — explicit saves from the recipe runner
- `~/.local/share/bill_helper/bank_downloads/` — default timestamped output when `--output-dir` is omitted
- `~/Downloads` — where Inspector **recording** may drop files (not managed by this tool)

## Prerequisites

```bash
uv sync --group dev
uv run playwright install chrome
```

Playwright is a **dev dependency** only (`pyproject.toml` → `[dependency-groups].dev`).

## Quick start (Scotiabank)

### 1. Launch Chrome with CDP

Quit regular Chrome (Cmd+Q), then in **terminal A**:

```bash
mkdir -p ~/.local/share/bill_helper/chrome-bank-debug

"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --remote-debugging-port=9222 \
  --remote-debugging-address=127.0.0.1 \
  --user-data-dir="$HOME/.local/share/bill_helper/chrome-bank-debug" \
  --profile-directory="Default"
```

Sanity check (optional):

```bash
curl http://127.0.0.1:9222/json/version
```

JSON output means CDP is listening.

Print the same launch command anytime:

```bash
uv run python scripts/record_bank_flow.py --show-launch-command
```

### 2. Log in manually

In that Chrome window, sign in to Scotiabank and leave the browser on the accounts area.  
Sessions persist in `~/.local/share/bill_helper/chrome-bank-debug` across runs.

### 3. Run a recipe

In **terminal B**, from the repo root:

```bash
uv run python scripts/download_bank_statements.py \
  --recipe scripts/bank_download/recipes/scotiabank-chequing-excel.json \
  --cdp-url http://127.0.0.1:9222 \
  --output-dir output/bank_downloads/scotiabank
```

On success, the terminal prints `Saved download to ...` for each file.  
The CDP attach path skips login wait and does **not** close your Chrome window when the script exits.

## Recording a new flow

Use this when adding a bank or updating selectors after a UI change.

### 1. Start CDP Chrome and log in

Same as [Quick start §1–2](#1-launch-chrome-with-cdp).

### 2. Attach Playwright Inspector

```bash
uv run python scripts/record_bank_flow.py
```

Press Enter when logged in. Inspector opens on the current tab.

### 3. Record clicks

1. Click **Record** in Inspector (if not already active).
2. In **Chrome**, perform the export flow once.
3. **Copy the generated Python before closing Chrome or Inspector.**

Optional backup:

```bash
pbpaste > output/bank_downloads/recorded_flow.py
```

### 4. Convert recording → recipe

Paste the Python into a recipe under `recipes/`. Supported step actions:

| Action | Fields | Notes |
|--------|--------|-------|
| `goto` | `url` | Navigate |
| `click` | `selector` | See [Selector formats](#selector-formats) |
| `select_option` | `selector`, `value` | `<select>` elements |
| `fill` | `selector`, `value` | Text inputs |
| `wait_for_selector` | `selector` | Wait until visible |
| `wait_for_download` | `selector` (optional) | Clicks trigger + saves file to `--output-dir` |
| `pause` | — | Waits for Enter in terminal (use for fragile date pickers) |

Recipe top-level shape:

```json
{
  "name": "my-bank",
  "start_url": "https://…",
  "login": {
    "url_patterns": ["secure\\.example\\.com"],
    "exclude_url_patterns": ["login", "signin"],
    "selectors": ["[data-testid='dashboard']"],
    "timeout_seconds": 900,
    "message": "Sign in manually, then …"
  },
  "steps": [ … ]
}
```

Login detection succeeds when **any** `url_patterns` match (and no `exclude_url_patterns` match) **or** any `selectors` element is visible.

## Selector formats

Recipes accept three selector styles (see `locators.py`):

| Format | Example | Maps to |
|--------|---------|---------|
| CSS / attribute | `#transaction-filter__search-filter` | `page.locator(...)` |
| Text | `text=Download` | `page.get_by_text(...)` |
| Role | `role:button:Download as Excel` | `page.get_by_role("button", name="Download as Excel")` |

Playwright codegen output like `page.get_by_role("link", name="Preferred Package ending in")` becomes:

```json
{ "action": "click", "selector": "role:link:Preferred Package ending in" }
```

Avoid hardcoding account URLs or calendar labels like `"Friday, May First, 2026 row"` — they break quickly. Prefer `pause` for manual date selection (see custom-range recipe).

## Bundled recipes

| File | Description |
|------|-------------|
| `recipes/template.json` | Placeholder starter |
| `recipes/scotiabank.example.json` | Early stub; prefer the recipes below |
| `recipes/scotiabank-chequing-excel.json` | Preferred Package chequing → all transactions → Excel |
| `recipes/scotiabank-chequing-excel-custom-range.json` | Same account, custom date filter with a `pause` for manual dates |

**Scotiabank customization:** edit the account link selector (`role:link:Preferred Package ending in`) if your account label differs.

## CLI reference

### `download_bank_statements.py`

```bash
uv run python scripts/download_bank_statements.py --help
```

| Flag | Default | Purpose |
|------|---------|---------|
| `--recipe` | `scripts/bank_download/recipes/template.json` | Recipe JSON path |
| `--output-dir` | `~/.local/share/bill_helper/bank_downloads/<name>-<timestamp>/` | Where `wait_for_download` saves files |
| `--cdp-url` | _(none)_ | Attach to running Chrome, e.g. `http://127.0.0.1:9222` |
| `--skip-login-wait` | false | Run steps immediately (auto-enabled with `--cdp-url`) |
| `--chrome-user-data-dir` | macOS main Chrome path | Only for direct Playwright launch mode |
| `--chrome-profile-directory` | `Default` | Profile name for launch mode |
| `--headless` | false | Not recommended for bank login |

**Launch mode** (without `--cdp-url`): Playwright opens Chrome directly. Many banks block this at login — prefer CDP attach.

### `record_bank_flow.py`

```bash
uv run python scripts/record_bank_flow.py --help
```

| Flag | Default | Purpose |
|------|---------|---------|
| `--cdp-url` | `http://127.0.0.1:9222` | CDP endpoint to attach |
| `--show-launch-command` | false | Print Chrome launch command and exit |
| `--chrome-user-data-dir` | `~/.local/share/bill_helper/chrome-bank-debug` | Used in printed launch command |
| `--debugging-port` | `9222` | Port in printed launch command |

## Troubleshooting

### `ECONNREFUSED 127.0.0.1:9222`

Chrome is not exposing CDP. Common causes:

- Chrome was not started with `--remote-debugging-port=9222`
- Main everyday Chrome profile was used (`~/Library/Application Support/Google/Chrome`) — recent Chrome blocks CDP there
- Regular Chrome was still running and swallowed the launch

Fix: quit all Chrome, use the dedicated `--user-data-dir` from `--show-launch-command`, verify with `curl http://127.0.0.1:9222/json/version`.

### Bank blocks login in Playwright/codegen window

Expected for Scotiabank. Use CDP Chrome for login; never `playwright codegen` against the main profile for sign-in.

### Inspector showed downloads but files are missing

Recording via `page.pause()` does **not** call `download.save_as()`. Files may land in `~/Downloads` or not complete. Use `download_bank_statements.py` with `--output-dir` for reliable saves.

### Recipe step fails on selector

UI changed or account label differs. Re-run `record_bank_flow.py`, update the recipe JSON, or add a `pause` step for manual intervention.

## WIP / not yet implemented

- [ ] Agent or CLI hook to parse downloaded Excel/CSV into Bill Helper entries
- [ ] Recipe generator from Inspector Python (manual conversion today)
- [ ] Relative date-range steps (avoid hardcoded calendar labels)
- [ ] Non-macOS Chrome paths and launch helpers
- [ ] Scheduled / recurring download runner
- [ ] Integration tests (requires private credentials; likely stay manual)

## Related docs

- `docs/development.md` — short pointer and setup commands
- `docs/repository_structure.md` — file map entry for these scripts

## Security notes

- Recipes may embed bank-specific URLs; treat recipe edits like credentials-adjacent config.
- The debug Chrome profile (`chrome-bank-debug`) holds real bank session cookies — keep it on your local machine only (already under `~/.local/share/bill_helper/`).
- Do not commit downloaded exports or recorded flows containing account identifiers.
