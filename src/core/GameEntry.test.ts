import { afterEach, describe, expect, it, vi } from 'vitest';
import { Game } from './Game';
import { Vector3 } from 'three';

afterEach(() => vi.unstubAllGlobals());

describe('online room entry', () => {
  function setup(waitForRoomState: () => Promise<unknown>) {
    vi.stubGlobal('window', {
      location: { search: '', href: 'https://example.com/' },
      history: { state: null, replaceState: vi.fn() },
    });
    const game = Object.create(Game.prototype) as any;
    Object.assign(game, {
      isWaitingForStart: false,
      selectedRoomSeed: null,
      soundManager: { initAudio: vi.fn() },
      networkManager: {
        isConnected: () => true,
        requestRoom: vi.fn().mockResolvedValue({ seed: 123 }),
        waitForRoomState,
      },
      initializeRoom: vi.fn(),
      initializeOfflineRoom: vi.fn(),
      applyLiveSnapshot: vi.fn(() => { game.localSnakeInitialized = true; }),
      hud: { setVisibility: vi.fn(), togglePauseButton: vi.fn() },
      cameraController: { stopOrbitMode: vi.fn() },
    });
    return game;
  }

  it('holds movement until the server snapshot has been applied', async () => {
    let resolve!: (snapshot: unknown) => void;
    const game = setup(() => new Promise((done) => { resolve = done; }));
    const entry = game.handleGameStart('player');
    await vi.waitFor(() => expect(game.initializeRoom).toHaveBeenCalled());
    expect(game.isWaitingForStart).toBe(true);
    expect(game.applyLiveSnapshot).not.toHaveBeenCalled();
    resolve({ seed: 123 });
    await entry;
    expect(game.applyLiveSnapshot).toHaveBeenCalledWith({ seed: 123 });
    expect(game.isWaitingForStart).toBe(false);
  });

  it('keeps entry blocked when the server snapshot times out', async () => {
    const game = setup(() => Promise.reject(new Error('TIMEOUT')));
    await expect(game.handleGameStart('player')).rejects.toThrow('TIMEOUT');
    expect(game.isWaitingForStart).toBe(true);
    expect(game.initializeOfflineRoom).not.toHaveBeenCalled();
  });
});

describe('remote player collisions', () => {
  it.each([false, true])('collides with overlapping opponents only when alive=%s', (alive) => {
    const game = Object.create(Game.prototype) as any;
    const head = new Vector3(10, 10, 10);
    Object.assign(game, {
      liveWorld: true,
      snake: { getHead: () => head },
      world: { isOutOfBounds: () => false, checkSelfCollision: () => false, checkFoodCollision: () => -1 },
      liveOpponents: [{ id: 'peer', alive, segments: [head.clone()], color: '#ffffff' }],
      logAction: vi.fn(),
      particleSystem: { emit: vi.fn() },
      handleGameOver: vi.fn(),
      checkPhantomCollisions: () => false,
    });
    game.checkCollisions(null);
    if (alive) expect(game.handleGameOver).toHaveBeenCalledWith('remote-player-collision');
    else expect(game.handleGameOver).not.toHaveBeenCalled();
  });
});
