import * as THREE from 'three';

/**
 * Network length updates temporarily extend a snake by cloning its tail.
 * Keep those pending-growth clones in simulation state, but render only one
 * instance at the shared tail position to avoid coplanar geometry.
 */
export function getRenderableSegmentCount(segments: readonly THREE.Vector3[]): number {
  let count = segments.length;
  while (count > 1 && segments[count - 1].equals(segments[count - 2])) count--;
  return count;
}
