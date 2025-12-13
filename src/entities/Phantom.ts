/**
 * Phantom - сущность фантома (запись прошлой игры)
 * 
 * Визуально похож на змейку, но управляется через ReplayPlayer.
 * Имеет призрачный/полупрозрачный внешний вид.
 */

import * as THREE from 'three';
import { ReplayPlayer } from '../core/ReplaySystem';
import type { ReplayData, InputDirection } from '../types/replay';
import { getSpawnPoint, SPAWN_POINTS } from './SpawnPoints';

export class Phantom {
    public segments: THREE.Vector3[] = [];
    public direction: THREE.Quaternion = new THREE.Quaternion();
    public readonly replayPlayer: ReplayPlayer;
    public readonly phantomColor: THREE.Color;

    private moveInterval: number = 0.20;
    private accumulatedTime: number = 0;
    private growthPending: number = 0;
    private isDead: boolean = false;

    // Phantom's own speed tracking (starts at 300 SPM like player)
    private currentSPM: number = 300;

    // Temporary vectors для оптимизации
    private _tempVec: THREE.Vector3 = new THREE.Vector3();
    private _tempQuat: THREE.Quaternion = new THREE.Quaternion();
    private _axis: THREE.Vector3 = new THREE.Vector3();
    private lastStepVector: THREE.Vector3 = new THREE.Vector3(0, 0, -1);

    constructor(replayData: ReplayData, colorIndex: number = 0) {
        this.replayPlayer = new ReplayPlayer(replayData);

        // Призрачные цвета для разных фантомов
        const phantomColors = [
            0x88ffff, // Cyan ghost
            0xff88ff, // Magenta ghost
            0xffff88, // Yellow ghost
            0x88ff88, // Green ghost
        ];
        this.phantomColor = new THREE.Color(phantomColors[colorIndex % phantomColors.length]);

        // Инициализация позиции на основе spawnIndex
        this.reset();
    }

    /**
     * Сбросить состояние фантома
     */
    public reset(): void {
        const spawnIndex = this.replayPlayer.startParams.spawnIndex % SPAWN_POINTS.length;
        const spawn = getSpawnPoint(spawnIndex);

        this.direction.copy(spawn.direction);

        // Вычисляем вектор "назад" для размещения хвоста
        const backVector = new THREE.Vector3(0, 0, 1).applyQuaternion(this.direction);

        this.segments = [];
        this.segments.push(spawn.position.clone());
        this.segments.push(spawn.position.clone().add(backVector.clone()));
        this.segments.push(spawn.position.clone().add(backVector.clone().multiplyScalar(2)));

        this.lastStepVector.set(0, 0, -1).applyQuaternion(this.direction);
        this.accumulatedTime = 0;
        this.growthPending = 0;
        this.isDead = false;
        this.currentSPM = 300; // Reset speed to default

        this.replayPlayer.reset();
    }

    /**
     * Apply food effect to phantom (speed change based on food color)
     * @param spmChange - Speed change in steps per minute (positive = faster, negative = slower)
     */
    public applyFoodEffect(spmChange: number): void {
        this.currentSPM += spmChange;
        if (this.currentSPM < 60) this.currentSPM = 60; // Minimum speed cap
    }

    /**
     * Обновить состояние фантома
     * Возвращает true если фантом сделал шаг
     */
    public update(delta: number): boolean {
        if (this.isDead) return false;

        // Update move interval based on phantom's own speed
        this.moveInterval = 60 / this.currentSPM;

        this.accumulatedTime += delta;

        if (this.accumulatedTime >= this.moveInterval) {
            this.accumulatedTime -= this.moveInterval;

            // Получаем действие из реплея
            const action = this.replayPlayer.tick();

            // Проверяем смерть по реплею
            if (this.replayPlayer.isDeadNow()) {
                this.isDead = true;
                return false;
            }

            // Применяем действие
            if (action) {
                this.applyAction(action);
            }

            // Делаем шаг
            this.step();
            return true;
        }

        return false;
    }

    /**
     * Применить действие из реплея
     */
    private applyAction(action: InputDirection): void {
        switch (action) {
            case 'TURN_LEFT':
                this.rotate(Math.PI / 2);
                break;
            case 'TURN_RIGHT':
                this.rotate(-Math.PI / 2);
                break;
            case 'ROLL_LEFT':
                this.roll(-Math.PI / 2);
                break;
            case 'ROLL_RIGHT':
                this.roll(Math.PI / 2);
                break;
        }
    }

    /**
     * Сделать шаг вперёд
     */
    private step(): void {
        this._tempVec.set(0, 0, -1).applyQuaternion(this.direction);

        // Snap to grid
        if (Math.abs(this._tempVec.x) > 0.5) this._tempVec.set(Math.sign(this._tempVec.x), 0, 0);
        else if (Math.abs(this._tempVec.y) > 0.5) this._tempVec.set(0, Math.sign(this._tempVec.y), 0);
        else this._tempVec.set(0, 0, Math.sign(this._tempVec.z));

        this.lastStepVector.copy(this._tempVec);

        let newHead: THREE.Vector3;

        if (this.growthPending > 0) {
            newHead = new THREE.Vector3();
            this.growthPending--;
        } else {
            const tail = this.segments.pop();
            newHead = tail || new THREE.Vector3();
        }

        newHead.copy(this.segments[0]).add(this._tempVec);
        this.segments.unshift(newHead);
    }

    /**
     * Поворот влево/вправо
     */
    private rotate(angle: number): void {
        this._axis.set(0, 1, 0);
        this._tempQuat.setFromAxisAngle(this._axis, angle);

        const nextQuat = this.direction.clone().multiply(this._tempQuat).normalize();
        const nextForward = new THREE.Vector3(0, 0, -1).applyQuaternion(nextQuat);

        if (nextForward.dot(this.lastStepVector) < -0.5) {
            return;
        }

        this.direction.copy(nextQuat);
    }

    /**
     * Крен влево/вправо
     */
    private roll(angle: number): void {
        this._axis.set(0, 0, -1);
        this._tempQuat.setFromAxisAngle(this._axis, angle);
        this.direction.multiply(this._tempQuat);
        this.direction.normalize();
    }

    /**
     * Добавить рост
     */
    public grow(): void {
        this.growthPending++;
    }

    /**
     * Получить позицию головы
     */
    public getHead(): THREE.Vector3 {
        return this.segments[0];
    }

    /**
     * Проверить, мёртв ли фантом
     */
    public isDeadNow(): boolean {
        return this.isDead;
    }

    /**
     * Убить фантома (например, при столкновении)
     */
    public kill(): void {
        this.isDead = true;
    }

    /**
     * Получить прогресс шага для интерполяции
     */
    public getStepProgress(): number {
        return Math.min(this.accumulatedTime / this.moveInterval, 1.0);
    }
}
