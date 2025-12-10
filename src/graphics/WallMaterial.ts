import * as THREE from 'three';

export const WallMaterial = new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    transparent: true,
    depthWrite: false, // Important for proper transparency sorting/rendering of double-sided transparent objects
    uniforms: {
        uColor: { value: new THREE.Color(0xffffff) },
        uBaseColor: { value: new THREE.Color(0x050505) },
        uCameraPosition: { value: new THREE.Vector3() },
        uSnakeSize: { value: 1.0 }
    },
    vertexShader: `
        varying vec3 vWorldPosition;
        
        void main() {
            vec4 worldPosition = modelMatrix * vec4(position, 1.0);
            vWorldPosition = worldPosition.xyz;
            gl_Position = projectionMatrix * viewMatrix * worldPosition;
        }
    `,
    fragmentShader: `
        varying vec3 vWorldPosition;
        uniform vec3 uCameraPosition;
        uniform vec3 uColor;
        uniform vec3 uBaseColor;
        uniform float uSnakeSize;
        
        // Anti-aliased grid function
        float grid(vec3 pos, float spacing, float thickness) {
            if (spacing <= 0.0) return 0.0;
            
            vec3 f = abs(fract((pos + 0.5) / spacing) - 0.5);
            
            // Calculate grid intensity
            // We want 1.0 at f=0.5 (integer boundary)
            // Use fwidth(pos / spacing) for thickness consistent with screen space
            vec3 df_coord = fwidth(pos / spacing);
            
            vec3 g = smoothstep(0.5 - thickness * df_coord, 0.5 + thickness * df_coord, f);
            
            // Mask out the dimension that is parallel to the surface
            // If fwidth(pos.x) is tiny, it means X is constant -> we are on X plane.
            vec3 fw = fwidth(pos);
            g.x *= step(0.0001, fw.x);
            g.y *= step(0.0001, fw.y);
            g.z *= step(0.0001, fw.z);
            
            return max(g.x, max(g.y, g.z));
        }

        void main() {
            float dist = distance(vWorldPosition, uCameraPosition);
            
            // Layer 1: Base Grid (Snake Size = 1.0)
            // Visible when CLOSE. Fades out at distance.
            float visibility1 = 1.0 - smoothstep(5.0, 30.0, dist);
            float g1 = grid(vWorldPosition, uSnakeSize, 1.0) * visibility1;
            
            // Layer 2: Medium Grid (3x)
            // Contains 3 base cells as requested
            float g2 = grid(vWorldPosition, uSnakeSize * 3.0, 2.0);
            
            // Combine layers: only Base (1x) and Medium (3x)
            float combined = max(g1, g2);
            
            vec3 finalColor = mix(uBaseColor, uColor, combined);
            
            // Calculate Alpha
            // Base transparency (very transparent) + Grid opacity
            float baseAlpha = 0.0;
            float alpha = baseAlpha + (combined * 0.8);
            
            // Optional: Distance fade to fully transparent at very far edge
            float farFade = smoothstep(60.0, 100.0, dist);
            alpha *= (1.0 - farFade);

            gl_FragColor = vec4(finalColor, alpha);
        }
    `
});
