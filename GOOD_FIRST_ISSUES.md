# Good First Issues

Create these issues on GitHub after launch. Label each with `good first issue`.

---

### 1. Add BME280 sensor to components.json (easy)
The BME280 is a popular temperature/pressure/humidity sensor. Add it to `components.json` with correct I2C address (0x76), pin requirements, and library (`Adafruit BME280 Library`). Add a test case.

### 2. Add MPU6050 IMU to components.json (easy)
The MPU6050 is a common 6-axis accelerometer/gyroscope. Add it with I2C address 0x68, pin requirements, and library (`Adafruit MPU6050`). Add a test case.

### 3. Add HC-05 Bluetooth module to components.json (easy)
The HC-05 is a classic serial Bluetooth module. Add it with UART bus type, 3.3V-5V voltage, TX/RX/VCC/GND pins, and notes about AT command mode. Add a test case.

### 4. Add Arduino Mega to boards.json (easy)
The Arduino Mega 2560 has 54 digital pins and 16 analog inputs. Add the full pin map, FQBN `arduino:avr:mega`, 5V logic. Add test cases for pin counts and FQBN.

### 5. Add Arduino Nano to boards.json (easy)
The Arduino Nano has the same ATmega328P as the Uno but in a smaller form factor. Add with FQBN `arduino:avr:nano`, same pin layout as Uno but different form factor. Add test cases.

### 6. Add Raspberry Pi Pico to boards.json (medium)
The Pi Pico (RP2040) has 26 GPIO pins, PIO state machines, and 3.3V logic. Add with FQBN `rp2040:rp2040:rpipico`, include ADC pins, I2C, SPI, and PIO capabilities. Add test cases.

### 7. Add stepper motor 28BYJ-48 to components.json (easy)
The 28BYJ-48 is a common unipolar stepper motor that comes with a ULN2003 driver board. Add with 4 signal pins (IN1-IN4), 5V, library `Stepper`. Add a test case.

### 8. Add IR receiver VS1838B to components.json (easy)
The VS1838B is a standard 38kHz IR receiver for remote controls. Add with digital input, 3.3V-5V, library `IRremote`. Add a test case.

### 9. Add GPS module NEO-6M to components.json (easy)
The NEO-6M is a common GPS receiver. Add with UART bus, 3.3V-5V, TX/RX/VCC/GND pins, library `TinyGPS++`. Add a test case.

### 10. Add RFID reader RC522 to components.json (easy)
The MFRC522 is a popular 13.56MHz RFID reader. Add with SPI bus, 3.3V, library `MFRC522`. Add a test case.

### 11. Improve error messages when arduino-cli is not found (medium)
When `arduino-cli` is not installed or not in PATH, the compile/upload tools give cryptic errors. Detect this case and show a helpful message with installation instructions for each platform.

### 12. Add syntax highlighting for code blocks in agent chat (medium)
The agent panel shows code as plain `<pre>` text. Use a lightweight syntax highlighter (like Prism.js or highlight.js) to color Arduino C++ code blocks in agent messages.

### 13. Add copy button for wiring instructions in agent panel (medium)
When the agent shows wiring instructions, add a "Copy" button so users can paste them into a notes app. Use the Clipboard API to copy the formatted text.

### 14. Add "Export Design" button to save DesignSpec as JSON (medium)
After the agent generates a design, let users save the DesignSpec JSON to a file. Add a small button in the agent panel that triggers a file save dialog.

### 15. Add dark/light theme toggle for agent panel (medium)
The agent panel currently uses a fixed dark theme. Make it respect the IDE's theme setting (dark/light) by using CSS variables from Theia's theme system.
