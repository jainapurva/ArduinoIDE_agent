# Agent AKI for Arduino — User Stories

## Core UX Principle

**The user gives ONE prompt. That's it.**

Example: "I want to build a motion-activated alarm"

The agent figures out EVERYTHING:
- Which board to use (or suggests top 2-3 options)
- Which components are needed
- The full circuit design and pin assignments
- Step-by-step wiring instructions
- The complete Arduino code
- Compilation, upload, and testing

If the user specifies something specific ("use ESP32", "I have a DHT22"), the agent respects that. Otherwise, the agent picks the best option and explains why.

**Think of it like Cursor for hardware** — you describe what you want, the AI builds it.

---

> Each story is self-contained. Hand one to Claude in a fresh session with this preamble:
>
> ```
> You are working on the ArduinoIDE Agent project at /Users/apurva/ArduinoIDE_agent.
> Branch: feat/agentic-core. Read CLAUDE.md first for architecture context.
> Execute the following user story. Include tests. Compile-check your TypeScript.
> ```

---

## Story 0: Build Verification & Fix

**As a** developer cloning this project,
**I want** `yarn install && yarn build` to succeed without errors,
**So that** I have a working baseline to develop against.

### Context
- Repo: `/Users/apurva/ArduinoIDE_agent`, branch `feat/agentic-core`
- This is an Arduino IDE 2.x fork (Theia + Electron + TypeScript)
- Phase 1 agent code was added but may have unresolved TypeScript errors

### Acceptance Criteria
1. `yarn install` completes without errors
2. `yarn build` compiles all TypeScript without errors
3. If there are TS errors, fix them — likely in:
   - DI bindings in `arduino-ide-extension/src/browser/arduino-ide-frontend-module.ts`
   - DI bindings in `arduino-ide-extension/src/node/arduino-ide-backend-module.ts`
   - Import paths in agent files
4. `yarn start` launches the Electron app (manual verification)

### Key Files
- `arduino-ide-extension/src/browser/arduino-ide-frontend-module.ts` — frontend DI
- `arduino-ide-extension/src/node/arduino-ide-backend-module.ts` — backend DI
- `arduino-ide-extension/src/browser/agent/agent-panel-widget.tsx`
- `arduino-ide-extension/src/node/agent/agent-service-impl.ts`
- `arduino-ide-extension/src/node/agent/agent-tools.ts`
- `arduino-ide-extension/src/node/agent/claude-client.ts`
- `arduino-ide-extension/src/common/protocol/agent-service.ts`
- `arduino-ide-extension/src/browser/agent/agent-view-contribution.ts`
- `arduino-ide-extension/src/browser/style/agent-panel.css` (imported in `index.css`)

### Notes
- The DI system is Inversify. Agent services must be bound in the frontend/backend modules.
- `AgentPanelWidget` is a `ReactWidget` (Theia concept).
- `AgentServiceImpl` must be exposed via JSON-RPC at `AgentServicePath`.
- `AgentPanelWidget` implements `AgentServiceClient` (receives backend callbacks).
- The `agent-panel.css` must be imported in `arduino-ide-extension/src/browser/style/index.css`.
- The `arduinoCliPath` import in `agent-tools.ts` comes from `../resources` — verify this export exists.

### Test
- `yarn build` exits 0

---

## Story 1: Hardware Knowledge Base — Board Definitions

**As a** developer using Agent AKI,
**I want** the agent to know the specs of common Arduino/ESP32 boards,
**So that** it can suggest valid pin assignments and catch hardware conflicts.

### Acceptance Criteria
1. Create `arduino-ide-extension/src/node/agent/knowledge/data/boards.json` with entries for:
   - **ESP32-WROOM-32**: all GPIOs (0-39), I2C/I2S/SPI buses, strapping pins (0,2,12,15), input-only pins (34-39), FQBN `esp32:esp32:esp32`, 3.3V logic, 500mA 3.3V rail
   - **XIAO ESP32S3 Sense**: pin mapping (D0-D10 → GPIO numbers), built-in PDM mic (GPIO 41/42), built-in camera, built-in SD, I2C on D0/D1, FQBN `esp32:esp32:XIAO_ESP32S3`, 3.3V logic
   - **Arduino Uno**: digital pins 0-13, analog A0-A5, I2C on A4/A5, SPI on 11/12/13, PWM on 3/5/6/9/10/11, FQBN `arduino:avr:uno`, 5V logic, no strapping pins
