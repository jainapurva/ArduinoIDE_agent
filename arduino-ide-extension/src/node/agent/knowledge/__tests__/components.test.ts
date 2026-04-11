import * as assert from 'assert';
import { loadComponents, getComponent, searchComponents, recommendComponents, clearCache } from '../components';

describe('Component Knowledge Base', () => {
  beforeEach(() => clearCache());

  it('loadComponents() returns 15 components', () => {
    const components = loadComponents();
    assert.strictEqual(components.length, 15);
  });

  it('getComponent returns correct I2C address for SSD1306', () => {
    const comp = getComponent('ssd1306_oled');
    assert.ok(comp);
    assert.strictEqual(comp.defaultAddress, '0x3C');
    assert.strictEqual(comp.bus, 'i2c');
  });

  it('searchComponents("temperature") returns DHT11 and DHT22', () => {
    const results = searchComponents('temperature');
    const ids = results.map((c) => c.id);
    assert.ok(ids.includes('dht11'), 'should include DHT11');
    assert.ok(ids.includes('dht22'), 'should include DHT22');
  });

  it('searchComponents("display") returns SSD1306 and LCD', () => {
    const results = searchComponents('display');
    const ids = results.map((c) => c.id);
    assert.ok(ids.includes('ssd1306_oled'), 'should include SSD1306');
    assert.ok(ids.includes('lcd_16x2_i2c'), 'should include LCD 16x2');
  });

  it('all components have valid bus field', () => {
    const validBuses = ['i2c', 'i2s', 'spi', 'digital', 'analog', 'pwm', 'single_wire'];
    for (const comp of loadComponents()) {
      assert.ok(validBuses.includes(comp.bus), `${comp.id} has invalid bus: ${comp.bus}`);
    }
  });

  it('recommendComponents(["temperature", "display"]) returns 2 components', () => {
    const result = recommendComponents(['temperature', 'display']);
    assert.strictEqual(result.length, 2);
  });

  it('recommendComponents(["sound"]) returns passive buzzer', () => {
    const result = recommendComponents(['sound']);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].id, 'passive_buzzer');
  });

  it('recommendComponents(["motion"]) returns HC-SR04', () => {
    const result = recommendComponents(['motion']);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].id, 'hcsr04');
  });
});
