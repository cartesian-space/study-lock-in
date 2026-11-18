# CLAUDE.md — Agent Orientation & Developer Guide

Welcome, agent! This document provides all the context, architecture patterns, and conventions needed to work on **Study Lock-In**. Read this before making changes to the codebase.

---

## 📌 Project Overview

**Study Lock-In** is an interactive, syllabus-driven study tracker designed to be hosted statically on **GitHub Pages (`https://<username>.github.io/study-lock-in/`)**.

* **Zero Backend at Runtime**: The app runs 100% client-side in the browser. There is no Python/Node server running in production.
* **Single Source of Truth**: Curricula and baselines live as native YAML files in `_data/syllabi/*.yml`.
* **Offline-First & Local Persistence**: All progress (checkboxes, timestamps, journal entries, comments, custom links) saves immediately to browser `localStorage`.
* **Lock screen**: Google sign-in limited to one account (or a passcode fallback) keeps casual visitors out when hosted publicly. It is a client-side gate, not encryption.
* **Cross-Machine Git Sync**: Users export their updated progress as YAML, commit it to `_data/syllabi/`, and push to GitHub Pages to sync across devices.

---

## 🏗️ Architecture & Tech Stack

```
Jekyll Data (_data/syllabi/*.yml, _data/activity.yml)
                     │
                     ▼ (Jekyll Build / Liquid)
index.html <script id="syllabi-data" type="application/json">
           <script id="activity-data" type="application/json">
           <script id="site-config" type="application/json">
           <script id="legacy-ids" type="application/json">
                     │
                     ▼ (Loaded by app.js on boot)
      In-Memory State  ◄──►  Browser localStorage
                     │
                     ▼ (On Export)
         Exported .yml  ───►  Drop in _data/syllabi/ & git push
```

### Key Files & Directories

| Path | Purpose |
| :--- | :--- |
| `_config.yml` | Jekyll settings (`baseurl`, `google_client_id`, `allowed_email_sha256`, `passcode_hash`). |
| `scripts/set-passcode.sh` | Sets the passcode fallback's hash in `_config.yml` without the passcode touching disk/history. |
| `_data/syllabi/*.yml` | Base curricula (`math-for-ml.yml`, `ai-engineering.yml`, etc.) — `sections:` schema, see below. |
| `_data/legacy_ids.yml` | One-time map of old positional ids (`day-4`, `day-4-blk-2-task-1`) → section ids, used to migrate unexported `localStorage` progress. Deletable once every device has loaded the app. |
| `_data/activity.yml` | Historical completion log powering the GitHub-style contribution heatmap. |
| `_layouts/default.html` | Base HTML wrapper; loads Google Fonts, `style.css`, and `app.js` using `relative_url`. |
| `index.html` | App mount root; embeds JSON scripts via Liquid and contains the `#lockScreen` modal. |
| `app.js` | Core application logic (state manager, event dispatcher, YAML exporter, lock logic, audio). |
| `style.css` | Anthropic-inspired warm design system (dark/light themes, typography, animations, responsive). |
| `zen-music.mp3` | Lo-fi focus audio track with fading controller. |
| `Gemfile` | Ruby dependencies for local Jekyll serving (`jekyll`, `jekyll-feed`, `webrick`). |
| `scripts/convert_toml_to_yaml.py` | Utility to convert legacy TOML syllabi into Jekyll YAML format. |
| `sync-to-github.sh` | Bash helper to commit and push progress updates to GitHub. |
| `.github/workflows/deploy.yml` | GitHub Actions workflow to build and deploy to GitHub Pages. |

---

## 🛠️ Development & Common Workflows

### 1. Running Locally with Bundler (Jekyll)
```bash
bundle install
bundle exec jekyll serve

# With live reload:
bundle exec jekyll serve --livereload
```
Site will be served at: `http://localhost:4000/study-lock-in/`

### 2. Converting a New TOML Syllabus
```bash
python3 scripts/convert_toml_to_yaml.py path/to/syllabus.toml
```
The script writes the output directly into `_data/syllabi/<name>.yml`.

### 3. Syncing Progress to GitHub Pages
Export syllabus progress (**Export for Git**) into `_data/syllabi/` and the activity log (**Export Activity**) over `_data/activity.yml`, then:
```bash
./sync-to-github.sh
```

---

## 🔐 Lock Screen & Security