2. Create `arduino-ide-extension/src/node/agent/knowledge/boards.ts`:
   - `interface BoardSpec` with fields: `id`, `name`, `fqbn`, `voltage`, `pins` (map of pin name → capabilities), `strappingPins`, `inputOnlyPins`, `i2cBuses`, `i2sPorts`, `spiBuses`, `max3v3CurrentMa`, `features` (list: `wifi`, `bluetooth`, `camera`, `sd_card`, `battery_charging`, `built_in_mic`), `price` (approximate USD), `complexity` (`beginner` | `intermediate` | `advanced`)
   - `function loadBoards(): BoardSpec[]` — loads from boards.json
   - `function getBoard(id: string): BoardSpec | undefined`
   - `function listBoards(): { id: string; name: string; fqbn: string }[]`
   - `function recommendBoard(requirements: { needsWifi?: boolean; needsBluetooth?: boolean; needsCamera?: boolean; needsSdCard?: boolean; minGpioPins?: number; needs5vLogic?: boolean; needsAnalogPins?: number; budgetFriendly?: boolean }): { primary: BoardSpec; alternatives: BoardSpec[]; reasoning: string }` — picks the best board for the job and explains why
3. Each pin in the board spec should have: `type` (io/input_only/power/gnd), `buses` (list of bus capabilities like `i2c_sda`, `i2s_bclk`, `spi_mosi`), `pwm` (boolean), `adc` (boolean), `notes` (string)
4. Board features and price in `boards.json`:
   - Arduino Uno: features=[], price ~$12, complexity=beginner
   - ESP32-WROOM-32: features=[wifi, bluetooth], price ~$8, complexity=intermediate
   - XIAO ESP32S3 Sense: features=[wifi, bluetooth, camera, sd_card, built_in_mic, battery_charging], price ~$14, complexity=intermediate

### Test
- Create `arduino-ide-extension/src/node/agent/knowledge/__tests__/boards.test.ts`
- Test: `loadBoards()` returns 3 boards
- Test: `getBoard('esp32_wroom_32')` returns correct FQBN
- Test: ESP32 GPIO 34-39 are marked as `input_only`
- Test: ESP32 GPIO 0,2,12,15 are in `strappingPins`
- Test: Arduino Uno has 5V logic, ESP32 has 3.3V
- Test: `recommendBoard({needsWifi: true})` → primary is ESP32 or XIAO ESP32S3
- Test: `recommendBoard({needsCamera: true})` → primary is XIAO ESP32S3
- Test: `recommendBoard({budgetFriendly: true})` → primary is Arduino Uno or ESP32
- Test: `recommendBoard({})` with no requirements → primary is Arduino Uno (simplest/cheapest)

### Reference
- `/Users/apurva/Arduino/CIRCUIT.md` — ESP32 pin assignments for a real project
- `/Users/apurva/Arduino/CIRCUIT-S3.md` — XIAO ESP32S3 pin assignments
- `/Users/apurva/Arduino/PRODUCT.md` — BOM and hardware specs

---

## Story 2: Hardware Knowledge Base — Component Catalog

**As a** developer using Agent AKI,
**I want** the agent to know common Arduino components (sensors, displays, actuators),
**So that** it can suggest the right parts for my project.

### Acceptance Criteria
1. Create `arduino-ide-extension/src/node/agent/knowledge/data/components.json` with entries for these 15 components:
   - **SSD1306 OLED 128x64**: I2C, address 0x3C, 3.3V-5V, 20mA, needs SDA/SCL/VCC/GND, libraries: `Adafruit SSD1306`, `Adafruit GFX Library`
   - **MAX98357A I2S Amp**: I2S output, 3.3V-5V (5V recommended), 40mA, needs BCLK/LRC/DIN/VIN/GND
   - **INMP441 I2S Mic**: I2S input, 3.3V, 1.4mA, needs SCK/WS/SD/L_R/VDD/GND
   - **TTP223 Touch Sensor**: digital input, 3.3V-5V, 8mA, needs SIG/VCC/GND
   - **DHT11 Temperature/Humidity**: single-wire, 3.3V-5V, 2.5mA, needs DATA/VCC/GND, library: `DHT sensor library`
   - **DHT22 Temperature/Humidity**: single-wire, 3.3V-5V, 2.5mA, needs DATA/VCC/GND, library: `DHT sensor library`
   - **HC-SR04 Ultrasonic**: digital, 5V only, 15mA, needs TRIG/ECHO/VCC/GND, library: `NewPing`
   - **SG90 Servo Motor**: PWM, 5V, 200mA (stall 700mA), needs SIGNAL/VCC/GND, library: `Servo`
   - **LCD 16x2 I2C**: I2C, address 0x27, 5V, 80mA, needs SDA/SCL/VCC/GND, library: `LiquidCrystal_I2C`
   - **LED**: digital output, 2V forward, 20mA, needs ANODE/CATHODE (+ 220ohm resistor)
   - **Push Button**: digital input (with pull-up), 3.3V-5V, 0mA, needs SIG/GND
   - **Potentiometer 10K**: analog input, 3.3V-5V, 0.3mA, needs WIPER/VCC/GND
   - **Passive Buzzer**: PWM, 3.3V-5V, 30mA, needs SIG/GND
   - **WS2812B NeoPixel Strip**: single-wire, 5V, 60mA per LED, needs DIN/VCC/GND, library: `Adafruit NeoPixel`
   - **Relay Module (5V)**: digital output, 5V coil, 70mA, needs SIG/VCC/GND
