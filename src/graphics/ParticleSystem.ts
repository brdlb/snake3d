import * as THREE from 'three';

interface Particle {
    position: THREE.Vector3;
    velocity: THREE.Vector3;
    life: number;
    maxLife: number;
    rotation: THREE.Euler;
    rotSpeed: THREE.Vector3;
    color: THREE.Color;
}

export class ParticleSystem {
    private mesh: THREE.InstancedMesh;
    private particles: Particle[] = [];
    private maxParticles: number;
    private dummy: THREE.Object3D = new THREE.Object3D();
    private explosionTemplates: THREE.Vector3[] = [];

    // Global Time Logic
    private globalTimeScale: number = 2.0;
    private isStopping: boolean = false;

    constructor(scene: THREE.Scene, texture: THREE.Texture, maxParticles: number = 200) {
        this.maxParticles = maxParticles;

        const geometry = new THREE.BoxGeometry(0.3, 0.3, 0.3);
        const material = new THREE.MeshBasicMaterial({
            color: 0xffffff, // White to allow vertex colors to tint
            map: texture
        });

        this.mesh = new THREE.InstancedMesh(geometry, material, maxParticles);
        this.mesh.count = 0;
        this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.mesh.castShadow = false; // Optimization
        this.mesh.receiveShadow = false;
        this.mesh.frustumCulled = false; // Fix: Prevent particles from disappearing when bounds aren't updated
        scene.add(this.mesh);

        // Initialize pool
        for (let i = 0; i < maxParticles; i++) {
            this.particles.push({
                position: new THREE.Vector3(),
                velocity: new THREE.Vector3(),
                life: 0,
                maxLife: 1.0,
                rotation: new THREE.Euler(),
                rotSpeed: new THREE.Vector3(),
                color: new THREE.Color(0xffffff)
            });
        }

        // Pre-calculate explosion template (Cone shape pointing forward -Z)
        for (let i = 0; i < 50; i++) {
            const v = new THREE.Vector3(
                (Math.random() - 0.5),     // Spread X
                (Math.random() - 0.5),     // Spread Y
                -(Math.random() * 0.4 + 0.2) // Forward Z (mostly forward)
            ).normalize().multiplyScalar(4 + Math.random() * 10); // Speed variation
            this.explosionTemplates.push(v);
        }
    }

    /**
     * Spawns particles from a point, exploding in a semi-random direction oriented by 'orientation'
     */
    public emit(center: THREE.Vector3, orientation: THREE.Quaternion, count: number, color: THREE.Color) {
        let spawned = 0;
        let templateIdx = Math.floor(Math.random() * this.explosionTemplates.length);

        for (let i = 0; i < this.maxParticles && spawned < count; i++) {
            const p = this.particles[i];

            // Reuse dead particles
            if (p.life <= 0) {
                p.life = 1.0;
                p.maxLife = 0.2 + Math.random() * 0.6 + 0.2; // Slightly longer life variance

                // Reset Position
                p.position.copy(center);

                // Set Color
                p.color.copy(color);

                // Use Template Velocity
                const template = this.explosionTemplates[templateIdx % this.explosionTemplates.length];
                p.velocity.copy(template).applyQuaternion(orientation);
                templateIdx++;

                // Random Rotation Axis/Speed (using Euler for simple tumbling)
                p.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
                p.rotSpeed.set(
                    (Math.random() - 0.5) * 10,
                    (Math.random() - 0.5) * 10,
                    (Math.random() - 0.5) * 10
                );

                spawned++;
            }
        }
    }

    public stopTime() {
        this.isStopping = true;
    }

    public update(delta: number) {
        let activeCount = 0;

        // Update Global Time Scale
        if (this.isStopping) {
            this.globalTimeScale -= delta * 2.0; // Decelerate speed
            if (this.globalTimeScale < 0) this.globalTimeScale = 0;
        } else {
            this.globalTimeScale = 1.0;
        }

        const dt = delta * this.globalTimeScale;

        for (const p of this.particles) {
            if (p.life > 0) {
                // Apply update using time-scaled delta
                p.position.addScaledVector(p.velocity, dt);

                p.rotation.x += p.rotSpeed.x * dt;
                p.rotation.y += p.rotSpeed.y * dt;
                p.rotation.z += p.rotSpeed.z * dt;

                p.life -= dt / p.maxLife;

                if (p.life > 0) {
                    const s = p.life; // Scale based on life

                    // Update Instance Matrix
                    this.dummy.position.copy(p.position);
                    this.dummy.rotation.copy(p.rotation);
                    this.dummy.scale.set(s, s, s);

                    this.dummy.updateMatrix();
                    this.mesh.setMatrixAt(activeCount, this.dummy.matrix);
                    this.mesh.setColorAt(activeCount, p.color);

                    activeCount++;
                }
            }
        }

        this.mesh.count = activeCount;
        if (activeCount > 0) {
            this.mesh.instanceMatrix.needsUpdate = true;
            if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
        }
    }

    public clear() {
        this.isStopping = false;
        this.globalTimeScale = 2.0;
        for (const p of this.particles) {
            p.life = 0;
        }
        this.mesh.count = 0;
        this.mesh.instanceMatrix.needsUpdate = true;
    }

    public dispose() {
        this.mesh.geometry.dispose();
        // @ts-ignore
        if (this.mesh.material.dispose) this.mesh.material.dispose();
    }
}
