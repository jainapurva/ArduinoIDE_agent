<div align="center">
  <img src="https://content.arduino.cc/website/Arduino_logo_teal.svg" height="80" />
  <h1>ArduinoIDE Agent</h1>
  <p><strong>A Cursor-style distribution of Arduino IDE 2.x with a built-in AI agent.</strong></p>
  <p>
    <img src="https://img.shields.io/badge/base-Arduino%20IDE%202.x-teal" />
    <img src="https://img.shields.io/badge/license-AGPL--3.0-blue" />
    <img src="https://img.shields.io/badge/AI-Claude-purple" />
    <img src="https://img.shields.io/badge/status-experimental-orange" />
  </p>
</div>

---

> A community distribution. **Not** an official Arduino product.
> Forked from [arduino/arduino-ide](https://github.com/arduino/arduino-ide) · Active branch: `feat/agentic-core`

ArduinoIDE Agent is to Arduino IDE what **Cursor is to VS Code**: same editor, same project files, same compile/upload toolchain — plus a Cursor-style AI agent panel that can write sketches, compile them, install missing libraries, upload to your board, read serial output, and iterate to fix bugs autonomously.

## Why a distribution, not just a plugin?

Arduino IDE 2.x doesn't currently expose extension points for an AI assistant. To wire one in deeply (live sketch context, build feedback, sidebar slot), we had to fork. We've opened an [RFC with the upstream maintainers](docs/rfc/0001-ai-assistant-extension-points.md) proposing the small, generic extension points needed. **If they're accepted, this distribution will become a regular plugin** and the fork goes away.

## Demo

> *[insert demo video / GIF link]*

```text
User:  Read temperature from DHT22 on pin 2 and print every second.

Agent: [write_file] dht22.ino (124 lines)
       [compile]    → error: DHT.h: No such file or directory
       [install_library] "DHT sensor library"  ← autonomous, no manual install
       [compile]    → Sketch uses 3242 bytes (10%)
       ✓ Done — upload when ready
```

## Install

> **Status: experimental.** Build from source only. Binary releases coming once core features stabilize.

### Prerequisites
- Node.js 18–20, Yarn 1.x
- A working [`claude` CLI](https://docs.anthropic.com/en/docs/claude-code) (uses your Claude Code subscription — no API key needed)

### Build

```bash
git clone https://github.com/jainapurva/ArduinoIDE_agent.git
cd ArduinoIDE_agent
git checkout feat/agentic-core
yarn install   # ~5 min first time
yarn build
yarn start
```

### Use the agent

1. Plug your board in, pick it from the toolbar dropdown (or let the agent infer the FQBN from your prompt).
2. Open the **AI Agent** panel (right sidebar, or `Ctrl+Shift+A`).
3. Describe what you want to build, press Enter. The agent handles the rest.

## Upstream relationship

We track [arduino/arduino-ide](https://github.com/arduino/arduino-ide) `main` and rebase regularly. All AI-specific code lives under `arduino-ide-extension/src/{browser,common,node}/agent/` and is purely additive — no Arduino IDE behavior is changed.

**Trying to upstream:**
- [RFC #0001](docs/rfc/0001-ai-assistant-extension-points.md) — generic extension points (assistant panel slot, build-state service, sketch-context API)
- The provider-specific Claude integration stays here as the reference implementation.

If you maintain Arduino IDE and want to discuss the RFC, please comment on the linked discussion.

## What's actually in this fork

| Layer | Files | What it does |
|---|---|---|
| Agent panel UI | `browser/agent/` | Right-sidebar chat widget, diff viewer with auto-accept |
| Claude client | `node/agent/claude-client.ts` | Shells out to `claude -p`, parses tool-call JSON |
| Tool registry | `node/agent/agent-tools.ts` | `compile`, `upload`, `read_file`, `write_file`, `list_files`, `read_serial`, `install_library`, `suggest_library`, plus hardware-design tools |
| Agent loop | `node/agent/agent-service-impl.ts` | Multi-turn orchestrator (max 12 iterations), builds system prompt with live IDE context |
| Build state | `node/build-state-service-impl.ts` | Captures last compile/upload result so the agent can react to failures |

Everything in this fork that **isn't** in those paths is unchanged from upstream Arduino IDE.

## Status & roadmap

| Phase | Status |
|---|---|
| Phase 1 — Core agent (panel, tools, loop) | ✓ shipped |
| Phase 2 — Diff view, build-state, autonomous library/board install | ✓ shipped |
| Phase 3 — HIL mode, fault decoders, datasheet → driver | planned |
| Upstream RFC merged → repackage as plugin | open |

## Contributing

Issues and PRs welcome. Before opening a large feature PR, please open an issue first to discuss scope.

- **Bug reports:** use the issue tracker (enable issues first if not yet on)
- **Discussions about upstreaming:** comment on [RFC #0001](docs/rfc/0001-ai-assistant-extension-points.md)
- **Code style:** match the surrounding Arduino IDE style. We rebase onto upstream, so don't reformat untouched files.

## Licensing & attribution

This project is licensed under **AGPL-3.0** — inherited from Arduino IDE, which we depend on. See `LICENSE.txt` for the full text.

Built on:
- [Arduino IDE 2.x](https://github.com/arduino/arduino-ide) (AGPL-3.0)
- [Theia IDE](https://theia-ide.org/) (EPL-2.0)
- [Arduino CLI](https://github.com/arduino/arduino-cli) (GPL-3.0)
- [Claude](https://claude.ai) by Anthropic

ArduinoIDE Agent is not affiliated with or endorsed by Arduino S.r.l. or Anthropic.
