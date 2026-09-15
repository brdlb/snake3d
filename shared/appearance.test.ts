import { describe, expect, it } from 'vitest';
import { generateSnakePattern, normalizeSnakeAppearance, snakePatternBits } from './appearance';

describe('snake appearance', () => {
  it('generates a deterministic odd pattern mirrored around its center', () => {
    const pattern = generateSnakePattern(123456, 7);
    expect(pattern).toEqual(generateSnakePattern(123456, 7));
    expect(pattern[3][3]).toBe(true);
    for (let y = 0; y < 7; y++) for (let x = 0; x < 7; x++) {
      expect(pattern[y][x]).toBe(pattern[y][6 - x]);
      expect(pattern[y][x]).toBe(pattern[6 - y][x]);
      expect(pattern[y][x]).toBe(pattern[x][y]);
    }
    expect(snakePatternBits(123456)).toBe(snakePatternBits(123456));
  });

  it('uses safe defaults for old players without appearance data', () => {
    expect(normalizeSnakeAppearance(null)).toMatchObject({ patternSeed: 1847 });
  });
});