2. Create `arduino-ide-extension/src/node/agent/knowledge/components.ts`:
   - `interface ComponentSpec` with fields: `id`, `name`, `bus` (i2c/i2s/spi/digital/analog/pwm/single_wire), `busDirection` (input/output/bidirectional), `voltage`, `currentDrawMa`, `pinsNeeded` (list of pin role names), `defaultAddress` (for I2C), `libraries` (list of Arduino library names), `notes`
   - `function loadComponents(): ComponentSpec[]`
   - `function getComponent(id: string): ComponentSpec | undefined`
   - `function searchComponents(query: string): ComponentSpec[]` — fuzzy search by name/bus/keyword
   - `function listComponents(): { id: string; name: string; bus: string }[]`
   - `function recommendComponents(functionalNeeds: string[]): ComponentSpec[]` — maps functional requirements to best components:
     - `"temperature"` → DHT11 (beginner-friendly) or DHT22 (more accurate)
     - `"humidity"` → DHT11 or DHT22
     - `"distance"` / `"motion"` / `"proximity"` → HC-SR04 ultrasonic
     - `"display"` / `"screen"` → SSD1306 OLED (small, cheap, I2C)
     - `"text display"` / `"large display"` → LCD 16x2
     - `"sound"` / `"alarm"` / `"buzzer"` → passive buzzer
     - `"light"` / `"indicator"` → LED
     - `"button"` / `"input"` / `"switch"` → push button
     - `"touch"` → TTP223
     - `"servo"` / `"motor"` / `"actuator"` → SG90 servo
     - `"audio"` / `"speaker"` → MAX98357A + speaker
     - `"microphone"` / `"voice"` → INMP441
     - `"led strip"` / `"neopixel"` / `"rgb"` → WS2812B NeoPixel
     - `"relay"` / `"switch high power"` → relay module
     - `"dial"` / `"knob"` / `"potentiometer"` → potentiometer
     - Returns the most beginner-friendly option for each need

### Test
- Create `arduino-ide-extension/src/node/agent/knowledge/__tests__/components.test.ts`
- Test: `loadComponents()` returns 15 components
- Test: `getComponent('ssd1306_oled')` returns correct I2C address
- Test: `searchComponents('temperature')` returns DHT11 and DHT22
- Test: `searchComponents('display')` returns SSD1306 and LCD 16x2
- Test: all components have valid `bus` field (one of: i2c, i2s, spi, digital, analog, pwm, single_wire)
- Test: `recommendComponents(['temperature', 'display'])` returns exactly 2 components (one temp sensor, one display)
- Test: `recommendComponents(['sound'])` returns passive buzzer
- Test: `recommendComponents(['motion'])` returns HC-SR04

---

## Story 3: Pin Validation Engine

**As a** developer using Agent AKI,
**I want** the agent to detect wiring mistakes before I build,
**So that** I don't fry my board or waste time debugging wrong connections.

### Acceptance Criteria
1. Create `arduino-ide-extension/src/node/agent/knowledge/pins.ts`:

   **`assignPins(boardId: string, componentIds: string[]): PinAssignment[]`**
   - Auto-assigns board pins to each component's needs
   - Respects bus requirements (I2C components share SDA/SCL, I2S components get separate ports)
   - Avoids strapping pins (warns if used)
   - Avoids input-only pins for outputs
   - Returns array of `{ component, componentPin, boardPin, notes }`

   **`validatePins(boardId: string, assignments: PinAssignment[]): ValidationIssue[]`**
   - Check: two components assigned to the same GPIO → error
   - Check: output on an input-only pin → error
   - Check: component on a strapping pin → warning
   - Check: I2C address collision (two I2C devices with same address) → error
   - Check: 5V component on a 3.3V-only board without level shifter → warning
   - Returns array of `{ severity: 'error' | 'warning', component, message }`

   **`checkPowerBudget(boardId: string, componentIds: string[]): PowerReport`**
   - Sum current draws of all components
   - Compare against board's max 3.3V rail capacity
   - Return `{ totalCurrentMa, maxCurrentMa, overBudget: boolean, margin: number }`

