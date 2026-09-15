import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { getRenderableSegmentCount } from './SnakeRendering';

describe('getRenderableSegmentCount', () => {
  it('hides cloned tail segments pending movement', () => {
    const segments = [
      new THREE.Vector3(2, 0, 0),
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, 0, 0),
    ];

    expect(getRenderableSegmentCount(segments)).toBe(3);
  });

  it('keeps all segments when the tail occupies distinct cells', () => {
    const segments = [
      new THREE.Vector3(2, 0, 0),
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(0, 0, 0),
    ];

    expect(getRenderableSegmentCount(segments)).toBe(3);
  });

  it('still renders one instance when every segment is a tail clone', () => {
    const segments = [
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, 0, 0),
    ];

    expect(getRenderableSegmentCount(segments)).toBe(1);
  });
});
