import * as path from 'path';
import * as fs from 'fs';
import { ComponentSpec } from './types';

let cachedComponents: ComponentSpec[] | null = null;

export function loadComponents(): ComponentSpec[] {
  if (cachedComponents) return cachedComponents;
  const dataPath = path.join(__dirname, 'data', 'components.json');
  const raw = fs.readFileSync(dataPath, 'utf-8');
  cachedComponents = JSON.parse(raw) as ComponentSpec[];
  return cachedComponents;
}

export function getComponent(id: string): ComponentSpec | undefined {
  return loadComponents().find((c) => c.id === id);
}

export function listComponents(): Array<{ id: string; name: string; bus: string }> {
  return loadComponents().map((c) => ({ id: c.id, name: c.name, bus: c.bus }));
}

export function searchComponents(query: string): ComponentSpec[] {
  const q = query.toLowerCase();
  return loadComponents().filter((c) => {
    return (
      c.name.toLowerCase().includes(q) ||
      c.bus.toLowerCase().includes(q) ||
      c.keywords.some((k) => k.includes(q)) ||
      (c.notes && c.notes.toLowerCase().includes(q))
    );
  });
}

const NEED_MAP: Record<string, string[]> = {
  temperature: ['dht11'],
  humidity: ['dht11'],
  weather: ['dht11'],
  climate: ['dht11'],
  distance: ['hcsr04'],
  ultrasonic: ['hcsr04'],
  proximity: ['hcsr04'],
  motion: ['hcsr04'],
  range: ['hcsr04'],
  display: ['ssd1306_oled'],
  screen: ['ssd1306_oled'],
  oled: ['ssd1306_oled'],
  'text display': ['lcd_16x2_i2c'],
  'large display': ['lcd_16x2_i2c'],
  lcd: ['lcd_16x2_i2c'],
  sound: ['passive_buzzer'],
  alarm: ['passive_buzzer'],
  buzzer: ['passive_buzzer'],
  beep: ['passive_buzzer'],
  alert: ['passive_buzzer'],
  siren: ['passive_buzzer'],
  light: ['led'],
  indicator: ['led'],
  blink: ['led'],
  led: ['led'],
  button: ['push_button'],
  switch: ['push_button'],
  press: ['push_button'],
  input: ['push_button'],
  trigger: ['push_button'],
  touch: ['ttp223'],
  capacitive: ['ttp223'],
  servo: ['sg90_servo'],
  motor: ['sg90_servo'],
  actuator: ['sg90_servo'],
  lock: ['sg90_servo'],
  arm: ['sg90_servo'],
  audio: ['max98357a'],
  speaker: ['max98357a'],
  music: ['max98357a'],
  microphone: ['inmp441'],
  mic: ['inmp441'],
  voice: ['inmp441'],
  'led strip': ['ws2812b_neopixel'],
  neopixel: ['ws2812b_neopixel'],
  rgb: ['ws2812b_neopixel'],
  rainbow: ['ws2812b_neopixel'],
  relay: ['relay_module'],
  'high power': ['relay_module'],
  lamp: ['relay_module'],
  fan: ['relay_module'],
  dial: ['potentiometer_10k'],
  knob: ['potentiometer_10k'],
  potentiometer: ['potentiometer_10k'],
  volume: ['potentiometer_10k'],
  slider: ['potentiometer_10k'],
};

export function recommendComponents(functionalNeeds: string[]): ComponentSpec[] {
  const componentIds = new Set<string>();
  for (const need of functionalNeeds) {
    const key = need.toLowerCase().trim();
    const match = NEED_MAP[key];
    if (match) {
      match.forEach((id) => componentIds.add(id));
    } else {
      // Fuzzy: try partial match
      for (const [mapKey, ids] of Object.entries(NEED_MAP)) {
        if (mapKey.includes(key) || key.includes(mapKey)) {
          ids.forEach((id) => componentIds.add(id));
          break;
        }
      }
    }
  }
  const components = loadComponents();
  return Array.from(componentIds)
    .map((id) => components.find((c) => c.id === id))
    .filter((c): c is ComponentSpec => c !== undefined);
}

export function clearCache(): void {
  cachedComponents = null;
}