2. Create `arduino-ide-extension/src/node/agent/knowledge/types.ts`:
   - `interface PinAssignment { component: string; componentPin: string; boardPin: string; notes: string }`
   - `interface ValidationIssue { severity: 'error' | 'warning'; component: string; message: string }`
   - `interface PowerReport { totalCurrentMa: number; maxCurrentMa: number; overBudget: boolean; marginMa: number }`
   - `interface DesignSpec { boardId: string; components: string[]; pinAssignments: PinAssignment[]; libraries: string[]; powerReport: PowerReport; validationIssues: ValidationIssue[] }`
   - `interface WiringStep { stepNumber: number; component: string; fromPoint: string; toPoint: string; wireColor: string; notes: string }`
   - `interface WiringInstructions { steps: WiringStep[]; powerRails: string[]; busSummary: string[] }`

### Test
- Create `arduino-ide-extension/src/node/agent/knowledge/__tests__/pins.test.ts`
- Test: `assignPins('esp32_wroom_32', ['ssd1306_oled', 'dht11'])` returns valid assignments — SSD1306 gets GPIO 21/22 (I2C), DHT11 gets a free GPIO
- Test: duplicate GPIO assignment → error
- Test: LED output on ESP32 GPIO 34 (input-only) → error
- Test: component on GPIO 12 (strapping pin) → warning
- Test: HC-SR04 (5V only) on ESP32 (3.3V) → voltage mismatch warning
- Test: power budget with 10 LEDs (200mA) + SSD1306 (20mA) on Uno → not over budget
- Test: I2C address collision (two SSD1306 at 0x3C) → error

---

## Story 4: Agent Tool — suggest_design (The Brain)

**As a** developer using Agent AKI,
**I want** to give a single prompt like "build me a motion-activated alarm" and have the agent figure out everything — board, components, circuit, pins,
**So that** I don't need to know anything about hardware to get started.

### Core Principle
The user gives ONE prompt. The agent decides everything. If the user specifies constraints ("use ESP32", "I have a DHT22"), respect them. Otherwise, pick the best option.

### Acceptance Criteria
1. Create `arduino-ide-extension/src/node/agent/tools/design-tool.ts`
2. Implement a new `AgentTool` named `suggest_design`:
   - **Parameters**:
     - `description` (string, required) — what the user wants to build, e.g., "motion-activated alarm"
     - `board` (string, optional) — if user specified a board, use it; otherwise auto-select
     - `constraints` (string, optional) — any user-specified components, e.g., "I already have a DHT22"
   - **Behavior**:
     1. **Analyze the prompt** to determine what capabilities are needed (sensing, display, communication, actuation, etc.)
     2. **Select the best board** if not specified:
        - Needs WiFi/Bluetooth? → ESP32 or XIAO ESP32S3
        - Needs camera? → XIAO ESP32S3 (built-in camera)
        - Needs lots of pins? → ESP32
        - Simple project (LED, button, sensor)? → Arduino Uno (cheapest, beginner-friendly)
        - Needs SD card storage? → XIAO ESP32S3
        - If unclear, return top 2 board options with pros/cons for each
     3. **Select components** from the catalog that fulfill the project needs
        - Match by functionality, not just keywords
        - If user mentioned specific components in constraints, include those
        - Pick the most common/beginner-friendly option when multiple choices exist
     4. **Auto-assign pins** using `assignPins()` — avoid conflicts, respect bus requirements
     5. **Validate** using `validatePins()` — if errors, try reassigning
     6. **Calculate power budget** using `checkPowerBudget()`
     7. **Collect required libraries**
   - **Returns**: JSON string of `DesignSpec` with:
     - `boardId`, `boardName`, `boardFqbn`
     - `components` with rationale for each choice
     - `pinAssignments`
     - `libraries`
     - `powerReport`
     - `validationIssues`
     - `alternativeBoards` (if board was auto-selected, list 1-2 alternatives with trade-offs)
     - `summary` — human-readable 2-3 sentence summary of the design
3. Register this tool in `agent-tools.ts` (add to `registerBuiltins()`)

### Board Selection Logic (in `knowledge/boards.ts`)
Add a new function:
```typescript
function recommendBoard(requirements: {
  needsWifi?: boolean;
  needsBluetooth?: boolean;
  needsCamera?: boolean;
  needsSdCard?: boolean;
  minGpioPins?: number;
  needs5vLogic?: boolean;
  needsAnalogPins?: number;
  budgetFriendly?: boolean;
}): { primary: BoardSpec; alternatives: BoardSpec[] }
```

### Component Selection Logic (in `knowledge/components.ts`)
Add a new function:
```typescript
function recommendComponents(needs: string[]): ComponentSpec[]
// Maps functional needs to components:
// "temperature" → DHT11 (beginner) or DHT22 (more accurate)
// "display" → SSD1306 OLED (small, cheap) or LCD 16x2 (larger text)
// "motion" → HC-SR04 (ultrasonic) or PIR sensor
// "sound"/"alarm" → passive buzzer
// "light" → LED + resistor
// "button"/"input" → push button
// etc.
```

