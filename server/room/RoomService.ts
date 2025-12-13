/**
 * RoomService - бизнес-логика для работы с комнатами
 */

import { getActiveReplays, addReplayToRoom, getRoomMeta } from './RoomRepository.js';
import type { ReplayData, RoomData, GameOverPayload } from './types.js';

/**
 * Получить данные комнаты для клиента (seed + активные фантомы)
 */
export async function getRoomData(seed: number): Promise<RoomData> {
    const seedStr = seed.toString();
    const phantoms = await getActiveReplays(seedStr);

    console.log(`[RoomService] getRoomData for seed ${seed}: ${phantoms.length} phantoms`);

    return {
        seed,
        phantoms
    };
}

/**
 * Обработать завершение игры
 * Валидирует и потенциально сохраняет реплей
 */
export async function processGameOver(playerId: string, payload: GameOverPayload): Promise<{ saved: boolean; message: string }> {
    const { seed, replay } = payload;
    const seedStr = seed.toString();

    // Базовая валидация
    if (!replay || !replay.inputLog || !Array.isArray(replay.inputLog)) {
        return { saved: false, message: 'Invalid replay data' };
    }

    if (replay.finalScore < 0) {
        return { saved: false, message: 'Invalid score' };
    }

    // Минимальная длина игры (хотя бы 1 секунда / ~5 тиков)
    if (replay.deathTick < 5) {
        return { saved: false, message: 'Game too short' };
    }

    // Генерируем уникальный ID для реплея
    const replayId = `replay_${playerId.substring(0, 8)}_${Date.now()}`;

    const completeReplay: ReplayData = {
        ...replay,
        id: replayId,
        playerId,
        timestamp: Date.now()
    };

    // Пытаемся добавить реплей в комнату
    const saved = await addReplayToRoom(seedStr, completeReplay);

    if (saved) {
        return { saved: true, message: 'Replay saved! You are now a phantom in this room.' };
    } else {
        return { saved: false, message: 'Your score was not high enough to become a phantom.' };
    }
}

/**
 * Сгенерировать случайный seed для новой комнаты
 */
export function generateRandomSeed(): number {
    return Math.floor(Math.random() * 1000000);
}

/**
 * Проверить, играл ли игрок уже в этой комнате
 * (Для полной реализации "One Attempt" правила)
 */
export async function hasPlayerPlayedRoom(playerId: string, seed: number): Promise<boolean> {
    const seedStr = seed.toString();
    const meta = await getRoomMeta(seedStr);

    // Проверяем, есть ли реплей этого игрока среди активных
    // Для полной реализации нужно хранить историю всех игроков
    // Пока проверяем только активных фантомов
    for (const phantom of meta.active_phantoms) {
        if (phantom.replayId.includes(playerId.substring(0, 8))) {
            return true;
        }
    }

    return false;
}
