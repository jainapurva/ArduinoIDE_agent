import { getBoard } from './boards';
import { getComponent } from './components';
import { PinAssignment, ValidationIssue, PowerReport } from './types';

export function assignPins(boardId: string, componentIds: string[]): PinAssignment[] {
  const board = getBoard(boardId);
  if (!board) throw new Error(`Unknown board: ${boardId}`);

  const assignments: PinAssignment[] = [];
  const usedPins = new Set<string>();
  const boardPins = Object.entries(board.pins);

  // Find I2C SDA/SCL pins
  const i2cSda = boardPins.find(([, p]) => p.buses.includes('i2c_sda'));
  const i2cScl = boardPins.find(([, p]) => p.buses.includes('i2c_scl'));

  // Find I2S pins
  const i2sSck = boardPins.find(([, p]) => p.buses.includes('i2s0_sck') || p.buses.includes('i2s_sck'));
  const i2sWs = boardPins.find(([, p]) => p.buses.includes('i2s0_ws') || p.buses.includes('i2s_ws'));
  const i2sSd = boardPins.find(([, p]) => p.buses.includes('i2s0_sd') || p.buses.includes('i2s_sd'));

  const i2s1Sck = boardPins.find(([, p]) => p.buses.includes('i2s1_sck'));
  const i2s1Ws = boardPins.find(([, p]) => p.buses.includes('i2s1_ws'));
  const i2s1Sd = boardPins.find(([, p]) => p.buses.includes('i2s1_sd'));

  let i2sOutputUsed = false;
  let i2sInputUsed = false;

  for (const compId of componentIds) {
    const comp = getComponent(compId);
    if (!comp) continue;

    if (comp.bus === 'i2c') {
      // All I2C devices share the same SDA/SCL
      if (i2cSda && i2cScl) {
        assignments.push({ component: compId, componentPin: 'SDA', boardPin: i2cSda[0], notes: 'I2C shared bus' });
        assignments.push({ component: compId, componentPin: 'SCL', boardPin: i2cScl[0], notes: 'I2C shared bus' });
        usedPins.add(i2cSda[0]);
        usedPins.add(i2cScl[0]);
      }
      // Power pins
      assignments.push({ component: compId, componentPin: 'VCC', boardPin: '3.3V', notes: '' });
      assignments.push({ component: compId, componentPin: 'GND', boardPin: 'GND', notes: '' });
    } else if (comp.bus === 'i2s') {
      // I2S — assign to available port
      if (comp.busDirection === 'output' && !i2sOutputUsed) {
        // Prefer I2S1 for output (ESP32 pattern)
        const sck = i2s1Sck || i2sSck;
        const ws = i2s1Ws || i2sWs;
        const sd = i2s1Sd || i2sSd;
        if (sck && ws && sd) {
          assignments.push({ component: compId, componentPin: 'BCLK', boardPin: sck[0], notes: 'I2S output' });
          assignments.push({ component: compId, componentPin: 'LRC', boardPin: ws[0], notes: 'I2S output' });
          assignments.push({ component: compId, componentPin: 'DIN', boardPin: sd[0], notes: 'I2S output' });
          usedPins.add(sck[0]); usedPins.add(ws[0]); usedPins.add(sd[0]);
          i2sOutputUsed = true;
        }
        assignments.push({ component: compId, componentPin: 'VIN', boardPin: '5V', notes: '5V for full volume' });
        assignments.push({ component: compId, componentPin: 'GND', boardPin: 'GND', notes: '' });
      } else if (comp.busDirection === 'input' && !i2sInputUsed) {
        if (i2sSck && i2sWs && i2sSd) {
          assignments.push({ component: compId, componentPin: 'SCK', boardPin: i2sSck[0], notes: 'I2S input' });
          assignments.push({ component: compId, componentPin: 'WS', boardPin: i2sWs[0], notes: 'I2S input' });
          assignments.push({ component: compId, componentPin: 'SD', boardPin: i2sSd[0], notes: 'I2S input' });
          usedPins.add(i2sSck[0]); usedPins.add(i2sWs[0]); usedPins.add(i2sSd[0]);
          i2sInputUsed = true;
        }
        assignments.push({ component: compId, componentPin: 'VDD', boardPin: '3.3V', notes: '' });
        assignments.push({ component: compId, componentPin: 'GND', boardPin: 'GND', notes: '' });
        if (comp.pinsNeeded.includes('L_R')) {
          assignments.push({ component: compId, componentPin: 'L_R', boardPin: 'GND', notes: 'Left channel select' });
        }
      }
    } else {
      // Digital, analog, PWM, single_wire — assign to free GPIO pins
      for (const pinRole of comp.pinsNeeded) {
        if (pinRole === 'VCC' || pinRole === 'VIN') {
          const rail = comp.voltage.includes('5V') && board.voltage === 5.0 ? '5V' : '3.3V';
          assignments.push({ component: compId, componentPin: pinRole, boardPin: rail, notes: '' });
        } else if (pinRole === 'GND' || pinRole === 'CATHODE') {
          assignments.push({ component: compId, componentPin: pinRole, boardPin: 'GND', notes: '' });
        } else {
          // Find a free GPIO
          const needsOutput = comp.busDirection === 'output';
          const needsPwm = comp.bus === 'pwm';
          const needsAdc = comp.bus === 'analog';

          const freePin = boardPins.find(([pinName, pinSpec]) => {
            if (usedPins.has(pinName)) return false;
            if (pinSpec.type === 'input_only' && needsOutput) return false;
            if (needsPwm && !pinSpec.pwm) return false;
            if (needsAdc && !pinSpec.adc) return false;
            if (board.strappingPins.includes(pinName)) return false;
            // Avoid UART pins
            if (pinSpec.buses.some((b) => b.startsWith('uart'))) return false;
            return true;
          });

          if (freePin) {
            assignments.push({ component: compId, componentPin: pinRole, boardPin: freePin[0], notes: '' });
            usedPins.add(freePin[0]);
          }
        }
      }
    }
  }

  return assignments;
}