### Test
- Create `arduino-ide-extension/src/node/agent/tools/__tests__/design-tool.test.ts`
- Test: `suggest_design({description: "temperature sensor with LCD display"})` → picks a board, includes DHT11/22 + LCD, valid pin assignments, no errors
- Test: `suggest_design({description: "blink an LED"})` → picks Arduino Uno (simplest), includes LED
- Test: `suggest_design({description: "WiFi weather station"})` → picks ESP32 (needs WiFi), includes DHT + display
- Test: `suggest_design({description: "motion alarm", board: "arduino_uno"})` → uses Uno (user specified), includes HC-SR04 + buzzer
- Test: `suggest_design({description: "camera doorbell"})` → picks XIAO ESP32S3 (needs camera)
- Test: `suggest_design({description: "temperature sensor", constraints: "I already have a DHT22"})` → uses DHT22 specifically
- Test: returned DesignSpec has no validation errors
- Test: returned DesignSpec has `alternativeBoards` when board was auto-selected
- Test: returned DesignSpec has `summary` field

### Reference Pattern
- Follow the same `AgentTool` interface pattern in `agent-tools.ts` (see `makeCompileTool()` etc.)
- Import `assignPins`, `validatePins`, `checkPowerBudget` from `../knowledge/pins`
- Import `searchComponents`, `getComponent`, `recommendComponents` from `../knowledge/components`
- Import `getBoard`, `recommendBoard` from `../knowledge/boards`

---

## Story 5: Agent Tool — validate_design

**As a** developer using Agent AKI,
**I want** the agent to check my circuit design for errors before I build it,
**So that** I catch pin conflicts, power issues, and wiring mistakes early.

### Acceptance Criteria
1. Create `arduino-ide-extension/src/node/agent/tools/validate-tool.ts`
2. Implement a new `AgentTool` named `validate_design`:
   - **Parameters**: `design` (string, required — JSON string of a `DesignSpec`)
   - **Behavior**:
     1. Parse the DesignSpec JSON
     2. Run `validatePins()` on the pin assignments
     3. Run `checkPowerBudget()` on the components
     4. Format results as human-readable text with clear pass/fail indicators
   - **Returns**: Formatted validation report with: errors (blocking), warnings (advisory), power budget status
3. Register this tool in `agent-tools.ts`

### Test
- Test: valid design with no conflicts → "All checks passed"
- Test: design with pin conflict → report contains error with details
- Test: design with power budget exceeded → report contains warning
- Test: invalid JSON input → graceful error message

---

## Story 6: Agent Tool — generate_wiring

**As a** developer using Agent AKI,
**I want** step-by-step wiring instructions for my design,
**So that** I can physically build it on a breadboard without mistakes.

### Acceptance Criteria
1. Create `arduino-ide-extension/src/node/agent/tools/wiring-tool.ts`
2. Implement a new `AgentTool` named `generate_wiring`:
   - **Parameters**: `design` (string, required — JSON string of a `DesignSpec`)
   - **Behavior**:
     1. Parse the DesignSpec
     2. Generate power rail instructions first (3.3V, 5V, GND)
     3. Generate component-by-component wiring steps
     4. Include wire color suggestions (red=5V, orange=3.3V, black=GND, others=signal)
     5. Add bus summary (which components share I2C, I2S, etc.)
     6. Format as numbered steps matching the style of `/Users/apurva/Arduino/CIRCUIT.md`
   - **Returns**: Formatted wiring instructions text

### Output Format (match this style from the existing CIRCUIT.md):
```
## Power Rails
1. Board 3V3 → 3.3V rail (orange wire)
2. Board GND → GND rail (black wire)
3. Board 5V/VIN → 5V rail (red wire)

## SSD1306 OLED (4 wires)
4. VCC → 3.3V rail
5. GND → GND rail
6. SDA → GPIO 21
7. SCL → GPIO 22

## Bus Summary
| Bus  | Components     | Pins      |
|------|---------------|-----------|
| I2C  | SSD1306 OLED  | SDA=21, SCL=22 |
```

3. Register this tool in `agent-tools.ts`

### Test
- Test: generate wiring for SSD1306 + DHT11 on ESP32 → output contains "SSD1306 OLED" section, "DHT11" section, power rails
- Test: output includes wire color suggestions
- Test: output includes bus summary table

---

## Story 7: Agent Tool — capture_photo (Camera Verification)

**As a** developer using Agent AKI,
**I want** the agent to capture a photo from my webcam,
**So that** it can visually verify my breadboard wiring.

### Acceptance Criteria
1. Create `arduino-ide-extension/src/node/agent/tools/camera-tool.ts`
2. Implement a new `AgentTool` named `capture_photo`:
   - **Parameters**: `camera_index` (number, optional, default 0)
   - **Behavior**:
     1. On macOS: use `imagesnap` CLI (`brew install imagesnap`) to capture a JPEG from the webcam
        - Command: `imagesnap -w 1 /tmp/agent-aki-capture.jpg`
        - Fallback: try `ffmpeg -f avfoundation -i "0" -frames:v 1 /tmp/agent-aki-capture.jpg`
     2. Read the captured JPEG file
     3. Base64-encode it
     4. Return the base64 string + image dimensions
   - **Returns**: JSON with `{ image_base64: string, width: number, height: number, path: string }`
