/**
 * Типы данных для системы комнат и реплеев (серверная версия)
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
    deathPosition: Vec3;           // Позиция смерти
    trajectoryLog: TrajectoryChange[];  // Лог изменений траектории
}

// Краткая информация о фантоме для meta.json
export interface PhantomInfo {
    replayId: string;
    score: number;
    spawnIndex: number; // Индекс точки спавна (0-3)
    playerId?: string;   // ID игрока (опционально для обратной совместимости)
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
    playerSpawnIndex: number; // Назначенная сервером точка спавна (0-3)
}

// Результат игры от клиента
export interface GameOverPayload {
    seed: number;
    replay: Partial<ReplayData>;
}

export interface LeaderboardEntry {
    playerName: string;
    score: number;
    seed: number;
    date: number;
    replayId: string;
}
