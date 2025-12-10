import * as THREE from 'three';
import { CameraConfig } from './SettingsManager';
import { WallMaterial } from '../graphics/WallMaterial';

export class CameraController {
    private camera: THREE.PerspectiveCamera;
    private config: CameraConfig;

    private cameraRig: THREE.Object3D;

    // Helpers
    private _tempVec: THREE.Vector3 = new THREE.Vector3();
    private _tempVec2: THREE.Vector3 = new THREE.Vector3();
    private _camUp: THREE.Vector3 = new THREE.Vector3();
    private _camBack: THREE.Vector3 = new THREE.Vector3();
    private _camTarget: THREE.Vector3 = new THREE.Vector3();

    // Shake
    private shakeIntensity: number = 0;
    private shakeDecay: number = 0.6;

    // Manual Control
    private manualYaw: number = 0;
    private manualPitch: number = 0;
    private isManualActive: boolean = false;
    private smoothedRigQuaternion: THREE.Quaternion = new THREE.Quaternion();

    constructor(camera: THREE.PerspectiveCamera, config: CameraConfig, scene: THREE.Scene) {
        this.camera = camera;
        this.config = config;

        this.cameraRig = new THREE.Object3D();
        scene.add(this.cameraRig);
    }

    public updateConfig(newConfig: CameraConfig) {
        this.config = newConfig;
        this.camera.fov = this.config.fov;
        this.camera.updateProjectionMatrix();
    }

    public triggerShake(amount: number, decay: number = 0.6) {
        this.shakeIntensity = amount;
        this.shakeDecay = decay;
    }

    public reset() {
        this.cameraRig.position.set(0, 0, 0);
        this.cameraRig.quaternion.identity();
        this.smoothedRigQuaternion.identity();
        this.manualYaw = 0;
        this.manualPitch = 0;
        this.isManualActive = false;
        this.isGameOver = false;
        this.gameOverTime = 0;
    }

    public update(delta: number, targetPos: THREE.Vector3, targetDir: THREE.Quaternion, progress: number) {
        if (this.isGameOver) {
            this.updateGameOver(delta);
            return;
        }

        // 1. Calculate Visual Head Position (Target for Rig)
        this._tempVec.set(0, 0, -1).applyQuaternion(targetDir);
        this._tempVec2.copy(targetPos).add(this._tempVec.multiplyScalar(progress));

        // 2. Update Rig
        this.cameraRig.position.lerp(this._tempVec2, delta * this.config.lerpSpeed);

        // Slerp the smoothed base quaternion towards target
        this.smoothedRigQuaternion.slerp(targetDir, delta * this.config.lerpSpeed);

        // Apply Manual Control
        if (!this.isManualActive) {
            // Decay
            const decay = Math.min(delta * 5.0, 1.0); // Fast decay
            this.manualYaw = THREE.MathUtils.lerp(this.manualYaw, 0, decay);
            this.manualPitch = THREE.MathUtils.lerp(this.manualPitch, 0, decay);
        }

        // Construct Manual Quaternion (Local Rotation)
        const qYaw = new THREE.Quaternion();
        qYaw.setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.manualYaw);

        const qPitch = new THREE.Quaternion();
        qPitch.setFromAxisAngle(new THREE.Vector3(1, 0, 0), this.manualPitch);

        // Combine: Base * Yaw * Pitch (Yaw around local Y, Pitch around local X)
        this.cameraRig.quaternion.copy(this.smoothedRigQuaternion).multiply(qYaw).multiply(qPitch);