3. Register this tool in `agent-tools.ts`

### Test
- Test: if `imagesnap` is not installed, returns a clear error message with install instructions
- Test: returned JSON has correct structure (image_base64, width, height, path)
- Note: actual camera capture can only be tested manually. Unit test should mock the subprocess.

---

## Story 8: Agent Tool — verify_wiring (Vision Verification)

**As a** developer using Agent AKI,
**I want** the agent to look at my breadboard photo and tell me if my wiring matches the design,
**So that** I catch wiring mistakes before powering on.

### Acceptance Criteria
1. Create `arduino-ide-extension/src/node/agent/tools/verify-tool.ts`
2. Implement a new `AgentTool` named `verify_wiring`:
   - **Parameters**:
     - `image_base64` (string, required — base64 JPEG from `capture_photo`)
     - `design` (string, required — JSON string of the DesignSpec or wiring instructions text)
   - **Behavior**:
     1. Build a prompt for Claude Vision API:
        ```
        You are verifying a breadboard wiring job.

        Expected wiring:
        {design/wiring instructions}

        Analyze this photo and report:
        1. Which components can you identify on the breadboard?
        2. For each expected wire, can you confirm it's connected correctly?
        3. Are there any unexpected or incorrect connections?
        4. Any obvious issues (wrong row, missing ground, loose wires)?

        Return JSON:
        {"verified": ["list of confirmed connections"], "missing": ["list of missing connections"], "issues": ["list of problems"], "confidence": 0.0-1.0}
        ```
     2. Call Claude API (using `claude -p` with the image piped in, or using the `@anthropic-ai/sdk` npm package directly with `ANTHROPIC_API_KEY` env var)
     3. Parse the JSON response
   - **Returns**: Formatted verification report
3. Register this tool in `agent-tools.ts`

### Implementation Note
- Prefer using the Anthropic SDK (`@anthropic-ai/sdk`) for vision since `claude -p` may not support image input easily
- Add `@anthropic-ai/sdk` to `arduino-ide-extension/package.json` dependencies
- The API key should come from environment variable `ANTHROPIC_API_KEY`
- If no API key is set, fall back to a message: "Set ANTHROPIC_API_KEY to enable camera verification"

### Test
- Test: missing API key → clear error message
- Test: mock API response with verification JSON → parsed correctly into structured output
- Test: invalid image_base64 → graceful error

---

## Story 9: Update System Prompt for Fully Autonomous Hardware Agent

**As a** developer using Agent AKI,
**I want** to give a single prompt and have the agent autonomously handle the entire flow — from choosing hardware to verified working code,
**So that** I only need to do the physical wiring and nothing else.

### Core Principle
The user says: "I want to build X." The agent takes over completely. The ONLY thing the user does physically is:
1. Buy/gather the components the agent tells them to
2. Wire the breadboard following the agent's instructions
3. Plug in the USB cable when the agent asks

Everything else — board selection, component selection, circuit design, code generation, compilation, upload, testing — is done by the agent autonomously.

### Acceptance Criteria
1. Update `buildSystemPrompt()` in `arduino-ide-extension/src/node/agent/agent-service-impl.ts`
2. Replace the system prompt with this philosophy:

```
You are Agent AKI — an AI that builds complete Arduino/ESP32 hardware projects autonomously.

## How You Work
The user describes what they want to build. You handle EVERYTHING:
- Choosing the right board (if they didn't specify one)
- Selecting the right components
- Designing the circuit with correct pin assignments
- Validating the design for errors
- Generating step-by-step wiring instructions
- Writing the complete Arduino code
- Compiling the code
- Uploading to the board
- Verifying it works via serial output
- Optionally verifying wiring via camera

The user's ONLY job is physical: gathering components, wiring the breadboard, and plugging in USB.

## Your Autonomous Workflow
When the user describes a project (e.g., "build me a motion-activated alarm"):

**Phase 1: Design (you do this immediately, no user input needed)**
1. Call suggest_design with their description → get board, components, pins, libraries
2. Call validate_design → ensure no errors
3. Present the design: what board to use (and why), what components to buy, estimated cost

**Phase 2: Wiring (guide the user step by step)**
4. Call generate_wiring → get step-by-step breadboard instructions
5. Walk the user through wiring ONE component at a time
6. After each component, ask "Done? Ready for the next one?"
7. When all wired, offer to verify with camera: call capture_photo + verify_wiring

**Phase 3: Code (fully autonomous)**
8. Write the complete Arduino sketch using write_file — include ALL code, not just a skeleton
9. Compile using compile — if errors, fix them yourself and recompile (loop until it works)
10. Never ask the user to fix code — that's YOUR job

**Phase 4: Deploy & Test**
11. Ask user to connect board via USB
12. Upload using upload
13. Read serial output using read_serial to verify it works
14. If something's wrong, diagnose and fix — write new code, recompile, re-upload

## Rules
- NEVER ask the user to write code — you write ALL the code
- NEVER ask the user to pick a board or component — you pick (unless they specified one)
- NEVER give partial code — always write complete, compilable sketches
- If you're unsure between options, pick the most beginner-friendly one and explain why
- If compilation fails, fix the error yourself — don't ask the user
- Always explain your choices briefly ("I chose ESP32 because your project needs WiFi")
- When presenting wiring, be specific: "Connect the red wire from the DHT22 VCC pin to the 3.3V rail"
```

