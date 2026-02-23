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
│   └── agent-service.ts          ← Shared RPC interface (AgentService + AgentServiceClient)
├── node/agent/
│   ├── claude-client.ts          ← Calls `claude -p` CLI subprocess (no API key)
│   ├── agent-tools.ts            ← Tool registry: compile, upload, read_serial, write_file, etc.
│   └── agent-service-impl.ts     ← Agentic loop orchestrator (max 12 iterations)
└── browser/agent/
    ├── agent-panel-widget.tsx    ← Cursor-style AI chat panel (ReactWidget)
    └── agent-view-contribution.ts ← Registers panel in right sidebar, Ctrl+Shift+A
```

### CSS
- `arduino-ide-extension/src/browser/style/agent-panel.css` — Dark theme agent panel
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

## TODO (Phase 2)

### Context Injection (high priority)
- Wire `buildContext()` in AgentPanelWidget to real services:
  - `BoardsServiceProvider` for FQBN + port
  - `SketchesService` for current sketch path + code
  - `MonitorManagerProxy` for live serial buffer
  - `CoreService` for last build output/errors

### HIL (Hardware-in-the-Loop) Agent Mode
- `startHILSession()` in AgentServiceImpl — continuous serial monitoring loop
- ARM Cortex-M HardFault decoder (parse CFSR/HFSR registers from serial dump)
- FreeRTOS deadlock detector

### Datasheet Intelligence (Phase 3)
- PDF upload UI in agent panel
- `DatasheetService` using `pdf-parse`
- Register map extraction → driver code generator

### UI Polish (Phase 4)
- Diff view for AI-proposed code changes (Accept/Reject buttons)
- Syntax highlighting in agent messages (code blocks)
- Agent mode indicator in status bar (pulsing dot)
- Token usage display

## Key Decisions
1. **Claude backend**: Uses `claude -p` CLI subprocess, not API keys. Path: `~/.local/bin/claude`
2. **Tool protocol**: Claude responds with `{"tool_use": true, "name": "...", "input": {...}}` JSON
3. **Max iterations**: 12 per chat turn to prevent infinite loops
4. **Widget placement**: Right side panel (Theia `area: 'right'`), opens on first launch
5. **Session model**: One session per IDE window, persisted in memory (not disk)

## Build Instructions
```bash
cd /media/ddarji/storage/git/ArduinoIDE_agent
yarn install           # Install all deps (takes 5-10 min first time)
yarn build             # Build all packages
yarn start             # Start Electron app
```

## Recent Changes
- 2026-02-23: Phase 1 complete — all core agent files created, registered in DI modules

## Known Issues / Gotchas
- `buildContext()` in AgentPanelWidget currently returns stub data — needs wiring to real services
- `CoreServiceImpl.compile/upload` signatures may need adjustment — the tool wrappers use simplified signatures
- `uuid` package added to dependencies but needs `yarn install` to resolve
- Theia version pinned at 1.57.0 — do not upgrade without testing
