<div align="center">
  <img src="https://content.arduino.cc/website/Arduino_logo_teal.svg" height="80" />
  <h1>ArduinoIDE Agent 🤖</h1>
  <p><strong>The first fully agentic Arduino IDE — powered by Claude AI</strong></p>
  <p>
    <img src="https://img.shields.io/badge/version-2.3.8--agent-blue" />
    <img src="https://img.shields.io/badge/AI-Claude%20Sonnet%204.6-purple" />
    <img src="https://img.shields.io/badge/platform-Electron-lightblue" />
    <img src="https://img.shields.io/badge/base-Arduino%20IDE%202.x-teal" />
    <img src="https://img.shields.io/badge/branch-feat%2Fagentic--core-green" />
  </p>
</div>

---

> **Forked from** [arduino/arduino-ide](https://github.com/arduino/arduino-ide) · Active branch: `feat/agentic-core`

ArduinoIDE Agent transforms the standard Arduino IDE into a **Cursor-style agentic development environment**. Plug in your board, describe what you want to build, and the AI agent writes the code, compiles it, flashes it to your hardware, reads the serial output, and iterates until it works — all autonomously.

---

## What's New vs Arduino IDE 2.x

| Feature | Arduino IDE 2.x | ArduinoIDE Agent |
|---|---|---|
| AI Assistant | ❌ | ✅ Full agentic loop |
| Auto-compile on error | ❌ | ✅ Agent iterates |
| Auto-upload | ❌ | ✅ Agent flashes board |
| Serial monitor feedback | Manual | ✅ Agent reads output |
| Datasheet → Driver | ❌ | 🔜 Phase 3 |
| Board auto-detection | Manual | ✅ Agent sees live state |
| Code suggestions | ❌ | ✅ Full code generation |

---

## Demo Flow

```
User: "Read temperature from DHT22 on pin 2 and print every second"

Agent:
  1. [write_file] → writes DHT22 Arduino sketch
  2. [compile]    → compiles for selected board
  3. [compile]    → fixes error: "DHT.h not found" → adds library include
  4. [upload]     → flashes to connected Arduino
  5. [read_serial] → reads: "Temperature: 23.4°C, Humidity: 61%"
  6. ✅ Done — confirms working
```

---

## Architecture

### New Agentic Layers (all new code is in `arduino-ide-extension/src/`)

```
arduino-ide-extension/src/
├── common/protocol/
│   └── agent-service.ts              ← RPC interface (AgentService + streaming client)
│
├── node/agent/                        ← Backend (Node.js)
│   ├── claude-client.ts              ← Calls claude -p CLI (no API key needed)
│   ├── agent-tools.ts                ← Tool registry: 7 tools
│   └── agent-service-impl.ts         ← Agentic loop orchestrator (max 12 iters)
│
└── browser/agent/                     ← Frontend (React/Theia)
    ├── agent-panel-widget.tsx         ← Cursor-style chat panel
    └── agent-view-contribution.ts     ← Sidebar registration, Ctrl+Shift+A
```

### Agent Tools

| Tool | What it does |
|---|---|
| `write_file` | Write/overwrite sketch files (agent's primary code output) |
| `read_file` | Read any file in the sketch directory |
| `list_files` | List files in sketch folder |
| `compile` | Run `arduino-cli compile` — returns errors for agent to fix |
| `upload` | Compile + `arduino-cli upload` to connected board |
| `read_serial` | Read serial monitor buffer (live board output) |
| `suggest_library` | Recommend Arduino library for a use case |

### Agentic Loop

```
User message
     ↓
Build system prompt (board FQBN + port + sketch code + serial buffer)
     ↓
Claude (claude -p CLI, no API key)
     ↓
  ┌──────────────────────────────┐
  │ tool_use? → execute tool    │
  │   → append result to history │
  │   → loop (max 12 iterations)│
  └──────────────────────────────┘
     ↓
Final response → stream to UI
```

### Live IDE Context (Plug & Play)

The agent always knows:
- **Board FQBN** — from `BoardsServiceProvider` (whatever you selected in toolbar)
- **Port** — from `BoardsServiceProvider` (auto-updates when you plug in USB)
- **Sketch path** — from `SketchesServiceClientImpl`
- **Sketch code** — read server-side from disk
- **Serial output** — from `MonitorModel` (last 200 lines)

---

## Getting Started

### Prerequisites
- Node.js 18–20
- Yarn 1.x
- Claude Code subscription (for `claude -p` CLI)

### Build from Source

```bash
git clone https://github.com/jainapurva/ArduinoIDE_agent.git
cd ArduinoIDE_agent
git checkout feat/agentic-core

# Install dependencies
yarn install

# Build
yarn build

# Run
yarn start
```

> **Note:** First build downloads Arduino CLI and language server tools (~5 min).

### Using the Agent

1. Open ArduinoIDE Agent
2. Plug in your Arduino/ESP32/board via USB
3. Select board from the **toolbar dropdown** (e.g. "Arduino Uno")
4. Select port (auto-detected, shown in toolbar)
5. Press **Ctrl+Shift+A** to open the AI Agent panel (or it opens automatically)
6. Type what you want to build → press Enter
7. Watch the agent write, compile, flash, and verify 🚀

---

## Project Structure

```
ArduinoIDE_agent/
├── arduino-ide-extension/        ← Main extension (all agent code here)
│   ├── src/
│   │   ├── browser/              ← Frontend (React + Theia widgets)
│   │   │   ├── agent/            ← 🆕 Agent panel widget + view contribution
│   │   │   └── style/            ← CSS (agent-panel.css added)
│   │   ├── node/                 ← Backend (Node.js services)
│   │   │   └── agent/            ← 🆕 ClaudeClient + AgentService + Tools
│   │   └── common/protocol/      ← Shared RPC interfaces
│   │       └── agent-service.ts  ← 🆕 Agent protocol definition
│   └── package.json
├── electron-app/                 ← Electron shell (rebranded)
├── CLAUDE.md                     ← 🆕 Project memory + architecture docs
└── README.md                     ← This file
```

---

## Roadmap

### ✅ Phase 1 — Core Agent (Done)
- Forked from arduino/arduino-ide
- Rebranded to ArduinoIDE Agent
- AgentService RPC protocol
- ClaudeClient (claude -p, no API key)
- 7 agent tools (compile, upload, serial, file I/O, library suggest)
- Multi-turn agentic loop (12 iterations max, user abort)
- Cursor-style chat panel with streaming
- Live board/port/sketch context wiring
- Zero TypeScript errors in all new files

### 🔜 Phase 2 — HIL Loop
- Hardware-in-the-loop continuous monitoring mode
- ARM Cortex-M HardFault decoder (parse CFSR/HFSR from serial)
- FreeRTOS deadlock detector
- Last build errors/output injected into context

### 🔜 Phase 3 — Datasheet Intelligence
- PDF upload → extract register maps → generate C/Rust drivers
- MCU-specific agent "packs" (STM32, ESP32, nRF52, RP2040)
- Peripheral configuration agent (SPI/I2C/UART from natural language)

### 🔜 Phase 4 — Polish & Distribution
- Diff view for AI-proposed code changes (Accept/Reject)
- Agent mode status bar indicator
- Package as .deb / .AppImage / .dmg / .exe
- Monetization hooks (usage tracking, free/pro tiers)

---

## Key Design Decisions

| Decision | Rationale |
|---|---|
| `claude -p` CLI (no API key) | Uses existing Claude Code subscription — zero setup for users |
| subprocess for compile/upload | Avoids gRPC DI complexity; works standalone with bundled arduino-cli |
| Max 12 iterations | Prevents infinite loops; user can abort or continue manually |
| Context built frontend-side | Frontend has live access to BoardsServiceProvider + SketchesService |
| Sketch code read server-side | Backend reads .ino from disk — no large payloads over RPC |

---

## Based On

- [Arduino IDE 2.x](https://github.com/arduino/arduino-ide) — AGPL-3.0
- [Theia IDE](https://theia-ide.org/) — EPL-2.0
- [Arduino CLI](https://github.com/arduino/arduino-cli) — GPL-3.0
- [Claude](https://claude.ai) by Anthropic

---

<div align="center">
  <sub>Built with ❤️ on top of Arduino IDE 2.x · Branch: <code>feat/agentic-core</code></sub>
</div>
