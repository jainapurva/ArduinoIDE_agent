# Agent AKI — Launch Social Media Posts

All posts are ready to copy-paste. Replace `[LINK]` with the actual GitHub URL.

---

## LinkedIn Teasers (Mon/Tue/Wed before launch)

### Teaser 1 — Monday: "The Problem"

Every Arduino project starts the same way:

1. Google which components you need
2. Find a wiring diagram (hope it's correct)
3. Copy-paste code from 3 different StackOverflow answers
4. Spend 2 hours debugging why the LCD shows garbage
5. Realize you wired SDA to the wrong pin

I've been building something to fix this.

More on Friday.

#Arduino #OpenSource #BuildInPublic

---

### Teaser 2 — Tuesday: "The Magic Moment"

"Build me a temperature sensor with an LCD display."

One sentence. That's the input.

The AI agent:
→ Picks the best board for the job
→ Selects the exact components
→ Generates the circuit design
→ Writes step-by-step wiring instructions
→ Generates and compiles the Arduino code
→ Then uses your camera to CHECK that you wired it correctly

Open-sourcing this Friday. Details coming.

#Arduino #AI #ESP32 #HardwareAI

---

### Teaser 3 — Wednesday: "48 Hours"

48 hours.

Agent AKI for Arduino goes open-source on Friday.

From a single prompt to verified, working hardware.

The full pipeline:
Prompt → Design → Validate → Wire → Code → Compile → Verify (with camera) → Test

Built on top of Arduino IDE 2.x. Same approach as Cursor forking VS Code.

Link drops Friday morning.

#OpenSource #Arduino #AI

---

## LinkedIn Launch Post — Friday

I just open-sourced Agent AKI — an AI-powered Arduino IDE that helps you build hardware projects end-to-end.

Give it a prompt like "build me a motion-activated alarm."

It will:
- Pick the best board (ESP32, Arduino Uno, or XIAO ESP32S3) and explain why
- Select the components you need
- Check for wiring conflicts and power issues
- Generate step-by-step assembly instructions with wire colors
- Write and compile the complete Arduino code
- Use your camera to verify your breadboard matches the design
- Upload the code and confirm it works

Think "Cursor for hardware."

Why I built this:
I was working on a pet robot project with ESP32 and kept running into the same cycle — wrong pins, power miscalculations, hours of debugging. I wanted an AI that could catch those mistakes BEFORE I power on the board.

The camera verification is the key feature. The agent literally looks at your breadboard and tells you "GPIO 21 should go to SDA — it's currently connected to the wrong rail."

It's a fork of Arduino IDE 2.x (same approach as Cursor forking VS Code), so you get a full IDE with board manager, library manager, serial monitor — plus an AI agent built in.

Fully open-source. AGPLv3.

→ GitHub: [LINK]
→ Demo video (90 sec): [LINK]
→ Getting started: [LINK]

If you build hardware, I'd love your feedback. And if you want to contribute, there are 15 "Good First Issues" waiting.

#OpenSource #Arduino #ESP32 #AI #AIAgent #Hardware #BuildInPublic #Makers

---

## X/Twitter Launch Thread — Friday

### Tweet 1 (Hook)

I just open-sourced an AI agent that builds Arduino hardware projects.

You give it a prompt. It picks the board, designs the circuit, writes the code, and uses your camera to verify your wiring.

It's called Agent AKI. Here's what it does:

### Tweet 2 (Pipeline)

The full pipeline:

1. You describe what you want to build
2. Agent picks the best board and explains why
3. Selects components, validates for conflicts
4. Generates step-by-step wiring instructions
5. Writes + compiles Arduino code
6. Camera verifies your breadboard
7. Uploads and tests via serial

### Tweet 3 (Camera)

The camera verification is the part that blows people's minds.

The agent literally looks at your breadboard through your webcam and says:

"Wire from GPIO 21 should go to the LCD's SDA pin — it's currently connected to the wrong rail."

### Tweet 4 (Architecture)

Built as a fork of Arduino IDE 2.x — same approach as Cursor forking VS Code.

You get a full IDE (board manager, library manager, serial monitor) with an AI agent built into the sidebar.

12 tools. Up to 20 autonomous iterations per task.

### Tweet 5 (Comparison)

How it compares:

ArduinoVision → AVR only, basic GPIO
Embedr → closed source, no camera
Cirkit Designer → closed, no agent

Agent AKI → full pipeline, multi-board, camera verification, open-source

### Tweet 6 (Origin)

I built this while working on a pet robot with ESP32.

Kept making the same mistakes — wrong pins, power issues, hours of debugging.

I wanted an AI that could catch those errors BEFORE I powered on the board.

So I built one.

### Tweet 7 (CTA)

Supports ESP32, XIAO ESP32S3, and Arduino Uno. AGPLv3.

15 "Good First Issues" for contributors.

GitHub: [LINK]

Star it, try it, break it, tell me what's wrong.

### Tweet 8 (Boost)

If you build hardware and want to try it, the getting started guide takes about 5 minutes.

RTs appreciated — I want this to reach the people who need it.

---

## Reddit Posts

### r/arduino

**Title:** I open-sourced an AI-powered Arduino IDE that designs circuits, writes code, and verifies your wiring with a camera

I've been working on a pet robot project with ESP32 and kept running into the same problems — wrong pin assignments, power budget issues, wiring SDA to the wrong GPIO. So I built an AI agent that catches those mistakes before you even power on the board.

It's called Agent AKI — a fork of Arduino IDE 2.x with an AI agent built into the sidebar. You give it one prompt like "build me a temperature sensor with an LCD display" and it:

1. Picks the best board (supports ESP32, XIAO ESP32S3, Arduino Uno)
2. Selects components and validates pin assignments
3. Generates step-by-step wiring instructions with wire colors
4. Writes complete Arduino code and compiles it
5. Uses your webcam to verify your breadboard matches the design

The camera verification is the part I'm most excited about. The agent looks at your breadboard and tells you which connections are correct, which are missing, and what's wrong.

Fully open-source (AGPLv3). 15 "Good First Issues" if you want to contribute.

GitHub: [LINK]

Happy to answer questions about the architecture or take feedback.

---

### r/esp32

**Title:** Built an AI agent that designs ESP32 circuits, writes code, and verifies wiring with camera — open-sourced today

I built Agent AKI specifically because I kept getting burned by ESP32 quirks — strapping pins affecting boot, input-only pins (GPIO 34-39) used as outputs, I2C/I2S bus conflicts.

The agent knows ESP32 pin constraints natively. It won't assign your sensor to GPIO 12 (strapping pin) or try to output on GPIO 34 (input-only).

Supports ESP32-WROOM-32 and XIAO ESP32S3 Sense (with built-in camera, mic, SD card).

It's a fork of Arduino IDE 2.x with an AI chat panel. Give it a prompt, it handles everything.

GitHub: [LINK]

---

### r/programming

**Title:** We forked Arduino IDE and added an AI agent that autonomously builds hardware projects — from circuit design to camera-verified wiring

Think Cursor (the VS Code fork with AI), but for Arduino hardware.

Agent AKI is a fork of Arduino IDE 2.x (Theia + Electron + TypeScript). We added an AI agent panel in the sidebar with 12 tools that can:

- Auto-select boards based on project requirements
- Validate circuit designs (pin conflicts, power budget, voltage mismatches)
- Generate wiring instructions from a natural language prompt
- Write, compile, and upload Arduino code autonomously
- Use computer vision (Claude Vision API) to verify physical breadboard wiring

The agent runs in an autonomous loop — up to 20 iterations. If compilation fails, it reads the error and fixes the code itself. The user's only job is physical: wire the breadboard and plug in USB.

Tech stack: TypeScript, Theia IDE framework, Electron, arduino-cli via gRPC, Claude CLI for LLM.

AGPLv3 (same as upstream Arduino IDE).

GitHub: [LINK]

---

## Hacker News

**Title:** Show HN: Agent AKI – Open-source AI agent for Arduino, from prompt to camera-verified hardware

**Author comment:**

Hi HN, I'm Apurva. I built Agent AKI because I was tired of the "Google the wiring diagram → copy code from StackOverflow → debug for 2 hours" cycle when building Arduino projects.

Agent AKI is a fork of Arduino IDE 2.x with an AI agent that handles the entire hardware development workflow. You describe what you want ("motion-activated alarm") and the agent:

1. Picks the best board (ESP32, XIAO ESP32S3, or Arduino Uno)
2. Selects components and validates pin assignments
3. Generates step-by-step wiring instructions
4. Writes complete Arduino code
5. Compiles and fixes errors autonomously
6. Uses your webcam + Claude Vision to verify your breadboard wiring

Architecture: Theia + Electron + TypeScript. The agent uses Claude CLI (`claude -p`) as the LLM backend — no API keys needed if you have a Claude Code subscription.

I'd love feedback on: the knowledge base format (boards.json/components.json), the pin validation logic, and whether the autonomous workflow makes sense.

GitHub: [LINK]

---

## Product Hunt

**Tagline:** From a prompt to verified, working Arduino hardware — powered by AI

**Description:**

Agent AKI is an open-source, AI-powered Arduino IDE. Give it one prompt like "build me a weather station" and it designs the circuit, picks components, generates wiring instructions, writes the code, compiles it, and even uses your camera to verify your breadboard.

Built as a fork of Arduino IDE 2.x (think Cursor for hardware). Supports ESP32, XIAO ESP32S3, and Arduino Uno.

**First comment:**

Maker here! I built this because I was tired of spending more time debugging wiring than actually building. The camera verification feature is what makes this different — the agent literally looks at your breadboard and tells you what's wrong. Would love your feedback!