* **Google sign-in (preferred)**: when `_config.yml` has `google_client_id`, the lock screen shows *Sign in with Google* (Google Identity Services, script loaded only on the lock screen). `verifyGoogleCredential()` checks the ID token's RS256 signature against Google's published keys plus issuer, audience (= client id), expiry, `email_verified`, and that SHA-256 of the lower-cased email equals `allowed_email_sha256` (the address itself is never stored in the repo).
* **Passcode fallback**: used only while `google_client_id` is empty. `passcode_hash` is the SHA-256 of the passcode — set it with `scripts/set-passcode.sh` (hidden input, never written to disk). There is **no** built-in default passcode; never re-add a plaintext fallback like `entered === 'lockin'`.
* **Throttling**: 5 wrong passcodes → 30 s cooldown, doubling per further miss (max 5 min), persisted in `study-lock-in:lock-failures`; a correct passcode resets it.
* **Storage**: unlocking sets `study-lock-in:unlocked = 'true'`; `lockApp()` clears it, disables Google auto-select and shows the lock screen again. A custom passcode can be set per device from the Data panel (`study-lock-in:custom-passcode-hash`, needs the current passcode, typed twice).
* **Important**: this is a client-side gate for keeping casual visitors out of a public GitHub Pages site. All syllabus/activity data ships inside the page source, so anyone who reads the source can see it. For real protection, put the site behind an access proxy (e.g. Cloudflare Access) — no app changes needed.

## 💾 LocalStorage & State Schema

All browser storage keys are prefixed to avoid collisions:

| Key | Format | Description |
| :--- | :--- | :--- |
| `study-lock-in:unlocked` | `"true"` or unset | Indicates whether workspace is unlocked. |
| `study-lock-in:active-syllabus` | string (e.g. `"math-for-ml"`) | Currently selected syllabus key. |
| `study-lock-in:state:<syllabusKey>` | JSON string | Local state overrides (checked tasks, timestamps, journal, time logs, comments). |
| `study-lock-in:activity` | JSON array `[{ t, syllabus, topic, action, manual? }]` | Local completion log entries added on the current device (task ticks, plus ad-hoc entries from **+ Log** with `manual: true`). |
| `study-lock-in:last-activity-category` | string | Last category used in the **+ Log** form. |
| `study-lock-in:trophies` | JSON array `["Task name", ...]` | Titles of completed tasks for the gravity trophy pile. |
| `study-lock-in:custom-passcode-hash` | hex string | Custom SHA-256 passcode hash if changed by user. |
| `study-lock-in:lock-failures` | JSON `{ count, until }` | Wrong-passcode counter and cooldown end time. |
| `study-tracker-ui:<syllabusKey>` | JSON string | Pure UI preferences (`activeDay`, `journalDay`, `theme`). |
| `study-lock-in:view` | `"study"` \| `"overview"` | Last view (also reflected in the URL hash `#study` / `#overview`). |

## 📄 Syllabus YAML Schema (`_data/syllabi/<key>.yml`)

The file name (without `.yml`) is the syllabus **key**. `stateToYaml()` emits exactly this shape, and
`syllabusToState()` reads it (it also still accepts the legacy `days: → blocks: → tasks:` schema, e.g. from
`scripts/convert_toml_to_yaml.py`). An unchanged syllabus must re-export byte-for-byte identical.

```yaml
meta:
  title: "Math for ML/DL/Neural Networks"
  subtitle: "..."
  status: "active"        # active | paused | queued | done   (default active; drives the map)
  short: "Math"           # optional short name for map chips
  color: "#5B7046"        # optional lane colour (else hashed from key)
state:
  theme: "dark"
  active_section: "vectors"
  journal_section: "vectors"
  start_date: "2026-11-05T09:10:10.387Z"
sections:
  - id: "backpropagation"          # stable slug; never "day-N"
    title: "Backpropagation"       # short — it is the map node + nav pill label
    subtitle: "..."                # optional
    requires:                      # optional cross-syllabus prerequisites
      - "ai-systems-and-finance/transformers"   # "<key>/<section-id>", or "<section-id>" for same syllabus
    journal: |-                    # optional
      notes...
    tasks:
      - text: "..."
        done: true
        bonus: true                # optional; bonus tasks never block section completion
        done_at: "2026-11-05T09:10:10Z"
        practice: true             # optional; true = in Practice, false = practised/resolved, absent = never flagged
        practice_at: "2026-11-17T09:00:00.000Z"   # when it was last flagged / resolved (sorting)
        comments: ["..."]
        resources: [{ label: "...", url: "..." }]
        custom_resources: [{ label: "...", url: "..." }]
```

### ✍️ Authoring tasks & worksheets (required for every new or rewritten syllabus)

