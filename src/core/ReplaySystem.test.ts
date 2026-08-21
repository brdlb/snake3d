import { describe, expect, it } from 'vitest';
import { ReplayPlayer } from './ReplaySystem';
import type { ReplayData } from '../types/replay';

describe('ReplayPlayer', () => {
    it('uses safe defaults for legacy replays without start parameters', () => {
        const legacyReplay = {
            id: 'legacy-replay',
            playerId: 'player-1',
            playerName: 'Player',
            timestamp: 0,
            finalScore: 10,
            deathPosition: { x: 1, y: 1, z: 1 },
            trajectoryLog: []
        } as unknown as ReplayData;

        const player = new ReplayPlayer(legacyReplay);

        expect(player.getInitialSpeed()).toBe(300);
        expect(player.startParams.spawnIndex).toBe(0);
    });
});
