import * as assert from 'assert';

import { loadBoards, getBoard, listBoards, recommendBoard, clearCache } from '../boards';

describe('Board Knowledge Base', () => {
  beforeEach(() => clearCache());

  it('loadBoards() returns 3 boards', () => {
    const boards = loadBoards();
    assert.strictEqual(boards.length, 3);
  });

  it('getBoard returns correct FQBN for ESP32', () => {
    const board = getBoard('esp32_wroom_32');
    assert.ok(board);
    assert.strictEqual(board.fqbn, 'esp32:esp32:esp32');
  });

  it('getBoard returns correct FQBN for Uno', () => {
    const board = getBoard('arduino_uno');
    assert.ok(board);
    assert.strictEqual(board.fqbn, 'arduino:avr:uno');
  });

  it('ESP32 GPIO 34-39 are input_only', () => {
    const board = getBoard('esp32_wroom_32')!;
    for (const pin of ['GPIO34', 'GPIO35', 'GPIO36', 'GPIO39']) {
      assert.strictEqual(board.pins[pin]?.type, 'input_only', `${pin} should be input_only`);
    }
  });

  it('ESP32 strapping pins are correct', () => {
    const board = getBoard('esp32_wroom_32')!;
    assert.deepStrictEqual(board.strappingPins, ['GPIO0', 'GPIO2', 'GPIO12', 'GPIO15']);
  });

  it('Arduino Uno has 5V logic, ESP32 has 3.3V', () => {
    const uno = getBoard('arduino_uno')!;
    const esp = getBoard('esp32_wroom_32')!;
    assert.strictEqual(uno.voltage, 5.0);
    assert.strictEqual(esp.voltage, 3.3);
  });

  it('listBoards returns id, name, fqbn', () => {
    const list = listBoards();
    assert.strictEqual(list.length, 3);
    assert.ok(list[0].id);
    assert.ok(list[0].name);
    assert.ok(list[0].fqbn);
  });

  it('recommendBoard with needsWifi picks ESP32 or XIAO', () => {
    const rec = recommendBoard({ needsWifi: true });
    assert.ok(['esp32_wroom_32', 'xiao_esp32s3_sense'].includes(rec.primary.id));
    assert.ok(rec.reasoning.length > 0);
  });

  it('recommendBoard with needsCamera picks XIAO ESP32S3', () => {
    const rec = recommendBoard({ needsCamera: true });
    assert.strictEqual(rec.primary.id, 'xiao_esp32s3_sense');
  });

  it('recommendBoard with no requirements picks beginner-friendly board', () => {
    const rec = recommendBoard({});
    // Arduino Uno is beginner-friendly and cheapest
    assert.ok(rec.primary);
    assert.ok(rec.alternatives.length > 0);
  });
});