The task view formats task text with `formatTaskText()` (display only), so write tasks in this exact shape:

* **Prefix the task type**: `Watch: …`, `Read: …`, `Worksheet — <title>. By hand, on paper: …`, `Code (NumPy, 10 min): …`, `Reflect (journal): …`.
* **Number questions as `(N)` with a space before and after**: `… on paper: (1) Compute AB. (2) Is AB = BA? (3) …` — each `(N)` renders on its own line. Use `(N)` only for question numbers; notation like `f′(3)` or `(1,1)` is fine because it isn't preceded by a space.
* **Answers go at the end after `✔ Check:`**, numbered the same way and separated by `; ` — `✔ Check: (1) [[19, 22], [43, 50]]; (2) no — not commutative`. This renders as a separate answer block, one answer per line.
* **Write matrices as nested lists** `[[a, b], [c, d]]` (rows of equal length, short entries): inside `Worksheet` tasks `renderMatrices()` draws them as real row × column grids with book-style brackets (display only). Block/ragged notation like `[[W, b], [0, 0, 1]]` is left as text. Vectors `[a, b]` stay inline.
* **Compute answers, don't type them**: generate worksheet numbers/answers with a script (NumPy) and audit any hand-written answer before committing.
* Put links in `resources:`, never inline in the text; mark optional depth as `bonus: true`.

`practice` is parsed leniently by `_parsePracticeFlag()` (true/false, "yes"/"no", "resolved", …; unknown values are ignored), so older or hand-edited files always load. Files without practice fields re-export byte-identical.

Internally each section is still a `state.days[]` entry with a single implicit block, and task ids are
`<section-id>-t<N>` (position within the section). Reordering tasks inside a section only matters for
progress that has not been exported yet.

### State Data Structure in Memory (`state`)
```javascript
{
  meta: { title: "...", subtitle: "...", status: "active", short: "...", color: "#..." },
  theme: "dark",
  activeDay: "vectors",     // section id
  journalDay: "vectors",
  startDate: "2026-11-05T09:10:10.387Z",
  days: [
    {
      id: "vectors",            // a section
      title: "Vectors",
      subtitle: "...",
      label: "Vectors",         // mirrors title
      requires: ["other-syllabus/section-id"],
      blocks: [                 // exactly one implicit block for the sections schema
        {
          id: "vectors-blk",
          title: "",
          tasks: [
            { id: "vectors-t1", text: "...", bonus: false, resources: [{ label: "...", url: "..." }] }
          ]
        }
      ]
    }
  ],
  checked: { "vectors-t1": true },
  doneAt: { "vectors-t1": "2026-11-05T09:10:10Z" },
  journal: { "vectors": "Notes..." },
  timeLog: { "vectors": 1800 },
  comments: { "vectors-t1": ["comment text"] },
  customResources: { "vectors-t1": [{ label: "Link", url: "https://..." }] },
  practice: { "vectors-t1": { open: true, at: "2026-11-17T09:00:00.000Z" } }
}
```

---

## 🧭 Page Structure: three views

The page has three views, switched by the header's **Study | Overview | Practice** control (`setView()` / `applyView()`; URL hash `#study` / `#overview` / `#practice`, remembered in `study-lock-in:view`; browser back/forward works). `body[data-view]` drives visibility via CSS:

