/**
 * Phantom - сущность фантома (запись прошлой игры)
 * 
 * Визуально похож на змейку, но управляется через ReplayPlayer.
 * Имеет призрачный/полупрозрачный внешний вид.
 * 
 * Новая модель: движение управляется точками изменения траектории,
 * а не тиками. Фантом движется по текущему направлению пока не
 * достигнет следующей точки поворота.
 */

import * as THREE from 'three';
import { ReplayPlayer, fromVec3 } from '../core/ReplaySystem';
import type { ReplayData } from '../types/replay';
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

    // Phantom's own speed tracking
    private currentSPM: number = 300;

    // Phantom's current score (tracked during gameplay)
    private currentScore: number = 0;

    // Текущий вектор направления движения (единичный, snap to grid)
    private moveDirection: THREE.Vector3 = new THREE.Vector3();

    // Temporary vectors для оптимизации
    private _tempVec: THREE.Vector3 = new THREE.Vector3();

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

        // Используем начальную скорость из реплея
        this.currentSPM = this.replayPlayer.getInitialSpeed();

        // Инициализация позиции на основе spawnIndex
        this.reset();
    }

    /**
     * Сбросить состояние фантома
     */
    public reset(): void {
        const params = this.replayPlayer.startParams;

        let position: THREE.Vector3;
        let directionQuat: THREE.Quaternion;
        let moveDir: THREE.Vector3;

        if (params.startPosition && params.startDirection) {
            // Use recorded start parameters if available (prevents desync on map changes)
            position = fromVec3(params.startPosition);
            moveDir = fromVec3(params.startDirection);

            // Reconstruct quaternion from look direction (approximate but enough for visuals)
            // Or just rely on moveDirection which is the primary driver
            const tempDir = moveDir.clone().negate(); // Forward is -Z relative to model
            const up = new THREE.Vector3(0, 1, 0);
            const matrix = new THREE.Matrix4();
            matrix.lookAt(new THREE.Vector3(0, 0, 0), tempDir, up);
            directionQuat = new THREE.Quaternion().setFromRotationMatrix(matrix);
        } else {
            // Fallback to legacy spawn index system
            const spawnIndex = params.spawnIndex % SPAWN_POINTS.length;
            const spawn = getSpawnPoint(spawnIndex);
            position = spawn.position.clone();
            directionQuat = spawn.direction.clone();

            moveDir = new THREE.Vector3(0, 0, -1).applyQuaternion(directionQuat);
            this.snapDirectionToGrid(moveDir);
        }

        this.direction.copy(directionQuat);
        this.moveDirection.copy(moveDir);

        // Ensure replay player knows the correct initial direction
        this.replayPlayer.setInitialDirection(this.moveDirection);

        // Вычисляем вектор "назад" для размещения хвоста
        const backVector = this.moveDirection.clone().negate();

        this.segments = [];
        this.segments.push(position.clone());
        this.segments.push(position.clone().add(backVector.clone()));
        this.segments.push(position.clone().add(backVector.clone().multiplyScalar(2)));

        this.accumulatedTime = 0;
        this.growthPending = 0;
        this.isDead = false;
        this.currentSPM = this.replayPlayer.getInitialSpeed();
        this.currentScore = 0;

        this.replayPlayer.reset();
    }

    /**
     * Привязать направление к сетке (единичный вектор по одной оси)
     */
    private snapDirectionToGrid(dir: THREE.Vector3): void {
        if (Math.abs(dir.x) > 0.5) dir.set(Math.sign(dir.x), 0, 0);
        else if (Math.abs(dir.y) > 0.5) dir.set(0, Math.sign(dir.y), 0);
        else dir.set(0, 0, Math.sign(dir.z));
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

            // Проверяем, нужно ли изменить направление (по позиции)
            const currentHead = this.getHead();
            const newDirection = this.replayPlayer.checkDirectionChange(currentHead);

            // Проверяем смерть по реплею
            if (this.replayPlayer.isDeadNow()) {
                this.isDead = true;
                return false;
            }

            // Применяем новое направление если есть
            if (newDirection) {
                this.setMoveDirection(newDirection);
            }

            // Делаем шаг
            this.step();
            return true;
        }

        return false;
    }

    /**
     * Установить новое направление движения
     */
    private setMoveDirection(newDir: THREE.Vector3): void {
        this.moveDirection.copy(newDir);
        this.snapDirectionToGrid(this.moveDirection);

        // Обновляем кватернион для визуализации головы
        // Направление "вперёд" это -Z, поэтому инвертируем
        this._tempVec.copy(this.moveDirection).negate();

        // Создаём кватернион из направления
        const up = new THREE.Vector3(0, 1, 0);
        const matrix = new THREE.Matrix4();
        matrix.lookAt(new THREE.Vector3(0, 0, 0), this._tempVec, up);
        this.direction.setFromRotationMatrix(matrix);
    }

    /**
     * Сделать шаг вперёд
     */
    private step(): void {
        let newHead: THREE.Vector3;

        if (this.growthPending > 0) {
            newHead = new THREE.Vector3();
            this.growthPending--;
        } else {
            const tail = this.segments.pop();
            newHead = tail || new THREE.Vector3();
        }

        newHead.copy(this.segments[0]).add(this.moveDirection);
        this.segments.unshift(newHead);
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

    /**
     * Получить текущую скорость фантома (SPM)
     */
    public getSPM(): number {
        return this.currentSPM;
    }

    /**
     * Получить текущий счёт фантома
     */
    public getScore(): number {
        return this.currentScore;
    }

    /**
     * Добавить очки к текущему счёту
     */
    public addScore(points: number): void {
        this.currentScore += points;
    }

    /**
     * Получить ID игрока
     */
    public getPlayerId(): string {
        return this.replayPlayer.getPlayerId();
    }

    /**
     * Получить имя игрока
     */
    public getPlayerName(): string {
        return this.replayPlayer.getPlayerName();
    }

    /**
     * Получить hex цвет
     */
    public getColorHex(): string {
        return '#' + this.phantomColor.getHexString();
    }

    /**
     * Получить текущее направление движения
     */
    public getMoveDirection(): THREE.Vector3 {
        return this.moveDirection.clone();
    }
}
