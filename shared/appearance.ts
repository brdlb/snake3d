export type SnakeAppearance = {
  patternSeed: number;
  backgroundColor: string;
  patternColor: string;
};

export const DEFAULT_SNAKE_APPEARANCE: SnakeAppearance = {
  patternSeed: 1847,
  backgroundColor: '#18212f',
  patternColor: '#4ade80',
};

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

export function normalizeSnakeAppearance(value: unknown): SnakeAppearance {
  const appearance = (value && typeof value === 'object' ? value : {}) as Partial<SnakeAppearance>;
  return {
    patternSeed:
      Number.isInteger(appearance.patternSeed) && appearance.patternSeed! >= 0
        ? appearance.patternSeed! >>> 0
        : DEFAULT_SNAKE_APPEARANCE.patternSeed,
    backgroundColor: HEX_COLOR.test(appearance.backgroundColor ?? '')
      ? appearance.backgroundColor!.toLowerCase()
      : DEFAULT_SNAKE_APPEARANCE.backgroundColor,
    patternColor: HEX_COLOR.test(appearance.patternColor ?? '')
      ? appearance.patternColor!.toLowerCase()
      : DEFAULT_SNAKE_APPEARANCE.patternColor,
  };
}

export function isSnakeAppearance(value: unknown): value is SnakeAppearance {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<SnakeAppearance>;
  return (
    Number.isInteger(candidate.patternSeed) &&
    candidate.patternSeed! >= 0 &&
    candidate.patternSeed! <= 0xffffffff &&
    HEX_COLOR.test(candidate.backgroundColor ?? '') &&
    HEX_COLOR.test(candidate.patternColor ?? '')
  );
}

function mulberry32(seed: number) {
  return () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Generates one quadrant and mirrors it across both axes. */
export function generateSnakePattern(seed: number, size = 7): boolean[][] {
  if (size < 3 || size % 2 === 0) throw new Error('Pattern size must be odd and at least 3');
  const pattern = Array.from({ length: size }, () => Array<boolean>(size).fill(false));
  const center = Math.floor(size / 2);
  const random = mulberry32(seed >>> 0);
  const setMirrored = (x: number, y: number, value: boolean) => {
    for (const px of new Set([x, size - 1 - x]))
      for (const py of new Set([y, size - 1 - y])) pattern[py][px] = value;
  };
  for (let y = 0; y <= center; y++) {
    for (let x = 0; x <= center; x++) {
      const neighbor = (x > 0 && pattern[y][x - 1]) || (y > 0 && pattern[y - 1][x]);
      setMirrored(x, y, (x === center && y === center) || random() < (neighbor ? 0.6 : 0.35));
    }
  }
  return pattern;
}

export function snakePatternBits(seed: number): number {
  const pattern = generateSnakePattern(seed, 7);
  let bits = 0;
  for (let y = 0; y < 4; y++)
    for (let x = 0; x < 4; x++) if (pattern[y][x]) bits |= 1 << (y * 4 + x);
  return bits;
}
