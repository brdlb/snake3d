import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Snake } from './Snake';

describe('Snake authoritative state', () => {
    it('replaces local prediction with the server state', () => {
        const snake = new Snake();
        const segments = [
            new THREE.Vector3(10, 11, 12),
            new THREE.Vector3(10, 11, 13),
            new THREE.Vector3(10, 11, 14),
        ];
        const direction = new THREE.Quaternion().setFromUnitVectors(
            new THREE.Vector3(0, 0, -1),
            new THREE.Vector3(1, 0, 0),
        );

        snake.applyAuthoritativeState(segments, direction, 600);

        expect(snake.segments).toEqual(segments);
        expect(snake.direction).toEqual(direction);
        expect(snake.getStepsPerMinute()).toBe(600);
    });
});
