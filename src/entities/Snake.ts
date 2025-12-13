import * as THREE from 'three';

export class Snake {
    public segments: THREE.Vector3[] = [];
    public direction: THREE.Quaternion = new THREE.Quaternion();

    private moveInterval: number = 0.20; // Default speed
    private accumulatedTime: number = 0;

    private growthPending: number = 0;

    // Temporary variables for zero-allocation math
    private _tempVec: THREE.Vector3 = new THREE.Vector3();
    private _tempQuat: THREE.Quaternion = new THREE.Quaternion();
    private _axis: THREE.Vector3 = new THREE.Vector3();

    private lastStepVector: THREE.Vector3 = new THREE.Vector3(0, 0, -1);

    constructor(startPosition: THREE.Vector3 = new THREE.Vector3(0, 0, 0), startDirection?: THREE.Quaternion) {
        this.reset(startPosition, startDirection);
    }

    public setSpeed(interval: number) {
        this.moveInterval = interval;
    }

    public reset(startPosition: THREE.Vector3, startDirection?: THREE.Quaternion) {
        this.segments = [];

        // Определяем начальное направление
        if (startDirection) {
            this.direction.copy(startDirection);
        } else {
            this.direction.identity();
        }

        // Вычисляем вектор "назад" для размещения хвоста
        const backVector = new THREE.Vector3(0, 0, 1).applyQuaternion(this.direction);

        // Голова
        this.segments.push(startPosition.clone());
        // Хвост располагается позади головы
        this.segments.push(startPosition.clone().add(backVector.clone()));
        this.segments.push(startPosition.clone().add(backVector.clone().multiplyScalar(2)));

        // Сохраняем вектор последнего шага (вперёд)
        this.lastStepVector.set(0, 0, -1).applyQuaternion(this.direction);
        this.accumulatedTime = 0;
        this.growthPending = 0;
    }

    public update(delta: number): boolean {
        // Returns true if snake moved this frame
        this.accumulatedTime += delta;

        if (this.accumulatedTime >= this.moveInterval) {
            this.accumulatedTime -= this.moveInterval;
            this.step();
            return true;
        }
        return false;
    }

    /**
     * Interpolation factor for smooth rendering [0, 1]
     */
    public getStepProgress(): number {
        return Math.min(this.accumulatedTime / this.moveInterval, 1.0);
    }

    private step() {
        // Calculate forward vector from CURRENT quaternion
        // reused _tempVec to avoid allocation
        this._tempVec.set(0, 0, -1).applyQuaternion(this.direction);

        // Snap to grid axis to prevent drift
        if (Math.abs(this._tempVec.x) > 0.5) this._tempVec.set(Math.sign(this._tempVec.x), 0, 0);
        else if (Math.abs(this._tempVec.y) > 0.5) this._tempVec.set(0, Math.sign(this._tempVec.y), 0);
        else this._tempVec.set(0, 0, Math.sign(this._tempVec.z));

        // Update last step vector
        this.lastStepVector.copy(this._tempVec);

        // Use Object Pooling for segments
        let newHead: THREE.Vector3;

        if (this.growthPending > 0) {
            // If growing, we CREATE a new segment (this is acceptable as it's a permanent game state change)
            // Ideally we could pre-allocate a pool but for now simple grow is fine.
            newHead = new THREE.Vector3();
            this.growthPending--;
        } else {
            // Recycle the tail!
            const tail = this.segments.pop();
            // If for some reason tail is undefined (shouldn't happen with correct logic), fallback
            newHead = tail || new THREE.Vector3();
        }

        // Position newHead at currentHead + forward
        newHead.copy(this.segments[0]).add(this._tempVec);

        // Move body
        this.segments.unshift(newHead);
    }

    public rotate(angle: number) {
        // Turn Left/Right (Around local Y axis)
        this._axis.set(0, 1, 0); // Local Up
        this._tempQuat.setFromAxisAngle(this._axis, angle);

        // Check if rotation would result in 180 degree turn relative to LAST MOVEMENT
        const nextQuat = this.direction.clone().multiply(this._tempQuat).normalize();
        const nextForward = new THREE.Vector3(0, 0, -1).applyQuaternion(nextQuat);

        if (nextForward.dot(this.lastStepVector) < -0.5) {
            return;
        }

        this.direction.copy(nextQuat);
    }

    public roll(angle: number) {
        // Roll Left/Right (Around local Z axis - Forward)
        this._axis.set(0, 0, -1); // Local Forward
        this._tempQuat.setFromAxisAngle(this._axis, angle);
        this.direction.multiply(this._tempQuat);
        this.direction.normalize();
    }

    public grow() {
        this.growthPending++;
    }

    public getHead(): THREE.Vector3 {
        return this.segments[0];
    }

    public skipStep() {
        this.accumulatedTime -= this.moveInterval;
    }

    public getStepsPerMinute(): number {
        return Math.round(60 / this.moveInterval);
    }
}
