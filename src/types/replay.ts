/**
 * Общие типы для системы реплеев (клиентская версия)
 */

// Направление движения — используем кватернионы для 3D
// Но для записи сохраняем в виде строк осей + знаков
export type InputDirection = 'TURN_LEFT' | 'TURN_RIGHT' | 'ROLL_LEFT' | 'ROLL_RIGHT';

// Событие ввода: [тик, действие]
export type InputEvent = [number, InputDirection];

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

// Данные комнаты от сервера
export interface RoomData {
    seed: number;
    phantoms: ReplayData[];
}

// Payload для отправки результата игры на сервер
export interface GameOverPayload {
    seed: number;
    replay: Partial<ReplayData>;
}
