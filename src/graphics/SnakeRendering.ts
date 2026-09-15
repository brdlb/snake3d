import * as THREE from 'three';

function segmentKey(segment: THREE.Vector3): string {
  return `${segment.x},${segment.y},${segment.z}`;
}

/** Returns segments that can be drawn without coplanar boxes at one position. */
export function getRenderableSegmentIndices(
  segments: readonly THREE.Vector3[],
  occupiedPositions: Set<string> = new Set(),
): number[] {
  const indices: number[] = [];
  for (let index = 0; index < segments.length; index++) {
    const key = segmentKey(segments[index]);
    if (occupiedPositions.has(key)) continue;
    occupiedPositions.add(key);
    indices.push(index);
  }
  return indices;
}
