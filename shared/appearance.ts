export type SnakeAppearance = {
  patternSeed: number;
  backgroundColor: string;
  patternColor: string;
};

export const DEFAULT_SNAKE_APPEARANCE: SnakeAppearance = {
  patternSeed: 1847,
  backgroundColor: '#311a1a',
  patternColor: '#d98c8c',
};

/** Builds a hex color from HSL components, with hue in degrees and S/L in percent. */
export function hslToHex(hue: number, saturation: number, lightness: number): string {
  const h = ((hue % 360) + 360) % 360;
  const s = Math.max(0, Math.min(100, saturation)) / 100;
  const l = Math.max(0, Math.min(100, lightness)) / 100;
  const chroma = (1 - Math.abs(2 * l - 1)) * s;
  const section = h / 60;
  const x = chroma * (1 - Math.abs((section % 2) - 1));
  const [r, g, b] = section < 1 ? [chroma, x, 0]
    : section < 2 ? [x, chroma, 0]
      : section < 3 ? [0, chroma, x]
        : section < 4 ? [0, x, chroma]
          : section < 5 ? [x, 0, chroma]
            : [chroma, 0, x];
  const m = l - chroma / 2;
  return `#${[r, g, b].map((channel) => Math.round((channel + m) * 255).toString(16).padStart(2, '0')).join('')}`;
}

export function randomizeSnakeColors(random = Math.random): Pick<SnakeAppearance, 'backgroundColor' | 'patternColor'> {
  const hue = random() * 360;
  return {
    backgroundColor: hslToHex(hue, 30, 15),
    patternColor: hslToHex(hue, 70, 70),
  };
}

export function getSnakeAppearanceHue(appearance: Pick<SnakeAppearance, 'backgroundColor'>): number {
  const hex = appearance.backgroundColor.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  if (delta === 0) return 0;
  const hue = max === r ? 60 * (((g - b) / delta) % 6)
    : max === g ? 60 * ((b - r) / delta + 2)
      : 60 * ((r - g) / delta + 4);
  return Math.round((hue + 360) % 360);
}

export function snakeColorsForHue(hue: number): Pick<SnakeAppearance, 'backgroundColor' | 'patternColor'> {
  return { backgroundColor: hslToHex(hue, 30, 15), patternColor: hslToHex(hue, 70, 70) };
}

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

/**
 * Generates one eighth of the pattern and reflects it across the central
 * axes and both diagonals. Thus the value at (x, y) always matches (y, x).
 */
export function generateSnakePattern(seed: number, size = 7): boolean[][] {
  if (size < 3 || size % 2 === 0) throw new Error('Pattern size must be odd and at least 3');
  const pattern = Array.from({ length: size }, () => Array<boolean>(size).fill(false));
  const center = Math.floor(size / 2);
  const random = mulberry32(seed >>> 0);
  const setMirrored = (x: number, y: number, value: boolean) => {
    const reflectedX = size - 1 - x;
    const reflectedY = size - 1 - y;
    for (const [px, py] of [
      [x, y],
      [y, x],
      [reflectedX, y],
      [reflectedY, x],
      [x, reflectedY],
      [y, reflectedX],
      [reflectedX, reflectedY],
      [reflectedY, reflectedX],
    ]) pattern[py][px] = value;
  };
  for (let y = 0; y <= center; y++) {
    for (let x = y; x <= center; x++) {
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