3. Keep the existing context sections (board, port, sketch code, build output, serial buffer) below the new prompt
4. Increase `MAX_ITERATIONS` from 12 to 20 in `agent-service-impl.ts` — the autonomous workflow needs more turns (design + validate + wiring + write code + compile + fix + upload + test)

### Test
- Test: `buildSystemPrompt()` output contains "Agent AKI"
- Test: `buildSystemPrompt()` output contains "suggest_design"
- Test: `buildSystemPrompt()` output contains "NEVER ask the user to write code"
- Test: `buildSystemPrompt()` output contains "Phase 1: Design"
- Test: `MAX_ITERATIONS` is 20
- Test: existing context sections (board, port, sketch, serial) still present

### Also Update: Welcome Screen Examples
In `agent-panel-widget.tsx`, update the `EXAMPLE_PROMPTS` array to reflect the "one prompt" philosophy:
```typescript
const EXAMPLE_PROMPTS = [
  'Build me a temperature and humidity monitor with a display',
  'I want a motion-activated alarm system',
  'Create a WiFi weather station that logs to serial',
  'Build a servo-controlled door lock with a button',
  'I want to control NeoPixel LEDs with a potentiometer',
];
```
These should be full project descriptions, not low-level tasks like "blink an LED."

---

## Story 10: Open Source Prep — README, License, Contributing

**As a** potential contributor or user,
**I want** clear documentation on what Agent AKI is, how to install it, and how to contribute,
**So that** I can get started quickly.

### Acceptance Criteria
1. Update `README.md` with:
   - **Hero line**: "Agent AKI — An AI-powered Arduino IDE that takes you from a prompt to verified, working hardware."
   - **What it does**: The 8-step pipeline (design → validate → wire → code → compile → verify → test)
   - **Screenshot/GIF placeholder**: `![Demo](docs/demo.gif)`
   - **Quick Start**:
     ```bash
     git clone https://github.com/jainapurva/ArduinoIDE_agent.git
     cd ArduinoIDE_agent
     yarn install
     yarn build
     yarn start
     ```
   - **Prerequisites**: Node.js 18+, Yarn, Python 3.x (for node-gyp), Git, `imagesnap` (macOS, optional for camera)
   - **Features list** with the 12 tools
   - **Supported boards**: ESP32-WROOM-32, XIAO ESP32S3 Sense, Arduino Uno
   - **Comparison table** vs ArduinoVision, Embedr, Cirkit Designer
   - **Architecture diagram** (text-based)
   - **Contributing** link
   - **License**: AGPLv3
   - **Roadmap** section (post-launch features)

2. Verify or create `LICENSE` (should already be AGPLv3 from Arduino IDE fork)

3. Create `CONTRIBUTING.md`:
   - How to set up the dev environment
   - How to add a new board to `boards.json`
   - How to add a new component to `components.json`
   - How to add a new agent tool
   - Code style (follows existing Arduino IDE conventions)
   - PR process

4. Create `.github/ISSUE_TEMPLATE/bug_report.md`:
   - Template with: description, steps to reproduce, expected behavior, OS/board info

5. Create `.github/ISSUE_TEMPLATE/feature_request.md`:
   - Template with: description, use case, proposed solution

6. Create `.github/PULL_REQUEST_TEMPLATE.md`:
   - Template with: what changed, why, how to test

### Test
- All markdown files render correctly (no broken links)
- README quick start instructions are accurate

---

## Story 11: GitHub Actions CI

**As a** contributor,
**I want** CI to catch build errors on every push,
**So that** the main branch always compiles.

### Acceptance Criteria
1. Create `.github/workflows/ci.yml`:
   ```yaml
   name: CI
   on: [push, pull_request]
   jobs:
     build:
       runs-on: ubuntu-latest
       steps:
         - uses: actions/checkout@v4
         - uses: actions/setup-node@v4
           with:
             node-version: 18
         - run: yarn install --frozen-lockfile
         - run: yarn build
         - run: yarn test
   ```
