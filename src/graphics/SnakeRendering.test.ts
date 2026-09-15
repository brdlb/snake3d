import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { getRenderableSegmentIndices } from './SnakeRendering';

describe('getRenderableSegmentIndices', () => {
  it('hides cloned tail segments pending movement', () => {
    const segments = [
      new THREE.Vector3(2, 0, 0),
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, 0, 0),
    ];

    expect(getRenderableSegmentIndices(segments)).toEqual([0, 1, 2]);
  });

  it('keeps all segments when the tail occupies distinct cells', () => {
    const segments = [
      new THREE.Vector3(2, 0, 0),
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(0, 0, 0),
    ];

    expect(getRenderableSegmentIndices(segments)).toEqual([0, 1, 2]);
  });

  it('still renders one instance when every segment is a tail clone', () => {
    const segments = [
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, 0, 0),
    ];

    expect(getRenderableSegmentIndices(segments)).toEqual([0]);
  });

  it('hides duplicate positions that are not adjacent', () => {
    const segments = [
      new THREE.Vector3(2, 0, 0),
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(2, 0, 0),
    ];
    expect(getRenderableSegmentIndices(segments)).toEqual([0, 1]);
  });

  it('uses shared occupied positions to prevent overlap between snakes', () => {
    const occupied = new Set<string>();
    expect(getRenderableSegmentIndices([new THREE.Vector3(1, 0, 0)], occupied)).toEqual([0]);
    expect(
      getRenderableSegmentIndices(
        [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 0)],
        occupied,
      ),
    ).toEqual([1]);
  });
});
