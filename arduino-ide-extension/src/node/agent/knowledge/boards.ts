import * as path from 'path';
import * as fs from 'fs';
import { BoardSpec, BoardRequirements, BoardRecommendation } from './types';

let cachedBoards: BoardSpec[] | null = null;

export function loadBoards(): BoardSpec[] {
  if (cachedBoards) return cachedBoards;
  const dataPath = path.join(__dirname, 'data', 'boards.json');
  const raw = fs.readFileSync(dataPath, 'utf-8');
  cachedBoards = JSON.parse(raw) as BoardSpec[];
  return cachedBoards;
}

export function getBoard(id: string): BoardSpec | undefined {
  return loadBoards().find((b) => b.id === id);
}

export function listBoards(): Array<{ id: string; name: string; fqbn: string }> {
  return loadBoards().map((b) => ({ id: b.id, name: b.name, fqbn: b.fqbn }));
}

export function recommendBoard(requirements: BoardRequirements): BoardRecommendation {
  const boards = loadBoards();
  const scored: Array<{ board: BoardSpec; score: number; reasons: string[] }> = [];

  for (const board of boards) {
    let score = 0;
    const reasons: string[] = [];

    if (requirements.needsWifi) {
      if (board.features.includes('wifi')) {
        score += 10;
        reasons.push('has WiFi');
      } else {
        score -= 20;
      }
    }
    if (requirements.needsBluetooth) {
      if (board.features.includes('bluetooth')) {
        score += 5;
        reasons.push('has Bluetooth');
      } else {
        score -= 15;
      }
    }
    if (requirements.needsCamera) {
      if (board.features.includes('camera')) {
        score += 15;
        reasons.push('has built-in camera');
      } else {
        score -= 25;
      }
    }
    if (requirements.needsSdCard) {
      if (board.features.includes('sd_card')) {
        score += 5;
        reasons.push('has SD card slot');
      }
    }
    if (requirements.needs5vLogic) {
      if (board.voltage === 5.0) {
        score += 5;
        reasons.push('5V logic');
      } else {
        score -= 5;
      }
    }
    if (requirements.needsAnalogPins) {
      const analogCount = Object.values(board.pins).filter((p) => p.adc).length;
      if (analogCount >= (requirements.needsAnalogPins || 0)) {
        score += 3;
      } else {
        score -= 10;
      }
    }
    if (requirements.minGpioPins) {
      const gpioCount = Object.keys(board.pins).length;
      if (gpioCount >= requirements.minGpioPins) {
        score += 3;
      } else {
        score -= 10;
      }
    }
    if (requirements.budgetFriendly) {
      score -= board.price;
    }

    // Bonus for simplicity when no special requirements
    if (board.complexity === 'beginner') {
      score += 3;
    }

    scored.push({ board, score, reasons });
  }

  scored.sort((a, b) => b.score - a.score);

  const primary = scored[0];
  const alternatives = scored.slice(1).map((s) => s.board);
  const reasoning = primary.reasons.length > 0
    ? `Chose ${primary.board.name} because it ${primary.reasons.join(', ')}.`
    : `Chose ${primary.board.name} as the simplest and most beginner-friendly option.`;

  return { primary: primary.board, alternatives, reasoning };
}

export function clearCache(): void {
  cachedBoards = null;
}
