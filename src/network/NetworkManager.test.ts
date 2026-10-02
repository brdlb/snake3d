import { afterEach, describe, expect, it, vi } from 'vitest';
import { NetworkManager } from './NetworkManager';
import type { AdventureInput } from '../../shared/realtime';

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

function setup() {
  vi.useFakeTimers();
  vi.stubGlobal('window', { setTimeout, clearTimeout });
  vi.stubGlobal('WebSocket', { OPEN: 1 });
  const network = Object.create(NetworkManager.prototype) as any;
  const send = vi.fn();
  Object.assign(network, { socket: { readyState: 1, send }, listeners: new Map() });
  const input: AdventureInput = { segments: [{ x: 5, y: 5, z: 5 }], direction: { x: 1, y: 0, z: 0 }, up: { x: 0, y: 1, z: 0 }, score: 0, speed: 300, step: 1, epoch: 0 };
  return { network, send, input };
}

describe('adventure checkpoints', () => {
  it('sends subsequent movement without waiting and limits the portal barrier to the local checkpoint', async () => {
    const { network, send, input } = setup();
    network.sendAdventureStep(input, 'LOCAL');
    network.sendAdventureStep({ ...input, step: 2 }, 'LOCAL');
    expect(send).toHaveBeenCalledTimes(2);
    let confirmed = false;
    const barrier = network.waitAdventureCheckpoint().then(() => { confirmed = true; });
    network.emit('adventure.state', { entityId: 'OTHER', step: 2, epoch: 0 });
    await Promise.resolve();
    expect(confirmed).toBe(false);
    network.emit('adventure.state', { entityId: 'LOCAL', step: 1, epoch: 0 });
    await Promise.resolve();
    expect(confirmed).toBe(false);
    network.emit('adventure.state', { entityId: 'LOCAL', step: 2, epoch: 0 });
    await barrier;
    expect(confirmed).toBe(true);
  });
  it('aborts portal transfer when its source checkpoint is corrected', async () => {
    const { network, input } = setup();
    network.sendAdventureStep(input, 'LOCAL');
    const rejected = expect(network.waitAdventureCheckpoint()).rejects.toThrow('ADVENTURE_CORRECTION');
    network.emit('adventure.state', { entityId: 'LOCAL', step: 1, epoch: 1, correction: true });
    await rejected;
  });
});
