# Blueprint: Transcripta (Desktop)

> App desktop (.exe) para transcrição de reuniões com IA local — faster-whisper (GPU) + Claude API para resumos e action items.

**Generated:** 2026-03-11
**Reviewed:** 2026-03-11 (adversarial review applied)
**Steps:** 8 (6 serial + 1 parallel group)
**Estimated PRs:** 8
**GitHub:** joaodutra88 | gh CLI authenticated

---

## Dependency Graph

```
Step 1 (Electron + Vite + React scaffold)
  └── Step 2 (SQLite + Prisma local DB)
        ├── Step 3a (Transcription engine — Python bridge)  ──┐  PARALLEL
        ├── Step 3b (React UI — meetings, player, viewer)   ──┘  PARALLEL
        └─────────────────────────────────────────────────────┘
              │
        Step 3.5 ★ INTEGRATION GATE
              │
        Step 4 (Claude API — summarization + action items)
              │
        Step 5 (Packaging — electron-builder → .exe + installer)
              │
        Step 6 (CI/CD — GitHub Actions + auto-updater)
              │
        Step 7 (E2E + Smoke tests)
```

### File Ownership (parallel steps)

| File/Dir                    | Step 3a owns | Step 3b owns | Read-only |
| --------------------------- | :----------: | :----------: | :-------: |
| `src/main/transcription/**` |      ✅      |              |           |
| `src/main/python/**`        |      ✅      |              |           |
| `src/renderer/**`           |              |      ✅      |           |
| `src/shared/**`             |              |              |    ✅     |
| `prisma/**`                 |              |              |    ✅     |
| `package.json`              |              |              |    ✅     |

**Merge strategy:** 3a merges first → 3b rebases → Integration gate (3.5)

---

## Step 1 — Electron + Vite + React Scaffold

**Branch:** `feat/electron-scaffold`
**Model tier:** default
**Depends on:** nothing
**Rollback:** `rm -rf transcripta`

### Context Brief

Create an Electron app with Vite + React 19 for the renderer process and Node.js for the main process. Use electron-vite or electron-forge with Vite plugin. Structure follows SOLID: main process handles system operations (file I/O, Python bridge, DB), renderer handles UI only. IPC bridge connects them cleanly.

### Task List

- [ ] `npm create electron-vite@latest transcripta` (or manual setup)
- [ ] Project structure:
  ```
  transcripta/
  ├── src/
  │   ├── main/                    # Electron main process (Node.js)
  │   │   ├── index.ts             # App entry, window creation
  │   │   ├── ipc/                 # IPC handlers (bridge to renderer)
  │   │   │   └── handlers.ts
  │   │   ├── services/            # Business logic (SOLID ports)
  │   │   │   ├── ports/           # Interfaces
  │   │   │   └── adapters/        # Implementations
  │   │   └── config/
  │   │       └── env.ts           # App paths, config
  │   │
  │   ├── renderer/                # React app (Vite)
  │   │   ├── src/
  │   │   │   ├── App.tsx
  │   │   │   ├── components/
  │   │   │   │   ├── ui/          # Dumb components (SRP)
  │   │   │   │   ├── layouts/
  │   │   │   │   └── forms/
  │   │   │   ├── features/        # Feature modules (OCP)
  │   │   │   ├── hooks/
  │   │   │   ├── services/        # IPC client wrappers
  │   │   │   └── types/
  │   │   └── index.html
  │   │
  │   ├── shared/                  # Shared types + validators (both processes)
  │   │   ├── types/
  │   │   │   ├── meeting.ts
  │   │   │   ├── transcript.ts
  │   │   │   └── api.ts
  │   │   ├── validators/          # Zod schemas
  │   │   └── utils/
  │   │
  │   └── preload/                 # Electron preload (contextBridge)
  │       └── index.ts             # Exposes IPC API to renderer
  │
  ├── python/                      # Python scripts (bundled with app)
  │   ├── transcribe.py            # faster-whisper transcription
  │   └── requirements.txt
  │
  ├── prisma/
  │   └── schema.prisma            # SQLite schema
  │
  ├── resources/                   # App icons, assets
  ├── tests/
  ├── .github/workflows/
  ├── electron-builder.yml         # Build config
  ├── electron.vite.config.ts
  ├── tsconfig.json
  ├── .env.example
  ├── .gitignore
  └── package.json
  ```