export function validatePins(boardId: string, assignments: PinAssignment[]): ValidationIssue[] {
  const board = getBoard(boardId);
  if (!board) return [{ severity: 'error', component: '', message: `Unknown board: ${boardId}` }];

  const issues: ValidationIssue[] = [];
  const pinUsage = new Map<string, string[]>();

  for (const a of assignments) {
    // Skip power/ground pins
    if (['3.3V', '5V', 'GND', 'VIN'].includes(a.boardPin)) continue;

    const users = pinUsage.get(a.boardPin) || [];
    users.push(a.component);
    pinUsage.set(a.boardPin, users);

    const pinSpec = board.pins[a.boardPin];
    if (!pinSpec) continue;

    // Check output on input-only pin
    if (pinSpec.type === 'input_only') {
      const comp = getComponent(a.component);
      if (comp && (comp.busDirection === 'output' || comp.bus === 'pwm')) {
        issues.push({
          severity: 'error',
          component: a.component,
          message: `${a.boardPin} is input-only but ${a.component} needs it as output.`,
        });
      }
    }

    // Check strapping pin usage
    if (board.strappingPins.includes(a.boardPin)) {
      issues.push({
        severity: 'warning',
        component: a.component,
        message: `${a.boardPin} is a strapping pin — may affect boot behavior.`,
      });
    }
  }

  // Check GPIO conflicts (same pin used by multiple components, excluding I2C shared bus)
  for (const [pin, components] of pinUsage.entries()) {
    const unique = [...new Set(components)];
    if (unique.length > 1) {
      // Allow I2C sharing
      const allI2c = unique.every((cId) => {
        const c = getComponent(cId);
        return c?.bus === 'i2c';
      });
      if (!allI2c) {
        issues.push({
          severity: 'error',
          component: unique.join(', '),
          message: `GPIO conflict: ${pin} is used by ${unique.join(' and ')}.`,
        });
      }
    }
  }

  // Check I2C address collisions
  const i2cAddresses = new Map<string, string[]>();
  for (const a of assignments) {
    const comp = getComponent(a.component);
    if (comp?.bus === 'i2c' && comp.defaultAddress) {
      const users = i2cAddresses.get(comp.defaultAddress) || [];
      if (!users.includes(a.component)) {
        users.push(a.component);
      }
      i2cAddresses.set(comp.defaultAddress, users);
    }
  }
  for (const [addr, components] of i2cAddresses.entries()) {
    if (components.length > 1) {
      issues.push({
        severity: 'error',
        component: components.join(', '),
        message: `I2C address collision: ${components.join(' and ')} both use address ${addr}.`,
      });
    }
  }

  // Check voltage mismatches
  for (const a of assignments) {
    const comp = getComponent(a.component);
    if (comp && comp.voltage === '5V' && board.voltage < 5.0) {
      issues.push({
        severity: 'warning',
        component: a.component,
        message: `${comp.name} requires 5V but ${board.name} is ${board.voltage}V logic. May need level shifter.`,
      });
    }
  }

  return issues;
}

export function checkPowerBudget(boardId: string, componentIds: string[]): PowerReport {
  const board = getBoard(boardId);
  if (!board) return { totalCurrentMa: 0, maxCurrentMa: 0, overBudget: false, marginMa: 0 };

  let totalCurrentMa = 0;
  for (const compId of componentIds) {
    const comp = getComponent(compId);
    if (comp) {
      totalCurrentMa += comp.currentDrawMa;
    }
  }

  const maxCurrentMa = board.max3v3CurrentMa;
  return {
    totalCurrentMa,
    maxCurrentMa,
    overBudget: totalCurrentMa > maxCurrentMa,
    marginMa: maxCurrentMa - totalCurrentMa,
  };
}
