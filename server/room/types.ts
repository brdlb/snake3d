/**
 * Типы данных для системы комнат и реплеев
 */

// Направление движения змейки
export type Direction = 'UP' | 'DOWN' | 'LEFT' | 'RIGHT' | 'FORWARD' | 'BACK';

// Событие ввода: [тик, направление]
export type InputEvent = [number, Direction];

// Параметры старта игры
export interface StartParams {
    seed: number;
    spawnIndex: number;
}

// Полные данные реплея
export interface ReplayData {
    id: string;
    playerId: string;
    timestamp: number;
    startParams: StartParams;
    finalScore: number;
    deathTick: number;
    inputLog: InputEvent[];
}

// Краткая информация о фантоме для meta.json
export interface PhantomInfo {
    replayId: string;
    score: number;
    deathTick: number;
}

// Метаданные комнаты
export interface RoomMeta {
    seed: string;
    total_games_played: number;
    active_phantoms: PhantomInfo[];
    // История всех игроков (для правила "One Attempt")
    players_history: string[];
}

// Данные для отправки клиенту
export interface RoomData {
    seed: number;
    phantoms: ReplayData[];
}

// Результат игры от клиента
export interface GameOverPayload {
    seed: number;
    replay: ReplayData;
}
