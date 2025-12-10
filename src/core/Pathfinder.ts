import * as THREE from 'three';
import { World, FOOD_COLORS } from '../entities/World';

export class Pathfinder {
    private scene: THREE.Scene;
    private world: World;
    private container: THREE.Group;
    private lineMaterials: Map<number, THREE.LineDashedMaterial>;

    // Reuse helper vectors
    private _tempVec: THREE.Vector3 = new THREE.Vector3();

    constructor(scene: THREE.Scene, world: World) {
        this.scene = scene;
        this.world = world;
        this.container = new THREE.Group();
        this.scene.add(this.container);

        this.lineMaterials = new Map();
        this.lineMaterials.set(FOOD_COLORS.BLUE, new THREE.LineDashedMaterial({
            color: FOOD_COLORS.BLUE,
            dashSize: 0.5,
            gapSize: 0.3,
            linewidth: 1
        }));
        this.lineMaterials.set(FOOD_COLORS.GREEN, new THREE.LineDashedMaterial({
            color: FOOD_COLORS.GREEN,
            dashSize: 0.5,
            gapSize: 0.3,
            linewidth: 1
        }));
        this.lineMaterials.set(FOOD_COLORS.PINK, new THREE.LineDashedMaterial({
            color: FOOD_COLORS.PINK,
            dashSize: 0.5,
            gapSize: 0.3,
            linewidth: 1
        }));
    }

    /**
     * Resets/Clears all paths
     */
    public clear() {
        // Iterate backwards to remove
        for (let i = this.container.children.length - 1; i >= 0; i--) {
            const child = this.container.children[i] as THREE.Line;
            child.geometry.dispose();
            this.container.remove(child);
        }
    }

    /**
     * Finds nearest food of each color and draws paths to them
     */
    public updatePathVisualization(head: THREE.Vector3, segments: THREE.Vector3[], orientation: THREE.Quaternion, planarCheck: boolean = true) {
        this.clear();

        // Calculate forward vector from orientation
        const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(orientation);

        // Calculate up vector for planar check
        const up = new THREE.Vector3(0, 1, 0).applyQuaternion(orientation);

        // 1. Identify closest food items in view cone and optional plane
        const targets = this.findClosestFoods(head, forward, planarCheck ? up : null);

        // 2. Calculate and Draw Paths
        for (const target of targets) {
            // Pass localUp to restrict search plane if planarCheck is true
            // Also pass forward vector for cone restriction during search
            const path = this.findPathBFS(head, target.position, segments, planarCheck ? up : null, forward);
            if (path.length > 0) {
                this.drawLine(path, target.color);
            }
        }
    }

    private findClosestFoods(head: THREE.Vector3, forward: THREE.Vector3, localUp: THREE.Vector3 | null): { position: THREE.Vector3, color: number }[] {
        // Mode 1: Planar Search (Horizontal) - Return ALL food in frustum
        if (localUp) {
            const results: { position: THREE.Vector3, color: number }[] = [];

            // Constants for Field of View
            const minDotProduct = -0.5;

            this._tempVec.set(0, 0, 0);
            const _diff = new THREE.Vector3();

            for (let i = 0; i < this.world.foodPositions.length; i++) {
                const pos = this.world.foodPositions[i];

                // 1. Planar Check
                _diff.subVectors(pos, head);
                const verticalDist = Math.abs(_diff.dot(localUp));
                if (verticalDist > 0.5) {
                    continue; // Not on the same plane
                }

                // 2. Cone Check
                this._tempVec.subVectors(pos, head).normalize();
                if (this._tempVec.dot(forward) < minDotProduct) {
                    continue; // Outside cone
                }

                results.push({
                    position: pos,
                    color: this.world.foodColors[i].getHex()
                });
            }
            return results;
        }

        // Mode 2: Global Search - Return NEAREST of each color
        let nearestBlue: { pos: THREE.Vector3, dist: number } | null = null;
        let nearestGreen: { pos: THREE.Vector3, dist: number } | null = null;
        let nearestPink: { pos: THREE.Vector3, dist: number } | null = null;

        const minDotProduct = 0.1;
        this._tempVec.set(0, 0, 0);

        for (let i = 0; i < this.world.foodPositions.length; i++) {
            const pos = this.world.foodPositions[i];

            // Cone Filter
            this._tempVec.subVectors(pos, head).normalize();
            if (this._tempVec.dot(forward) < minDotProduct) {
                continue; // Outside cone
            }

            const color = this.world.foodColors[i].getHex();
            const dist = head.distanceToSquared(pos);

            if (color === FOOD_COLORS.BLUE) {
                if (!nearestBlue || dist < nearestBlue.dist) nearestBlue = { pos, dist };
            } else if (color === FOOD_COLORS.GREEN) {
                if (!nearestGreen || dist < nearestGreen.dist) nearestGreen = { pos, dist };
            } else if (color === FOOD_COLORS.PINK) {
                if (!nearestPink || dist < nearestPink.dist) nearestPink = { pos, dist };
            }
        }

        const results = [];
        if (nearestBlue) results.push({ position: nearestBlue.pos, color: FOOD_COLORS.BLUE });
        if (nearestGreen) results.push({ position: nearestGreen.pos, color: FOOD_COLORS.GREEN });
        if (nearestPink) results.push({ position: nearestPink.pos, color: FOOD_COLORS.PINK });

        return results;
    }