- [ ] IPC bridge pattern (SOLID DIP — renderer never calls Node.js directly):
  ```typescript
  // preload/index.ts — exposes typed API
  contextBridge.exposeInMainWorld('api', {
    meetings: {
      list: () => ipcRenderer.invoke('meetings:list'),
      create: (data) => ipcRenderer.invoke('meetings:create', data),
      get: (id) => ipcRenderer.invoke('meetings:get', id),
    },
    transcription: {
      start: (meetingId) => ipcRenderer.invoke('transcription:start', meetingId),
      status: (meetingId) => ipcRenderer.invoke('transcription:status', meetingId),
    },
    files: {
      selectAudio: () => ipcRenderer.invoke('files:select-audio'),
    },
  })
  ```
- [ ] ESLint flat config + Prettier + Husky + lint-staged
- [ ] `.gitignore` — node_modules, dist, out, .env, \*.db, **pycache**
- [ ] `.env.example`:
  ```
  ANTHROPIC_API_KEY=sk-ant-...
  PYTHON_PATH=python           # or path to venv
  WHISPER_MODEL=large-v3
  WHISPER_DEVICE=cuda
  WHISPER_COMPUTE=float16
  ```
- [ ] Structured logging with **electron-log** (file + console)

### Verification

```bash
npm install                # zero errors
npm run dev                # Electron window opens with blank React app
npm run lint               # zero warnings
npm run typecheck          # zero TS errors
```

### Exit Criteria

- Electron window opens with React dev server (HMR working)
- IPC bridge works (renderer calls `window.api.meetings.list()`, main responds)
- Preload script correctly exposes typed API
- Hot reload works in renderer (Vite HMR)
- Main process restarts on changes (electron-vite watch)

### Skills to invoke

- `/coding-standards` — ESLint + TypeScript patterns
- `/search-first` — check latest electron-vite, electron-forge versions
- `/frontend-patterns` — React component architecture

---

## Step 2 — SQLite + Prisma (Local Database)

**Branch:** `feat/local-database`
**Model tier:** default
**Depends on:** Step 1
**Rollback:** `git revert` (delete .db file)

### Context Brief

Set up SQLite via Prisma for local data persistence. The database file lives in the app's userData directory (`%APPDATA%/transcripta/`). No server, no connection string — just a file. Prisma migrations run on app startup.

### Task List

- [ ] Install `prisma` + `@prisma/client`
- [ ] `prisma/schema.prisma`:

  ```prisma
  datasource db {
    provider = "sqlite"
    url      = env("DATABASE_URL")  // file:./transcripta.db
  }

  model Meeting {
    id          String      @id @default(cuid())
    title       String
    audioPath   String      // local file path
    duration    Int?        // seconds
    status      String      @default("PENDING")
    // PENDING | TRANSCRIBING | SUMMARIZING | COMPLETED | FAILED
    errorMessage String?
    createdAt   DateTime    @default(now())
    updatedAt   DateTime    @updatedAt
    transcript  Transcript?
    summary     Summary?
  }

  model Transcript {
    id          String   @id @default(cuid())
    meetingId   String   @unique
    meeting     Meeting  @relation(fields: [meetingId], references: [id])
    content     String   // full text
    segments    String   // JSON: [{speaker, start, end, text}]
    createdAt   DateTime @default(now())
  }

  model Summary {
    id          String       @id @default(cuid())
    meetingId   String       @unique
    meeting     Meeting      @relation(fields: [meetingId], references: [id])
    content     String       // markdown summary
    actionItems ActionItem[]
    createdAt   DateTime     @default(now())
  }

  model ActionItem {
    id          String  @id @default(cuid())
    summaryId   String
    summary     Summary @relation(fields: [summaryId], references: [id])
    text        String
    assignee    String?
    completed   Boolean @default(false)
  }
  ```

- [ ] `src/main/services/ports/meeting.repository.ts` — interface
- [ ] `src/main/services/adapters/prisma-meeting.repository.ts` — implements port
- [ ] `src/main/services/adapters/prisma-client.ts` — singleton, sets DB path to userData
- [ ] Run migrations on app startup (`prisma migrate deploy`)
- [ ] Seed script with sample data for dev
- [ ] IPC handlers for meetings CRUD
- [ ] Unit tests for repository (in-memory SQLite for tests)

### Verification

```bash
npx prisma migrate dev     # migration runs
npm run test               # repository tests pass
npm run dev                # meetings CRUD works via IPC
```

### Exit Criteria

- DB file created at `%APPDATA%/transcripta/transcripta.db`
- CRUD operations work through IPC (create meeting, list, get by ID)
- Migrations run automatically on app startup
- 80%+ coverage on repository layer

