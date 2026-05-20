# RFC: Extension Points for AI Assistant Integration in Arduino IDE 2.x

**Status:** Draft — seeking maintainer feedback before opening PRs
**Author:** @jainapurva (with contributions from @dhruvil-darji)
**Discussion target:** [arduino/arduino-ide Discussions](https://github.com/arduino/arduino-ide/discussions)
**Reference implementation:** [jainapurva/ArduinoIDE_agent](https://github.com/jainapurva/ArduinoIDE_agent)

## Summary

We propose adding three small, focused extension points to Arduino IDE 2.x that would let third-party plugins host an "AI assistant" experience (Cursor-style, Copilot-style, or otherwise) **without bundling any specific AI provider into Arduino IDE itself**.

The IDE stays vendor-neutral and beginner-friendly. AI features remain opt-in plugins.

## Motivation

We built [ArduinoIDE Agent](https://github.com/jainapurva/ArduinoIDE_agent), a fork that adds a Cursor-style agentic loop: describe a sketch, the agent writes the code, compiles it, fixes errors, installs missing libraries, uploads to the board, reads serial output, and iterates until it works.

Building it taught us three things:

1. **Most of the heavy lifting is already in the IDE.** We use `CoreServiceImpl` for compile/upload, `SketchService` for sketch I/O, the existing right-sidebar slot for the panel.
2. **The pieces we had to add are small and generic.** They have nothing to do with AI — any plugin that needs build feedback or sketch context would want them.
3. **Without those small pieces, every AI plugin has to fork the IDE.** That's bad for users (no auto-updates), bad for maintainers (parallel codebases drifting), bad for the ecosystem.

We'd like to upstream the *generic* pieces so the IDE becomes pluggable, and keep AI-specific code in our plugin.

## Non-goals

- Bundling Claude, OpenAI, Gemini, or any AI provider into Arduino IDE
- Shipping an AI panel by default
- Requiring users to install AI dependencies
- Replacing existing services with AI-aware versions

## Proposed extension points

### 1. `AssistantPanelContribution` — pluggable right-sidebar slot

A Theia contribution interface that lets a plugin register a widget into a reserved "assistant" slot in the right sidebar. The IDE ships an empty contribution by default; nothing changes for users without plugins.

- **Size:** ~150 lines (interface + DI registration + empty default)
- **Risk:** very low — adds an extension point, no behavior change

### 2. `BuildStateService` — last compile/upload result, read-only

A simple injectable service that captures the result of the most recent `compile` and `upload` calls (output, exit code, errors, timestamp). Plugins can subscribe to changes.

- **Useful on its own:** powers "rerun last build" UI, build-history widgets, CI integration tests.
- **Size:** ~120 lines (interface, in-memory impl, hook in `CoreServiceImpl`)
- **Risk:** low — purely additive

### 3. `SketchContextService` — current-sketch read-only API

A public, stable API exposing the currently open sketch's file list, contents, board FQBN, and port. Existing internal services already track all of this; this PR just exposes a clean read-only facade.

- **Useful on its own:** linters, formatters, doc generators, sketch validators.
- **Size:** ~100 lines (facade over existing services)
- **Risk:** low — read-only

### 4. Docs — contributor guide for assistant plugins

A new page in `docs/contributor-guide/` showing how to build a plugin that uses the three APIs above to host any AI assistant (Claude, OpenAI, local LLM, anything).

- **Size:** ~80 lines of markdown
- **Risk:** none

## What would NOT be upstreamed

- Claude CLI integration
- Tool-call protocol
- Diff view + accept/reject UI
- Library auto-install
- Multi-iteration agent loop
- Any prompt engineering
- IDE rebranding (appId, configDir, name)

All of that stays in our plugin/fork.

## Demo

Short demo video of the reference implementation: *[user to insert link]*

The video shows: prompt → agent writes sketch → agent compiles → agent hits missing library → agent installs library autonomously → agent recompiles → success. Runs in ~30 seconds.

## Questions for maintainers

1. **Are you open in principle** to adding these extension points, even though no first-party feature uses them yet?
2. **Should each be a separate PR**, or would you prefer a single coordinated PR?
3. **Naming:** `AssistantPanelContribution` is generic; would you prefer something more specific (e.g. `RightSidebarPluginContribution`) to avoid implying AI-only use?
4. **Stability guarantees:** what level of API stability would you commit to for these services? We're happy to mark them `@experimental` for one or two releases.
5. Anything you'd want from us before reviewing (issue triage labels, design doc, code-of-conduct sign-off, etc.)?

If the answer is "no, this isn't a direction Arduino IDE wants to go," we'll keep our work as an independent distribution and won't open the PRs. We just want to ask before submitting.

Thanks for your time.