    private findPathBFS(start: THREE.Vector3, end: THREE.Vector3, obstacles: THREE.Vector3[], localUp: THREE.Vector3 | null = null, forward: THREE.Vector3 | null = null): THREE.Vector3[] {
        // Simple BFS on grid
        const queue: { pos: THREE.Vector3, path: THREE.Vector3[] }[] = [];
        const visited = new Set<string>();

        // Block obstacle hash strings
        const obstacleSet = new Set<string>();
        obstacles.forEach(o => obstacleSet.add(this.hash(o)));

        queue.push({ pos: start.clone().round(), path: [start.clone().round()] });
        visited.add(this.hash(start));

        // Limit iterations to prevent frame drop
        // With planar search, 2000 is extremely deep (approx 45x45 area)
        let iterations = 0;
        const maxIterations = 2000;

        const _diff = new THREE.Vector3();
        const _dirToNode = new THREE.Vector3();

        // Match the value used in findClosestFoods logic (currently -0.5 per user edit)
        const minDotProduct = -0.5;

        while (queue.length > 0) {
            iterations++;
            if (iterations > maxIterations) break;

            const { pos, path } = queue.shift()!;

            if (pos.distanceToSquared(end) < 0.1) {
                return path;
            }

            // Neighbors (6 directions)
            const neighbors = [
                new THREE.Vector3(1, 0, 0), new THREE.Vector3(-1, 0, 0),
                new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, -1, 0),
                new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -1)
            ];

            // Optional: Also restrict expansion based on general forward direction if provided?
            // Currently requested: restrict search by minDotProduct (cone)
            // But we need 'forward' for that.
            // Let's assume standard BFS for now unless user wants strict cone search.
            // Wait, the user asked "also restrict SEARCH by current minDotProduct".
            // This implies the PATH finding itself should not wander backwards.

            // To do this, we need 'forward' vector passed to finding function.
            // However, BFS finds shortest path. Restricting it to a cone might make it fail to find "hook" paths around walls.
            // But the user asked for it.

            // Let's modify the signature to take forward and minDotProduct?
            // Or maybe just interpret the request as "don't search backwards even if it's the only way"?

            // Re-reading: "tak zhe ogranich poisk tekushim znacheniem minDotProduct"
            // (Also restrict search by current minDotProduct value)

            // This likely refers to the `findClosestFoods` method, ensuring we use the updated 0.3 value there?
            // NO, I already manually updated that to 0.3 in the file.
            // The request likely means: "Make sure the BFS search ITSELF doesn't expand nodes that are behind the snake".

            // I will update the findBFS to respect a "forward" cone check relative to START position.


            for (const dir of neighbors) {
                // Plane Restriction CHECK
                if (localUp) {
                    // Dot product of direction and Up must be 0 (perpendicular)
                    if (Math.abs(dir.dot(localUp)) > 0.9) {
                        continue; // Skip moving "up" or "down" relative to snake plane
                    }
                }

                const nextPos = pos.clone().add(dir);
                const h = this.hash(nextPos);

                // Double check final position planar deviation (to handle drift/float issues)
                if (localUp) {
                    _diff.subVectors(nextPos, start);
                    if (Math.abs(_diff.dot(localUp)) > 0.5) continue;
                }

                // Cone Restriction CHECK (Restrict search expansion area)
                if (forward) {
                    _dirToNode.subVectors(nextPos, start).normalize();
                    // Check if node is within the cone relative to START position
                    if (_dirToNode.lengthSq() > 0.001) {
                        if (_dirToNode.dot(forward) < minDotProduct) {
                            continue; // Node is outside the cone of vision
                        }
                    }
                }

                if (!visited.has(h) && !this.world.isOutOfBounds(nextPos) && !obstacleSet.has(h)) {
                    visited.add(h);
                    const newPath = [...path, nextPos];
                    queue.push({ pos: nextPos, path: newPath });
                }
            }
        }

        return []; // No path found
    }

    private hash(v: THREE.Vector3): string {
        return `${Math.round(v.x)},${Math.round(v.y)},${Math.round(v.z)}`;
    }

    private drawLine(points: THREE.Vector3[], color: number) {
        const geometry = new THREE.BufferGeometry().setFromPoints(points);
        const material = this.lineMaterials.get(color);

        const line = new THREE.Line(geometry, material);
        line.computeLineDistances(); // Required for dashes
        this.container.add(line);
    }

    public dispose() {
        this.clear();
        this.container.removeFromParent();
        this.lineMaterials.forEach(mat => mat.dispose());
    }
}
