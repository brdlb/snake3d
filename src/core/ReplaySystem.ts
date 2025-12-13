/**
 * ReplaySystem - система записи и воспроизведения игровых сессий
 * 
 * Записывает только изменения состояний (повороты), что даёт
 * экстремально малый размер файла реплея.
 */

import type { InputEvent, InputDirection, ReplayData, StartParams } from '../types/replay';

export class ReplayRecorder {
    private inputLog: InputEvent[] = [];
    private currentTick: number = 0;
    private startParams: StartParams;
    private isRecording: boolean = false;

    constructor(seed: number, spawnIndex: number = 0) {
        this.startParams = { seed, spawnIndex };
    }

    /**
     * Начать запись
     */
    public start(): void {
        this.inputLog = [];
        this.currentTick = 0;
        this.isRecording = true;
        console.log('[ReplayRecorder] Recording started');
    }

    /**
     * Остановить запись
     */
    public stop(): void {
        this.isRecording = false;
        console.log(`[ReplayRecorder] Recording stopped. Total inputs: ${this.inputLog.length}`);
    }

    /**
     * Обновить тик (вызывается каждый шаг змейки)
     */
    public tick(): void {
        if (this.isRecording) {
            this.currentTick++;
        }
    }

    /**
     * Записать событие ввода
     */
    public recordInput(direction: InputDirection): void {
        if (!this.isRecording) return;

        this.inputLog.push([this.currentTick, direction]);
        console.log(`[ReplayRecorder] Input recorded: tick=${this.currentTick}, dir=${direction}`);
    }

    /**
     * Получить текущий тик
     */
    public getCurrentTick(): number {
        return this.currentTick;
    }

    /**
     * Получить данные для сохранения реплея
     */
    public getReplayData(finalScore: number): Partial<ReplayData> {
        return {
            startParams: this.startParams,
            finalScore,
            deathTick: this.currentTick,
            inputLog: [...this.inputLog]
        };
    }

    /**
     * Сбросить состояние записи
     */
    public reset(seed: number, spawnIndex: number = 0): void {
        this.inputLog = [];
        this.currentTick = 0;
        this.startParams = { seed, spawnIndex };
        this.isRecording = false;
    }
}

/**
 * ReplayPlayer - воспроизводитель записанных игр
 */
export class ReplayPlayer {
    private inputLog: InputEvent[];
    private currentIndex: number = 0;
    private currentTick: number = 0;
    public readonly startParams: StartParams;
    public readonly deathTick: number;
    public readonly replayId: string;
    private isDead: boolean = false;

    constructor(replayData: ReplayData) {
        this.inputLog = replayData.inputLog;
        this.startParams = replayData.startParams;
        this.deathTick = replayData.deathTick;
        this.replayId = replayData.id;
    }

    /**
     * Обновить тик и получить действие, если оно есть
     * Возвращает направление поворота или null
     */
    public tick(): InputDirection | null {
        if (this.isDead) return null;

        this.currentTick++;

        // Проверяем, достиг ли фантом момента смерти
        if (this.currentTick >= this.deathTick) {
            this.isDead = true;
            console.log(`[ReplayPlayer] Phantom ${this.replayId} died at tick ${this.currentTick}`);
            return null;
        }

        // Проверяем, есть ли действие на этом тике
        if (this.currentIndex < this.inputLog.length) {
            const [eventTick, direction] = this.inputLog[this.currentIndex];

            if (eventTick === this.currentTick) {
                this.currentIndex++;
                return direction;
            }
        }

        return null;
    }

    /**
     * Проверить, умер ли фантом
     */
    public isDeadNow(): boolean {
        return this.isDead;
    }

    /**
     * Получить текущий тик
     */
    public getCurrentTick(): number {
        return this.currentTick;
    }

    /**
     * Сбросить воспроизведение
     */
    public reset(): void {
        this.currentIndex = 0;
        this.currentTick = 0;
        this.isDead = false;
    }
}
