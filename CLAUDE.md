# ArduinoIDE Agent — CLAUDE.md

## Project Overview
Fork of Arduino IDE 2.x (Theia + Electron + TypeScript) transformed into a Cursor-style
fully agentic embedded development environment. AI can autonomously write code, compile,
flash, read serial output, and iterate to fix bugs — all in a continuous loop.

## Architecture

### Tech Stack (inherited)
- **Frontend**: Theia IDE + React + TypeScript
- **Desktop**: Electron 30
- **Backend**: Node.js + Inversify DI
- **CLI**: Arduino CLI (gRPC daemon mode)
- **Build**: Yarn + Lerna monorepo

### New Agentic Layers Added

```
arduino-ide-extension/src/
├── common/protocol/
│   ├── agent-service.ts          ← Shared RPC interface (AgentService + AgentServiceClient)
│   └── build-state-service.ts    ← BuildStateService — captures last compile/upload result
├── node/
│   ├── agent/
│   │   ├── claude-client.ts          ← Calls `claude -p` CLI subprocess (no API key)
│   │   ├── agent-tools.ts            ← Tool registry: compile, upload, read_serial, write_file, etc.
│   │   └── agent-service-impl.ts     ← Agentic loop orchestrator (max 12 iterations) + diff interception
│   └── build-state-service-impl.ts   ← In-memory store for last build result
└── browser/agent/
    ├── agent-panel-widget.tsx    ← Cursor-style AI chat panel + diff view (ReactWidget)
    └── agent-view-contribution.ts ← Registers panel in right sidebar, Ctrl+Shift+A
```

### CSS
- `arduino-ide-extension/src/browser/style/agent-panel.css` — Dark theme agent panel + diff styles
- Imported in `index.css`

## Current State
**Branch**: `feat/agentic-core` on `jainapurva/ArduinoIDE_agent`

### Phase 1 Complete ✅
- [x] Forked + cloned from arduino/arduino-ide
- [x] Rebranded to "ArduinoIDE Agent" (appId: io.arduinoide.agent, configDir: .arduinoIDEAgent)
- [x] AgentService protocol (common/protocol/agent-service.ts)
- [x] ClaudeClient using `claude -p` CLI (no API key, uses subscription)
- [x] AgentToolRegistry with 7 tools: read_file, write_file, list_files, compile, upload, read_serial, suggest_library
- [x] AgentServiceImpl with multi-turn agentic loop (max 12 iterations)
- [x] AgentPanelWidget — Cursor-style chat UI with welcome screen, tool call display, streaming
- [x] AgentViewContribution — registered in right sidebar, opens on startup
- [x] Registered in both frontend + backend modules
- [x] agent-panel.css — full dark theme styles

### Phase 2 Complete ✅
- [x] Multi-file sketch support — agent sees all .ino/.cpp/.c/.h/.hpp/.S files, not just main .ino
- [x] Diff view for file changes — write_file shows unified diff with Accept/Reject buttons (60s timeout)
- [x] Build error wiring — CoreServiceImpl captures compile/upload results into BuildStateService
- [x] list_files tool enhanced — shows file sizes and types (source/header/assembly)
- [x] System prompt updated — shows all sketch files with truncation for large files (>200 lines)

## TODO (Phase 3)

### HIL (Hardware-in-the-Loop) Agent Mode
- `startHILSession()` in AgentServiceImpl — continuous serial monitoring loop
- ARM Cortex-M HardFault decoder (parse CFSR/HFSR registers from serial dump)
- FreeRTOS deadlock detector

### Datasheet Intelligence
- PDF upload UI in agent panel
- `DatasheetService` using `pdf-parse`
- Register map extraction → driver code generator

### UI Polish
- Syntax highlighting in agent messages (code blocks)
- Agent mode indicator in status bar (pulsing dot)
- Token usage display

## Key Decisions
1. **Claude backend**: Uses `claude -p` CLI subprocess, not API keys. Path: `~/.local/bin/claude`
2. **Tool protocol**: Claude responds with `{"tool_use": true, "name": "...", "input": {...}}` JSON
3. **Max iterations**: 12 per chat turn to prevent infinite loops
4. **Widget placement**: Right side panel (Theia `area: 'right'`), opens on first launch
5. **Session model**: One session per IDE window, persisted in memory (not disk)
6. **Diff view**: write_file intercepted in agentic loop — Promise-based pause waiting for user Accept/Reject (60s auto-reject timeout)
7. **Build state**: BuildStateService is a simple in-memory singleton; CoreServiceImpl hooks into compile/upload end/error events

## Build Instructions
```bash
cd /media/ddarji/storage/git/ArduinoIDE_agent
yarn install           # Install all deps (takes 5-10 min first time)
yarn build             # Build all packages
yarn start             # Start Electron app
```

## Recent Changes
- 2026-02-26: Phase 2 complete — multi-file sketch support, diff view, build error wiring
- 2026-02-23: Phase 1 complete — all core agent files created, registered in DI modules

## Known Issues / Gotchas
- `CoreServiceImpl.compile/upload` signatures may need adjustment — the tool wrappers use simplified signatures
- `uuid` package added to dependencies but needs `yarn install` to resolve
- Theia version pinned at 1.57.0 — do not upgrade without testing
- LCS diff algorithm is O(m*n) — may be slow for very large files (>1000 lines); consider switching to a faster algorithm if needed
- Diff view auto-rejects after 60s — if the user is AFK, writes will be rejected silently