* **Study** (default) — `.study-layout`: section list (`#dayNav`, a sticky left sidebar on PC ≥1000px, a scrolling pill row on smaller screens) + `.study-main` (the open section's tasks + "Notes for this section"). The journal always follows the open section (`switchDay()` sets `journalDay = activeDay`).
* **Overview** — `.overview-head`, `#statsGrid`, `#activityHeatmap` (with **+ Log**), and `#hourHeatmap` (**Study hours**: last 30 days × 24 local hours, `renderHourHeatmap()`, re-rendered from `renderHeatmap()`; counts `done` entries per hour, `undone` cancels one. Drawn as a filled-contour weather map on a canvas by `_drawHourField()`: Gaussian-smoothed field → bilinear interpolation → 9 flat levels `--hh0…--hh8` (the yearly heatmap palette) with thin contour lines, no blur; redrawn on Overview show, resize and theme change. An invisible 30×24 grid on top keeps the tooltips). (The syllabi map was removed; the Study sidebar replaced it.)
* **Practice** — `#practiceView` (`renderPractice()`): every task flagged `practice` in **any** syllabus (`collectPractice()`), grouped by syllabus (most recently touched group first), newest items first; open items then a "Resolved" list. Each item: **Done** (resolve → `practice: false`), **Practice again** (back to open), **Comment**, **Open** (jumps to the section in Study). Tasks are flagged from the Study toolbar's **↻ Practice again** button (`togglePractice()`), which only appears once a task is marked done (it stays visible while the task is flagged, so it can be unflagged). The view-switch badge (`#practiceCount`) shows open items.
* **Header**: title, view switch, Overall %, and one **⋯ menu** (`#appMenu`) holding the **syllabus picker** (`_renderMenuSyllabi()`, all screen sizes — there is no header dropdown), theme, music, zen, Export/Import, reset and lock.
* **Task cards**: type tag, text, links (each link chip shows the site's favicon via `linkIcon()` → `icons.duckduckgo.com/ip3/<domain>.ico`, only the domain is sent, no referrer; falls back to a generic link icon); toolbar shows **✓ Mark done** and **💬 Comment**; Copy / Edit / Add link / Delete live in a per-task ⋯ (`toggleTaskMenu()`). Worksheet answers are a closed `<details class="task-answers">` ("Show answers"). Completed tasks stay in their original position, fully visible, with a quieter done style.

## ⚠️ Critical Rules for Future Agents

1. **Never Re-introduce a Server Dependency**:
   All operations (`task`, `journal`, `time`, `comment_add`, `res_add`, `practice_set`, etc.) must route through `postEvent(event)` and save directly into `localStorage`. Do not add `fetch('/api/...')` endpoints. To change a syllabus that isn't the active one (e.g. from Practice), pass `syllabus: '<key>'` in the event — `postEvent` applies it to that syllabus's state and saves it under its own key; it reaches YAML when that syllabus is exported.

2. **Preserve Jekyll GitHub Pages Path Compatibility**:
   GitHub Pages serves project sites under a subpath (e.g. `/study-lock-in/`).
   * In Liquid templates, always use `{{ '/path' | relative_url }}`.
   * In JS audio/asset paths, always prefix with `(siteConfig.baseurl || '')`.

3. **YAML Schema Compatibility**:
   When updating `stateToYaml(state)` / `syllabusToState(raw)`, keep the export → commit → re-export loop byte-identical for unchanged data, and keep accepting the legacy `days:` schema. Multiline journal text uses `|-` block scalars (falling back to a quoted string when a block scalar would not round-trip). Do not put timestamps or other volatile data in the export.

4. **Activity Heatmap Invariants**:
   * Always combine base historical activity from `getEmbeddedActivity()` with device activity from `getLocalActivity()` via `getActivityLog()`, which de-duplicates entries (by `t|syllabus|topic|action`) that exist in both after an `activity.yml` export is committed.
   * `exportActivity()` writes the merged log as `activity.yml`; keep `t` quoted so Jekyll treats timestamps as strings, not `Time` objects.
   * Ad-hoc study outside any syllabus (talks, articles, videos) is logged from the heatmap's **+ Log** form via `postEvent({op:'activity_add'})` / `activity_rm`. `syllabus` is a free-text category (default "Daily Study Log"). An optional time (`#logTime`, local) is used as-is so the entry lands in the right Study-hours hour; without one, today means now and past dates use local noon so they land on the right cell. Future times are rejected. These entries never touch a syllabus file — they only reach Git through **Export Activity**.
   * Date parsing must use local date strings (`toDateStr`) to avoid UTC day-shift bugs.
   * `renderHeatmap()` shows a rolling 12-month window (the 11 previous months + the current month, rendered last). If there is no activity in that window (e.g. device clock far from the data), it anchors the window on the latest activity date instead; preserve this so the grid never renders empty.

5. **Syllabus model** (`buildSyllabiMap()` — name kept for history):
   * Read-only over `getEmbeddedSyllabi()` + each syllabus's localStorage overrides via `getSyllabusState(key)` (the active syllabus uses live `state`). Never add a separate data store.
   * A section is **done** when all non-bonus tasks are checked (`sectionProgress()`); a `requires` prerequisite counts as satisfied if done, if its syllabus has `status: done`, or if it no longer exists. It powers the section "Requires" chips (`mapGo()` jumps there) and Overview widgets.

6. **Aesthetic & UX Fidelity**:
   Calm, uncluttered study surface: neutral warm-grey base with the olive accent reserved for "current" and "done", white cards with 1px borders, typography `Inter` + `JetBrains Mono`. Keep the Study view focused on the open section — new dashboards/widgets belong in Overview, new rarely-used actions in a ⋯ menu. Keep the particle burst, trophy pile and Zen focus audio working.
