/**
 * ReplaySystem - система записи и воспроизведения игровых сессий
 * 
 * Новая модель: записываем точки изменения траектории (позиция + направление),
 * а не тики. Это делает воспроизведение независимым от тик-рейта.
 */

import * as THREE from 'three';
import type { Vec3, TrajectoryChange, ReplayData, StartParams } from '../types/replay';

/**
 * Конвертация THREE.Vector3 в сериализуемый Vec3
 */
function toVec3(v: THREE.Vector3): Vec3 {
    return { x: v.x, y: v.y, z: v.z };
}

/**
 * Конвертация Vec3 в THREE.Vector3
 */
function fromVec3(v: Vec3): THREE.Vector3 {
    return new THREE.Vector3(v.x, v.y, v.z);
}

/**
 * ReplayRecorder - записывает траекторию игрока
 * 
 * Записывает только точки изменения направления:
 * - Позиция в момент поворота
 * - Новый вектор направления
 */
export class ReplayRecorder {
    private trajectoryLog: TrajectoryChange[] = [];
    private startParams: StartParams;
    private isRecording: boolean = false;
    private lastDirection: THREE.Vector3 = new THREE.Vector3();

    constructor(seed: number, spawnIndex: number, initialSpeed: number = 300) {
        this.startParams = { seed, spawnIndex, initialSpeed };
    }

    /**
     * Начать запись
     */
    public start(initialDirection: THREE.Vector3, startPosition: THREE.Vector3): void {
        this.trajectoryLog = [];
        this.lastDirection.copy(initialDirection);

        // Сохраняем точные параметры старта
        this.startParams.startDirection = toVec3(initialDirection);
        this.startParams.startPosition = toVec3(startPosition);

        this.isRecording = true;
        console.log('[ReplayRecorder] Recording started');
    }

    /**
     * Остановить запись
     */
    public stop(): void {
        this.isRecording = false;
        console.log(`[ReplayRecorder] Recording stopped. Total trajectory changes: ${this.trajectoryLog.length}`);
    }

    /**
     * Записать изменение направления
     * @param position Позиция головы в момент поворота
     * @param newDirection Новый вектор направления (единичный)
     */
    public recordDirectionChange(position: THREE.Vector3, newDirection: THREE.Vector3): void {
        if (!this.isRecording) return;

        // Проверяем, изменилось ли направление
        if (newDirection.equals(this.lastDirection)) return;

        this.trajectoryLog.push({
            position: toVec3(position),
            direction: toVec3(newDirection)
        });

        this.lastDirection.copy(newDirection);
        console.log(`[ReplayRecorder] Direction change at (${position.x}, ${position.y}, ${position.z}) -> (${newDirection.x}, ${newDirection.y}, ${newDirection.z})`);
    }

    /**
     * Получить данные для сохранения реплея
     */
    public getReplayData(finalScore: number, deathPosition: THREE.Vector3, playerName: string): Partial<ReplayData> {
        return {
            startParams: this.startParams,
            finalScore,
            deathPosition: toVec3(deathPosition),
            trajectoryLog: [...this.trajectoryLog],
            playerName
        };
    }

    /**
     * Сбросить состояние записи
     */
    public reset(seed: number, spawnIndex: number, initialSpeed: number = 300): void {
        this.trajectoryLog = [];
        this.startParams = { seed, spawnIndex, initialSpeed };
        this.isRecording = false;
    }

    /**
     * Получить количество записанных изменений
     */
    public getChangeCount(): number {
        return this.trajectoryLog.length;
    }
}

/**
 * ReplayPlayer - воспроизводитель записанных игр
 * 
 * Воспроизводит траекторию по точкам изменения направления.
 * Фантом движется по текущему направлению, пока не достигнет
 * следующей точки поворота в логе.
 */
export class ReplayPlayer {
    private trajectoryLog: TrajectoryChange[];
    private currentIndex: number = 0;
    public readonly startParams: StartParams;
    public readonly deathPosition: THREE.Vector3;
    public readonly replayId: string;
    private readonly finalScore: number;
    private readonly playerId: string;
    private readonly playerName: string;
    private isDead: boolean = false;

    // Текущее направление движения
    private currentDirection: THREE.Vector3 = new THREE.Vector3();

    constructor(replayData: ReplayData) {
        this.trajectoryLog = replayData.trajectoryLog;
        this.startParams = replayData.startParams;
        this.deathPosition = fromVec3(replayData.deathPosition);
        this.replayId = replayData.id;
        this.finalScore = replayData.finalScore;
        this.playerId = replayData.playerId;
        this.playerName = replayData.playerName || 'Unknown';
    }

    /**
     * Проверить и обновить направление на основе текущей позиции
     * Вызывается каждый шаг фантома
     * @param currentPosition Текущая позиция головы фантома
     * @returns Новое направление, если нужно изменить, или null
     */
    public checkDirectionChange(currentPosition: THREE.Vector3): THREE.Vector3 | null {
        if (this.isDead) return null;

        // Проверяем смерть
        if (currentPosition.distanceToSquared(this.deathPosition) < 0.5) {
            this.isDead = true;
            console.log(`[ReplayPlayer] Phantom ${this.replayId} died at (${currentPosition.x}, ${currentPosition.y}, ${currentPosition.z})`);
            return null;
        }

        let lastFoundDirection: THREE.Vector3 | null = null;

        // Проверяем, достигли ли следующей точки поворота
        // Loop through ALL changes at this position to handle rapid turns (multiple turns within one step)
        while (this.currentIndex < this.trajectoryLog.length) {
            const nextChange = this.trajectoryLog[this.currentIndex];
            const targetPos = fromVec3(nextChange.position);

            // Если достигли точки поворота (с небольшим допуском)
            if (currentPosition.distanceToSquared(targetPos) < 0.5) {
                const newDirection = fromVec3(nextChange.direction);
                this.currentDirection.copy(newDirection);
                this.currentIndex++;
                lastFoundDirection = newDirection;

                console.log(`[ReplayPlayer] Phantom ${this.replayId} processed direction change at (${currentPosition.x}, ${currentPosition.y}, ${currentPosition.z})`);
            } else {
                // Next change is at a different position
                break;
            }
        }

        return lastFoundDirection;
    }

    /**
     * Получить текущее направление
     */
    public getCurrentDirection(): THREE.Vector3 {
        return this.currentDirection.clone();
    }

    /**
     * Установить начальное направление
     */
    public setInitialDirection(direction: THREE.Vector3): void {
        this.currentDirection.copy(direction);
    }

    /**
     * Проверить, умер ли фантом
     */
    public isDeadNow(): boolean {
        return this.isDead;
    }

    /**
     * Сбросить воспроизведение
     */
    public reset(): void {
        this.currentIndex = 0;
        this.isDead = false;
        this.currentDirection.set(0, 0, 0);
    }

    /**
     * Получить финальный счёт
     */
    public getFinalScore(): number {
        return this.finalScore;
    }

    /**
     * Получить ID игрока
     */
    public getPlayerId(): string {
        return this.playerId;
    }

    /**
     * Получить имя игрока
     */
    public getPlayerName(): string {
        return this.playerName;
    }

    /**
     * Получить начальную скорость из реплея
     */
    public getInitialSpeed(): number {
        return this.startParams.initialSpeed;
    }
}

// Экспорт вспомогательных функций
export { toVec3, fromVec3 };