2. Ensure `yarn test` script exists in root `package.json` (or add it)
3. The workflow should run on push to `feat/agentic-core` and `main`, and on PRs

### Test
- Workflow YAML is valid
- `yarn test` runs without crashing (even if no tests exist yet, it should exit 0)

---

## Story 12: Seed Good First Issues

**As an** open-source maintainer,
**I want** labeled issues ready for contributors,
**So that** people can start contributing immediately on launch day.

### Acceptance Criteria
Create a file `GOOD_FIRST_ISSUES.md` listing 15 issues to create on GitHub. Each issue should have:
- Title
- Description (2-3 sentences)
- Label: `good first issue`
- Difficulty: easy/medium

**Issue ideas:**
1. Add BME280 temperature/pressure sensor to components.json (easy)
2. Add MPU6050 IMU/accelerometer to components.json (easy)
3. Add HC-05 Bluetooth module to components.json (easy)
4. Add Arduino Mega board to boards.json (easy)
5. Add Arduino Nano board to boards.json (easy)
6. Add Raspberry Pi Pico board to boards.json (medium)
7. Add stepper motor (28BYJ-48) to components.json (easy)
8. Add IR receiver (VS1838B) to components.json (easy)
9. Add GPS module (NEO-6M) to components.json (easy)
10. Add RFID reader (RC522) to components.json (easy)
11. Improve error messages when arduino-cli is not found (medium)
12. Add syntax highlighting for code blocks in agent chat panel (medium)
13. Add copy button for wiring instructions in agent panel (medium)
14. Add "Export Design" button to save DesignSpec as JSON file (medium)
15. Add dark/light theme toggle for agent panel (medium)

### Test
- File exists with 15 issues, each with title + description + label

---

## Story 13: Marketing Assets — Social Media Posts

**As the** project maintainer,
**I want** pre-written launch posts for LinkedIn, X, Reddit, and Hacker News,
**So that** I can execute launch day without writing under pressure.

### Acceptance Criteria
Create `docs/launch/social-posts.md` with:

1. **LinkedIn Teasers** (3 posts for Mon/Tue/Wed before launch):
   - Teaser 1: "The problem" — every Arduino project starts with wrong wiring diagrams
   - Teaser 2: "The magic moment" — one prompt → design → verify with camera
   - Teaser 3: "48 hours" — countdown with feature list

2. **LinkedIn Launch Post**: Full announcement with demo video placeholder, GitHub link, feature list, personal story, hashtags (#OpenSource #Arduino #AI #ESP32 #BuildInPublic)

3. **X/Twitter Launch Thread** (7-8 tweets):
   - Hook: "I just open-sourced an AI agent that helps you build Arduino hardware..."
   - Pipeline: the 8 steps
   - Camera verification: the wow moment
   - MCP integration: works with Claude Code, Cursor
   - Comparison: vs ArduinoVision, Embedr
   - Origin story: built while working on pet robot
   - Links + CTA

4. **Reddit Posts** (tailored per subreddit):
   - r/arduino: focus on hardware verification
   - r/esp32: focus on ESP32/XIAO support
   - r/programming: focus on agentic AI + MCP architecture

5. **Hacker News**: "Show HN" title + author comment

6. **Product Hunt**: tagline, description, first comment

### Test
- File exists with all sections
- No placeholder text left (all posts are ready to copy-paste)

---

## Execution Order

Stories should be executed in this order (dependencies shown):

```
Story 0: Build Verification ← FIRST (everything depends on this)
  ↓
Story 1: Board Definitions
Story 2: Component Catalog    ← can run in parallel with Story 1
  ↓
Story 3: Pin Validation Engine ← depends on Stories 1 + 2
  ↓
Story 4: suggest_design tool   ← depends on Story 3
Story 5: validate_design tool  ← depends on Story 3
Story 6: generate_wiring tool  ← depends on Story 3
  ↓ (Stories 4-6 can run in parallel)
Story 7: capture_photo tool    ← independent, can run anytime after Story 0
Story 8: verify_wiring tool    ← depends on Story 7
  ↓
Story 9: Update System Prompt  ← depends on Stories 4-8 (all tools exist)
  ↓
Story 10: Open Source Prep     ← independent, can run anytime
Story 11: CI                   ← independent, can run anytime after Story 0
Story 12: Good First Issues    ← independent
Story 13: Marketing Assets     ← independent
```

**Parallel execution strategy for Claude sessions:**
- Session 1: Stories 0 → 1 → 3 → 4 → 5 → 6 → 9
- Session 2: Story 2 (parallel with Session 1's Story 1)
- Session 3: Stories 7 → 8 (independent camera tools)
- Session 4: Stories 10 → 11 → 12 → 13 (docs + marketing, independent)
