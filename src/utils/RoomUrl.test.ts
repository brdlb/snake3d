import { describe, expect, it } from 'vitest';
import { roomUrl } from './RoomUrl';

describe('roomUrl', () => {
  it('adds the connected room to the current page address', () => {
    expect(roomUrl('https://snake.example/game', 123)).toBe('/game?room=123');
  });

  it('replaces a stale room while preserving other address parts', () => {
    expect(roomUrl('https://snake.example/game?lang=en&room=12#score', 34)).toBe(
      '/game?lang=en&room=34#score',
    );
  });
});