        this.updateCameraFromRig(delta);
    }

    private updateCameraFromRig(delta: number) {
        // 3. Calc Camera Position relative to Rig
        this._camUp.set(0, 1, 0).applyQuaternion(this.cameraRig.quaternion);
        this._camBack.set(0, 0, 1).applyQuaternion(this.cameraRig.quaternion);

        this._camTarget.copy(this.cameraRig.position)
            .add(this._camUp.multiplyScalar(this.config.distanceUp))
            .add(this._camBack.multiplyScalar(this.config.distanceBack));

        this.camera.position.copy(this._camTarget);

        // 4. Orientation
        this._camUp.set(0, 1, 0).applyQuaternion(this.cameraRig.quaternion);
        this.camera.up.copy(this._camUp);

        // Look At Target with Horizon Offset
        this._tempVec.copy(this.cameraRig.position).addScaledVector(this._camUp, this.config.horizonOffset);
        this.camera.lookAt(this._tempVec);

        // Update Shader Uniforms
        WallMaterial.uniforms.uCameraPosition.value.copy(this.camera.position);

        // Shake
        if (this.shakeIntensity > 0) {
            const rx = (Math.random() - 0.5) * 2 * this.shakeIntensity;
            const ry = (Math.random() - 0.5) * 2 * this.shakeIntensity;
            const rz = (Math.random() - 0.5) * 2 * this.shakeIntensity;

            this.camera.position.add(this._tempVec.set(rx, ry, rz));
            this.shakeIntensity -= delta * this.shakeDecay;
            if (this.shakeIntensity < 0) this.shakeIntensity = 0;
        }
    }

    // Game Over State
    private isGameOver: boolean = false;
    private gameOverTime: number = 0;
    private gameOverBaseQuat: THREE.Quaternion = new THREE.Quaternion();

    public setGameOverMode() {
        this.isGameOver = true;
        this.gameOverTime = 0;
        this.gameOverBaseQuat.copy(this.cameraRig.quaternion);
    }

    public setManualControlActive(active: boolean) {
        this.isManualActive = active;
    }

    public applyManualMovement(dx: number, dy: number, sensitivity: number = 0.002) {
        this.manualYaw -= dx * sensitivity;
        this.manualPitch -= dy * sensitivity;

        // Clamp Pitch
        const limit = Math.PI / 3; // 60 degrees
        this.manualPitch = THREE.MathUtils.clamp(this.manualPitch, -limit, limit);

        // Clamp Yaw to avoid getting lost? (Optional, maybe +/- 90 degrees)
        const yawLimit = Math.PI / 1.5; // 120 degrees
        this.manualYaw = THREE.MathUtils.clamp(this.manualYaw, -yawLimit, yawLimit);
    }

    private updateGameOver(delta: number) {
        this.gameOverTime += delta;

        // Requirement:
        // Rotate 125 deg around UP
        // Rotate 25 deg around Move Direction (which is Local -Z)
        // Continue smooth rotation (around UP presumably)

        const T_TRANSITION = 0.8; // Seconds to perform the initial swoop
        const SPIN_SPEED = 0.2; // Radians per second for continuous spin

        let progress = Math.min(this.gameOverTime / T_TRANSITION, 1.0);
        // Ease out cubic
        progress = 1 - Math.pow(1 - progress, 3);

        // Target offsets
        const targetYaw = THREE.MathUtils.degToRad(125);
        const targetRoll = THREE.MathUtils.degToRad(25);

        // Calculate current offsets
        // Combine the "swoop" (ease-out) with the continuous spin (linear)
        // This ensures that when the swoop ends (velocity 0), the total velocity matches the spin speed
        let currentYaw = (targetYaw * progress) + (this.gameOverTime * SPIN_SPEED);

        // Direction of movement is -Z. Local Up is Y.
        // Rotating around -Z (Direction) by 25 deg.
        const currentRoll = targetRoll * progress;

        // Compose Rotation
        // Q = Base * Yaw * Roll

        // Yaw (around Y)
        const qYaw = new THREE.Quaternion();
        qYaw.setFromAxisAngle(new THREE.Vector3(0, 1, 0), currentYaw);

        // Roll (around -Z)
        // We want around -Z (Direction). So axis (0,0,-1)
        const qRoll = new THREE.Quaternion();
        qRoll.setFromAxisAngle(new THREE.Vector3(0, 0, -1), currentRoll);

        // Apply to Rig
        // Order: Base -> Yaw (in local Y of Rig?) or Global Y?
        // User said "around up vector of snake". Snake is aligned with Rig. So Rig Local Y.
        // "Around direction of movement". Rig Local -Z.

        this.cameraRig.quaternion.copy(this.gameOverBaseQuat).multiply(qYaw).multiply(qRoll);

        // Apply to Camera (update position based on rig)
        this.updateCameraFromRig(delta);
    }
}
