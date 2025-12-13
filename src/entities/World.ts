import * as THREE from 'three';

// Food Colors Constants
export const FOOD_COLORS = {
    GREEN: 0x5aff68,
    BLUE: 0x00b7ff,
    PINK: 0xf85bfd
};

export const WORLD_SIZE = 50;

export class World {
    public readonly size: number;
    public foodPositions: THREE.Vector3[] = [];
    public foodColors: THREE.Color[] = [];
    public foodSounds: number[] = [];
    public readonly FOOD_COUNT = 200;

    constructor(size: number = WORLD_SIZE) {
        this.size = size;
        this.respawnFood([]);
    }

    public isOutOfBounds(position: THREE.Vector3): boolean {
        return position.x < 0 || position.x > this.size ||
            position.y < 0 || position.y > this.size ||
            position.z < 0 || position.z > this.size;
    }

    public checkSelfCollision(segments: THREE.Vector3[]): boolean {
        if (segments.length < 4) return false;

        const head = segments[0];
        for (let i = 1; i < segments.length; i++) {
            if (head.distanceToSquared(segments[i]) < 0.1) {
                return true;
            }
        }
        return false;
    }

    // Returns index of food eaten, or -1
    public checkFoodCollision(head: THREE.Vector3): number {
        for (let i = 0; i < this.foodPositions.length; i++) {
            if (head.distanceToSquared(this.foodPositions[i]) < 0.1) {
                return i;
            }
        }
        return -1;
    }

    public respawnFood(snakeSegments: THREE.Vector3[], index: number = -1) {
        const generatePos = () => {
            const x = Math.floor(Math.random() * (this.size + 1));
            const y = Math.floor(Math.random() * (this.size + 1));
            const z = Math.floor(Math.random() * (this.size + 1));
            return new THREE.Vector3(x, y, z);
        };

        const respawnSingle = (idx: number) => {
            let valid = false;
            let attempts = 0;
            while (!valid && attempts < 1000) {
                const newPos = generatePos();

                // Check overlap with snake
                const overlapSnake = snakeSegments.some(seg => seg.distanceToSquared(newPos) < 0.1);

                // Check overlap with other food (optional, but good for 50 items)
                const overlapFood = this.foodPositions.some((pos, i) => i !== idx && pos.distanceToSquared(newPos) < 0.1);

                if (!overlapSnake && !overlapFood) {
                    this.foodPositions[idx] = newPos;
                    // Select random food type
                    const rand = Math.random();
                    if (rand < 0.50) {
                        this.foodColors[idx].setHex(FOOD_COLORS.BLUE); // 50%
                        this.foodSounds[idx] = 2; // hum1
                    } else if (rand < 0.90) {
                        this.foodColors[idx].setHex(FOOD_COLORS.GREEN); // 40%
                        this.foodSounds[idx] = 3; // hum2
                    } else {
                        this.foodColors[idx].setHex(FOOD_COLORS.PINK); // 10%
                        this.foodSounds[idx] = 1; // hum3
                    }
                    valid = true;
                }
                attempts++;
            }
            if (!valid) console.warn("Could not find free spot for food index", idx);
        };

        if (index === -1) {
            // Initialize all
            this.foodPositions = new Array(this.FOOD_COUNT).fill(null).map(() => new THREE.Vector3(0, 0, 0));
            this.foodColors = new Array(this.FOOD_COUNT).fill(null).map(() => new THREE.Color());
            this.foodSounds = new Array(this.FOOD_COUNT).fill(0);
            for (let i = 0; i < this.FOOD_COUNT; i++) {
                respawnSingle(i);
            }
        } else {
            // Respawn specific
            if (index >= 0 && index < this.foodPositions.length) {
                respawnSingle(index);
            }
        }
    }
}