### Skills to invoke

- `/tdd` — write repository tests before implementation
- `/postgres-patterns` — schema design principles (applies to SQLite too)

---

## Step 3a — Transcription Engine (Python Bridge) ⚡ PARALLEL with 3b

**Branch:** `feat/transcription-engine`
**Model tier:** strongest (core business logic)
**Depends on:** Step 2
**Rollback:** `git revert`
**File ownership:** `src/main/transcription/**`, `src/main/services/adapters/whisper-*`, `python/**`

### Context Brief

Bridge Electron (Node.js) to the user's local faster-whisper installation via Python child process. The user already has faster-whisper + whisperx + pyannote installed with GPU (CUDA). This step spawns Python, streams progress back to the renderer, and stores the transcript in SQLite.

### Meeting Status State Machine

```
PENDING → TRANSCRIBING → COMPLETED (or → SUMMARIZING in Step 4)
    │           │
    └───────────┴──→ FAILED (with errorMessage)
```

### Task List

- [ ] `python/transcribe.py` — standalone script (based on user's existing `transcribe_diarize.py`):

  ```python
  # Input: audio_path, output_path, model_size, device, compute_type
  # Output: JSON to stdout with progress updates
  # Format: {"type": "progress", "percent": 45, "step": "transcribing"}
  #         {"type": "segment", "speaker": "SPEAKER_00", "start": 0.0, "end": 2.5, "text": "..."}
  #         {"type": "complete", "segments_count": 150}
  #         {"type": "error", "message": "CUDA out of memory"}
  ```

  - Uses faster-whisper (large-v3, CUDA, float16)
  - Optional: whisperx alignment + pyannote diarization (if HF token provided)
  - Streams JSON lines to stdout for real-time progress

- [ ] `src/main/services/ports/transcription.service.ts`:
  ```typescript
  interface TranscriptionService {
    transcribe(audioPath: string, options: TranscriptionOptions): AsyncGenerator<TranscriptionEvent>
    isAvailable(): Promise<{ available: boolean; gpuDetected: boolean; error?: string }>
  }
  ```
- [ ] `src/main/services/adapters/whisper-transcription.service.ts`:
  - Spawns `python transcribe.py` as child process
  - Parses JSON lines from stdout as `AsyncGenerator`
  - Handles stderr (warnings vs errors)
  - Kills process on cancel
  - Timeout: 30min max per transcription
- [ ] `src/main/ipc/transcription.handlers.ts`:
  - `transcription:start` — starts transcription, streams progress via IPC events
  - `transcription:status` — returns current status
  - `transcription:cancel` — kills Python process
  - `transcription:check` — verifies Python + faster-whisper available
- [ ] Error handling:
  - Python not found → clear message "Python not detected, install from python.org"
  - faster-whisper not installed → "Run: pip install faster-whisper"
  - CUDA not available → fallback to CPU with warning
  - Audio file too large (>2GB) → reject with message
  - Process crash → update status to FAILED, store error
- [ ] File dialog integration: `dialog.showOpenDialog` for audio/video files
  - Filters: `.mp4`, `.mp3`, `.wav`, `.m4a`, `.webm`, `.ogg`
- [ ] Unit tests (mocked Python process)
- [ ] Integration test (small test audio file, real faster-whisper)

### Verification

```bash
npm run test               # unit tests pass (mocked)
npm run dev                # select audio → progress bar → transcript appears
# Manual: transcribe a 1-min test file → segments with speakers
```

### Exit Criteria

- User can select an audio/video file via file dialog
- Transcription runs locally with GPU (faster-whisper)
- Progress updates stream to UI in real-time
- Transcript stored in SQLite with speaker labels and timestamps
- Errors are caught and shown to user (Python missing, CUDA unavailable, etc.)
- Cancel button kills the Python process cleanly

### Skills to invoke

- `/tdd` — test the Python bridge with mocked child process
- `/security-review` — child process spawning, file path sanitization

---

## Step 3b — React UI (Meetings, Player, Viewer) ⚡ PARALLEL with 3a

**Branch:** `feat/react-ui`
**Model tier:** default
**Depends on:** Step 2
**Rollback:** `git revert`
**File ownership:** `src/renderer/**` only.

### Context Brief

Build the desktop UI with React 19. Main views: meeting list (home), meeting detail (transcript viewer + audio player), create meeting dialog. Use TanStack Query for IPC state management (same pattern as API calls, but over IPC). Dark theme by default (Tailwind CSS).

### Task List

- [ ] **Tailwind CSS** setup (v4) + dark theme
- [ ] **UI components** (`components/ui/`):
  - Button, Input, Card, Modal, Badge, Spinner, EmptyState
  - ProgressBar (for transcription progress)
  - Toast/notification system
- [ ] **Layout** (`components/layouts/`):
  - AppLayout — sidebar + main content
  - Sidebar — meeting list, create button, settings
  - Header — app title, window controls (minimize/maximize/close)
- [ ] **Features:**
  - `features/meetings/`:
    - MeetingList — list all meetings with status badges
    - MeetingCard — title, date, duration, status
    - CreateMeetingDialog — title + file picker
    - MeetingDetail — tabs: transcript, summary, action items
  - `features/transcripts/`:
    - TranscriptViewer — scrollable transcript with speaker labels
    - TranscriptTimeline — clickable timeline synced with audio
    - SpeakerLabel — colored labels per speaker
    - SearchInTranscript — ctrl+F within transcript text
  - `features/player/`:
    - AudioPlayer — play/pause, seek, speed control (0.5x-2x)
    - Waveform visualization (wavesurfer.js or peaks.js)
    - Click-to-seek in transcript (click segment → audio jumps)
  - `features/settings/`:
    - SettingsDialog — Python path, whisper model, GPU toggle, API key
- [ ] **IPC service wrappers** (`services/`):
  ```typescript
  // Uses window.api exposed by preload
  export const meetingService = {
    list: () => window.api.meetings.list(),
    create: (data: CreateMeetingDto) => window.api.meetings.create(data),
    get: (id: string) => window.api.meetings.get(id),
  }
  ```
- [ ] **Hooks** with TanStack Query:
  - `useMeetings()` — query all meetings
  - `useMeeting(id)` — single meeting with transcript + summary
  - `useTranscriptionProgress(id)` — subscribes to IPC events for progress
- [ ] **Routing** — TanStack Router or React Router v7
  - `/` — meeting list
  - `/meetings/:id` — meeting detail
  - `/settings` — settings page
- [ ] Custom window frame (frameless window with custom title bar)
- [ ] Component tests with Testing Library

### Verification

```bash
npm run test               # component tests pass
npm run dev                # UI renders, navigation works
```

### Exit Criteria

- Meeting list renders with empty state
- Create meeting dialog opens file picker
- Meeting detail page shows transcript viewer (with mock data)
- Audio player plays local files with seek
- Dark theme applied consistently
- Custom window frame with minimize/maximize/close buttons
- All UI components have at least one test

### Skills to invoke

- `/frontend-patterns` — React component architecture, state management
- `/tdd` — test components before complex logic

---

## Step 3.5 — Integration Gate ★

**Branch:** `develop` (merge target)
**Model tier:** default
**Depends on:** Steps 3a + 3b (BOTH must be complete)

### Context Brief

Merge transcription engine and UI branches. Verify the full flow: select file → transcribe → see progress → view transcript.

### Task List

- [ ] Merge `feat/transcription-engine` into `develop`
- [ ] Rebase `feat/react-ui` onto `develop`, resolve conflicts, merge
- [ ] Wire transcription progress events to UI (IPC events → React state)
- [ ] Test full flow: select audio → progress bar → transcript viewer

### Verification

```bash
npm run lint && npm run typecheck && npm run test && npm run build
npm run dev   # full flow works
```

### Exit Criteria

- Select audio file → transcription starts → progress bar updates → transcript appears
- Transcript viewer shows speaker labels + timestamps
- Click on transcript segment → audio seeks to that point
- All tests pass, zero TS errors

---

## Step 4 — Claude API (Summarization + Action Items)

**Branch:** `feat/summarization`
**Model tier:** strongest
**Depends on:** Step 3.5
**Rollback:** `git revert`

### Context Brief

Send transcript text to Claude API to generate structured summary + action items. Uses Anthropic SDK directly from the Electron main process. Port/adapter pattern makes the AI provider swappable (could swap Claude for local LLM later).

### Task List

- [ ] Install `@anthropic-ai/sdk`
- [ ] `src/main/services/ports/summarization.service.ts`:

  ```typescript
  interface SummarizationService {
    summarize(transcript: string, options?: SummarizeOptions): Promise<SummaryResult>
  }

  interface SummaryResult {
    summary: string // markdown
    actionItems: ActionItemDto[]
    keyTopics: string[]
    decisions: string[]
  }
  ```

- [ ] `src/main/services/adapters/claude-summarization.service.ts`:
  - Uses Claude claude-sonnet-4-5-20250514 (good balance of speed + quality)
  - Structured prompt for: summary, action items, decisions, key topics
  - Tool use for structured output (JSON schema)
  - Handles long transcripts: chunk if >100K tokens, summarize chunks, then meta-summary
  - Error handling: API key invalid, rate limit, network error
- [ ] `src/main/ipc/summarization.handlers.ts`:
  - `summarization:start` — triggers summarization for a meeting
  - `summarization:status` — returns progress
- [ ] Update meeting status machine: `TRANSCRIBING → SUMMARIZING → COMPLETED`
- [ ] **Renderer UI:**
  - SummaryCard — markdown rendered summary
  - ActionItemList — checkable items with assignee
  - DecisionsList — key decisions extracted
  - KeyTopics — tags/badges
  - "Regenerate summary" button
- [ ] Settings: API key input with validation (test call on save)
- [ ] Cost estimation: show approximate token count + cost before summarizing
- [ ] Unit tests for summarization service (mocked API)

### Verification

```bash
npm run test               # all tests pass
npm run dev                # transcribe → summarize → view summary
```

### Exit Criteria

- After transcription, summary is generated automatically
- Summary shows markdown text, action items, decisions, key topics
- Action items are checkable (persisted to SQLite)
- "Regenerate" re-runs summarization
- API key validation works in settings
- Errors shown clearly (no API key, network error, etc.)

### Skills to invoke

- `/tdd` — test summarization with mocked Claude API
- `/security-review` — API key storage (use electron safeStorage for encryption)

---

## Step 5 — Packaging (.exe + Installer)

**Branch:** `feat/packaging`
**Model tier:** default
**Depends on:** Step 4
**Rollback:** `git revert`

### Context Brief

Package the Electron app into a Windows `.exe` with installer using electron-builder. Bundle the Python transcription script but NOT Python itself (user must have Python + faster-whisper installed). Include auto-updater for future releases.

### Task List

- [ ] `electron-builder.yml`:
  ```yaml
  appId: com.transcripta.app
  productName: Transcripta
  win:
    target: [nsis]
    icon: resources/icon.ico
  nsis:
    oneClick: false
    allowToChangeInstallationDirectory: true
    installerIcon: resources/icon.ico
  extraResources:
    - from: python/
      to: python/
      filter: ['**/*']
  publish:
    provider: github
    owner: joaodutra88
    repo: transcripta
  ```
- [ ] Bundle `python/transcribe.py` + `python/requirements.txt` in resources
- [ ] First-run setup wizard:
  1. Detect Python installation (`python --version`)
  2. Check faster-whisper installed (`python -c "import faster_whisper"`)
  3. Check GPU available (`python -c "import torch; print(torch.cuda.is_available())"`)
  4. If missing: show instructions with "Install" buttons/links
  5. Validate Anthropic API key (optional, can set later)
- [ ] App icon (resources/icon.ico, icon.png)
- [ ] electron-updater for auto-updates from GitHub Releases
- [ ] Uninstaller cleanup (remove AppData/transcripta on uninstall)
- [ ] Code signing (optional, skip for now — Windows SmartScreen warning)
- [ ] `package.json` scripts: `build:win`, `build:portable`, `publish`

### Verification

```bash
npm run build:win          # produces dist/Transcripta-Setup-x.x.x.exe
# Install on clean Windows → first-run wizard → transcribe a file → works
```

### Exit Criteria

- `.exe` installer runs and installs Transcripta
- First-run wizard detects Python + faster-whisper + GPU
- App works after fresh install (with Python prereqs)
- Auto-updater checks GitHub Releases on startup
- Portable build also works (no install needed)

### Skills to invoke

- `/deployment-patterns` — release strategy, versioning

---

## Step 6 — CI/CD (GitHub Actions + Auto-Updater)

**Branch:** `feat/cicd`
**Model tier:** default
**Depends on:** Step 5
**Rollback:** `git revert`

### Context Brief

Set up GitHub Actions to build, test, and release the .exe automatically. On every PR: lint + test. On tag push (v\*): build .exe + create GitHub Release with auto-updater manifest.

### Task List

- [ ] `.github/workflows/ci.yml`:
  ```yaml
  name: CI
  on:
    pull_request:
      branches: [main, develop]
  jobs:
    lint-test:
      runs-on: windows-latest # Windows for Electron
      steps:
        - uses: actions/checkout@v4
        - uses: actions/setup-node@v4
          with: { node-version: 22, cache: 'npm' }
        - run: npm ci
        - run: npm run lint
        - run: npm run typecheck
        - run: npm run test -- --coverage
  ```
- [ ] `.github/workflows/release.yml`:
  ```yaml
  name: Release
  on:
    push:
      tags: ['v*']
  jobs:
    build:
      runs-on: windows-latest
      steps:
        - uses: actions/checkout@v4
        - uses: actions/setup-node@v4
          with: { node-version: 22, cache: 'npm' }
        - run: npm ci
        - run: npm run build:win
          env:
            GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        - uses: actions/upload-artifact@v4
          with:
            name: installer
            path: dist/*.exe
        # electron-builder auto-publishes to GitHub Releases
  ```
- [ ] `.github/dependabot.yml`
- [ ] Release workflow: `npm version patch/minor/major` → `git push --tags` → CI builds + publishes
- [ ] Changelog generation (conventional-changelog or auto from commits)

### Verification

```bash
git tag v0.1.0 && git push --tags
# GitHub Actions → builds .exe → creates Release → .exe downloadable
```

### Exit Criteria

- PR triggers lint + test on `windows-latest`
- Tag push triggers build + GitHub Release
- .exe uploaded to GitHub Releases with auto-updater manifest
- Users can download from Releases page
- Auto-updater in app detects new version

### Skills to invoke

- `/deployment-patterns` — CI/CD pipeline patterns

---

## Step 7 — E2E + Smoke Tests

**Branch:** `feat/e2e-tests`
**Model tier:** default
**Depends on:** Step 6
**Rollback:** `git revert`

### Context Brief

Write Playwright E2E tests for the Electron app and smoke tests for the packaged .exe. Use `@playwright/test` with Electron's `_electron.launch()` API for desktop testing.

### Task List

- [ ] Install `@playwright/test` + `electron` (Playwright has native Electron support)
- [ ] `tests/e2e/electron.setup.ts`:
  ```typescript
  import { _electron as electron } from '@playwright/test'
  const app = await electron.launch({ args: ['.'] })
  const window = await app.firstWindow()
  ```
- [ ] **E2E Specs:**
  - `tests/e2e/app-launch.spec.ts` — app opens, shows meeting list
  - `tests/e2e/create-meeting.spec.ts` — file dialog → create → appears in list
  - `tests/e2e/transcription.spec.ts` — start transcription → progress → complete
  - `tests/e2e/summary.spec.ts` — view summary → action items → check/uncheck
  - `tests/e2e/settings.spec.ts` — configure Python path, API key
- [ ] **Smoke Tests** (on packaged .exe):
  - `tests/smoke/install.smoke.ts` — installer runs without error
  - `tests/smoke/launch.smoke.ts` — app launches and shows main window
  - `tests/smoke/python-check.smoke.ts` — Python detection works
- [ ] `package.json` scripts: `test:e2e`, `test:smoke`

### Verification

```bash
npm run test:e2e           # all E2E pass
npm run build:win && npm run test:smoke   # smoke tests on packaged app
```

### Exit Criteria

- E2E covers: app launch, meeting CRUD, transcription flow, summary view, settings
- Smoke tests verify packaged .exe launches and detects Python
- Tests run in CI (GitHub Actions on `windows-latest`)
- Playwright report + screenshots on failure

### Skills to invoke

- `/e2e-testing` — Playwright patterns, Page Object Model
- `/verification-loop` — full verification before merging

---

## Invariants (verified after every step)

- [ ] `npm run lint` — zero errors
- [ ] `npm run typecheck` — zero TS errors
- [ ] `npm run test` — all tests pass, 80%+ coverage
- [ ] `npm run build` — clean build
- [ ] Zero direct imports from main process in renderer (use IPC only)
- [ ] No secrets in code or git history (API keys in electron safeStorage)
- [ ] All new code has tests

## Coverage Targets

- **80%** minimum coverage for all modules (enforced in CI)

## Parallel Execution Summary

| Group | Steps   | Can run simultaneously          |
| ----- | ------- | ------------------------------- |
| A     | 3a + 3b | Transcription Engine + React UI |

**Total serial path:** Steps 1 → 2 → [3a‖3b] → 3.5 → 4 → 5 → 6 → 7
**Critical path:** 7 steps (with parallelism)
**Integration gate:** Step 3.5 merges parallel work before summarization
