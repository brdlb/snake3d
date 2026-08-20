import { describe, expect, it } from 'vitest';
import { NetworkManager } from '../../network/NetworkManager';

describe('NetworkManager', () => {
  it('can be imported by non-browser checks without opening a connection', () => {
    expect(NetworkManager.getInstance().isConnected()).toBe(false);
  });
});
