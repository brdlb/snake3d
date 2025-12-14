/**
 * RoomService - бизнес-логика для работы с комнатами
 */

import {
    getActiveReplays,
    addReplayToRoom,
    getAllRoomSeeds,
    getRoomMeta,
    hasPlayerPlayedInRoom,
    assignSpawnIndex
} from './RoomRepository.js';
import type { ReplayData, RoomData, GameOverPayload } from './types.js';

/**
 * Получить данные комнаты для клиента (seed + активные фантомы + назначенная точка спавна)
 */
export async function getRoomData(seed: number): Promise<RoomData> {
    const seedStr = seed.toString();

    // Назначаем точку спавна для игрока
    const { spawnIndex } = await assignSpawnIndex(seedStr);

    // Получаем оставшихся активных фантомов (после возможного вытеснения)
    const phantoms = await getActiveReplays(seedStr);

    console.log(`[RoomService] getRoomData for seed ${seed}: ${phantoms.length} phantoms, player spawn: ${spawnIndex}`);

    return {
        seed,
        phantoms,
        playerSpawnIndex: spawnIndex
    };
}

/**
 * Найти комнату для игрока
 * 
 * Логика "One Attempt":
 * 1. Ищем комнату, в которой игрок ещё не играл
 * 2. Если все комнаты уже сыграны — генерируем новый случайный seed
 * 3. Возвращаем данные найденной/новой комнаты
 */
export async function findRoomForPlayer(playerId: string): Promise<RoomData> {
    const allSeeds = await getAllRoomSeeds();

    console.log(`[RoomService] Finding room for player ${playerId.substring(0, 8)}... (${allSeeds.length} rooms exist)`);

    // Ищем комнаты, в которых игрок ещё не играл
    const unplayedSeeds: string[] = [];

    for (const seed of allSeeds) {
        const hasPlayed = await hasPlayerPlayedInRoom(seed, playerId);
        if (!hasPlayed) {
            unplayedSeeds.push(seed);
        }
    }

    console.log(`[RoomService] Player ${playerId.substring(0, 8)} has ${unplayedSeeds.length} unplayed rooms`);

    if (unplayedSeeds.length > 0) {
        // Выбираем случайную несыгранную комнату
        const randomIndex = Math.floor(Math.random() * unplayedSeeds.length);
        const selectedSeed = unplayedSeeds[randomIndex];

        console.log(`[RoomService] Selected existing room: ${selectedSeed}`);
        return getRoomData(parseInt(selectedSeed, 10));
    }

    // Все комнаты сыграны — генерируем новую
    const newSeed = generateRandomSeed();
    console.log(`[RoomService] All rooms played, generating new seed: ${newSeed}`);

    // В новой комнате игрок получает точку спавна 0
    return {
        seed: newSeed,
        phantoms: [],
        playerSpawnIndex: 0
    };
}

/**
 * Обработать завершение игры
 * Валидирует и потенциально сохраняет реплей
 */
export async function processGameOver(playerId: string, payload: GameOverPayload): Promise<{ saved: boolean; message: string }> {
    const { seed, replay } = payload;
    const seedStr = seed.toString();

    // Базовая валидация - проверяем новую модель данных
    if (!replay || !replay.trajectoryLog || !Array.isArray(replay.trajectoryLog)) {
        return { saved: false, message: 'Invalid replay data' };
    }

    if (!replay.startParams || typeof replay.startParams.spawnIndex !== 'number') {
        return { saved: false, message: 'Invalid start params' };
    }

    if (replay.finalScore === undefined || replay.finalScore < 0) {
        return { saved: false, message: 'Invalid score' };
    }

    if (!replay.deathPosition) {
        return { saved: false, message: 'Missing death position' };
    }

    // Генерируем уникальный ID для реплея
    const replayId = `replay_${playerId.substring(0, 8)}_${Date.now()}`;

    const completeReplay: ReplayData = {
        id: replayId,
        playerId,
        playerName: replay.playerName || `Player_${playerId.substring(0, 4)}`,
        timestamp: Date.now(),
        startParams: replay.startParams,
        finalScore: replay.finalScore,
        deathPosition: replay.deathPosition,
        trajectoryLog: replay.trajectoryLog
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
 * Вывести сводную информацию о всех комнатах
 */
export async function logRoomsSummary(): Promise<void> {
    const seeds = await getAllRoomSeeds();

    console.log('\n╔════════════ ROOMS SUMMARY ════════════╗');
    console.log('║  Seed  │ Phantoms │ Total Games Played ║');
    console.log('╟────────┼──────────┼────────────────────╢');

    if (seeds.length === 0) {
        console.log('║        │ NO ROOMS │                    ║');
    } else {
        for (const seed of seeds) {
            const meta = await getRoomMeta(seed);
            const seedPad = seed.substring(0, 6).padEnd(6, ' ');
            const phantomsPad = meta.active_phantoms.length.toString().padEnd(8, ' ');
            const totalPad = meta.total_games_played.toString().padEnd(18, ' ');
            console.log(`║ ${seedPad} │ ${phantomsPad} │ ${totalPad} ║`);
        }
    }
    console.log('╚═══════════════════════════════════════╝\n');
}
