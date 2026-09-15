import * as THREE from 'three';
import type { SnakeAppearance } from '../../shared/appearance';
import { snakePatternBits } from '../../shared/appearance';

const vertexShader = `
  attribute vec3 instancePatternColor;
  attribute float instancePatternBits;
  varying vec2 patternUv;
  varying vec3 backgroundColor;
  varying vec3 ornamentColor;
  varying float patternBits;
  void main() {
    patternUv = uv;
    backgroundColor = instanceColor;
    ornamentColor = instancePatternColor;
    patternBits = instancePatternBits;
    vec4 worldPosition = instanceMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * modelViewMatrix * worldPosition;
  }
`;

const fragmentShader = `
  precision highp float;
  varying vec2 patternUv;
  varying vec3 backgroundColor;
  varying vec3 ornamentColor;
  varying float patternBits;
  uniform float opacity;
  void main() {
    vec2 cell = floor(patternUv * 7.0);
    vec2 mirrored = min(cell, vec2(6.0) - cell);
    float bitIndex = mirrored.y * 4.0 + mirrored.x;
    // An instanced attribute still arrives through a smoothly interpolated
    // varying. Restore the integer mask before bit extraction: tiny rasterizer
    // errors around exact powers of two otherwise turn solid cells into lines.
    float stablePatternBits = floor(patternBits + 0.5);
    float ornament = mod(floor(stablePatternBits / exp2(bitIndex)), 2.0);
    gl_FragColor = vec4(mix(backgroundColor, ornamentColor, ornament), opacity);
  }
`;

export function createSnakePatternMesh(capacity: number, opacity = 1): THREE.InstancedMesh {
  const geometry = new THREE.BoxGeometry(0.9, 0.9, 0.9);
  geometry.setAttribute('instancePatternColor', new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3));
  geometry.setAttribute('instancePatternBits', new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1));
  const material = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: { opacity: { value: opacity } },
    transparent: opacity < 1,
  });
  return new THREE.InstancedMesh(geometry, material, capacity);
}

export function setSnakePatternAt(mesh: THREE.InstancedMesh, index: number, appearance: SnakeAppearance) {
  mesh.setColorAt(index, new THREE.Color(appearance.backgroundColor));
  const colors = mesh.geometry.getAttribute('instancePatternColor') as THREE.InstancedBufferAttribute;
  const bits = mesh.geometry.getAttribute('instancePatternBits') as THREE.InstancedBufferAttribute;
  const color = new THREE.Color(appearance.patternColor);
  colors.setXYZ(index, color.r, color.g, color.b);
  bits.setX(index, snakePatternBits(appearance.patternSeed));
}

export function markSnakePatternsUpdated(mesh: THREE.InstancedMesh) {
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  (mesh.geometry.getAttribute('instancePatternColor') as THREE.InstancedBufferAttribute).needsUpdate = true;
  (mesh.geometry.getAttribute('instancePatternBits') as THREE.InstancedBufferAttribute).needsUpdate = true;
}
