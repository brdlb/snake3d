/**
 * Общие типы для системы реплеев (клиентская версия)
 * 
 * Новая модель: записываем точки изменения траектории,
 * а не тики. Это делает воспроизведение независимым от тик-рейта.
 */

// 3D вектор для хранения (сериализуемый)
export interface Vec3 {
    x: number;
    y: number;
    z: number;
}

// Событие изменения траектории: позиция + новое направление
export interface TrajectoryChange {
    position: Vec3;    // Точка, в которой произошёл поворот
    direction: Vec3;   // Новый вектор направления (нормализованный, единичный)
}

// Параметры старта игры
export interface StartParams {
    seed: number;
    spawnIndex: number;
    initialSpeed: number;  // Начальная скорость (SPM - steps per minute)
    startPosition?: Vec3;  // Точная начальная позиция (для совместимости с изменениями карты)
    startDirection?: Vec3; // Точное начальное направление
}

// Полные данные реплея
export interface ReplayData {
    id: string;
    playerId: string;
    playerName: string;
    timestamp: number;
    startParams: StartParams;
    finalScore: number;
    elo?: number;                  // ELO игрока на момент записи
    deathPosition: Vec3;           // Позиция смерти
    trajectoryLog: TrajectoryChange[];  // Лог изменений траектории
}

// Данные комнаты от сервера
export interface RoomData {
    seed: number;
    phantoms: ReplayData[];
    playerSpawnIndex: number; // Назначенная сервером точка спавна (0-3)
}

// Payload для отправки результата игры на сервер
export interface GameOverPayload {
    seed: number;
    replay: Partial<ReplayData>;
}

// === Устаревшие типы (для обратной совместимости, удалить позже) ===
export type InputDirection = 'TURN_LEFT' | 'TURN_RIGHT' | 'ROLL_LEFT' | 'ROLL_RIGHT';
export type InputEvent = [number, InputDirection];
