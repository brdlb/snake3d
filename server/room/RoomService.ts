/**
 * RoomService - бизнес-логика для работы с комнатами
 */

import { getActiveReplays, addReplayToRoom, getAllRoomSeeds, getRoomMeta, hasPlayerPlayedInRoom, assignSpawnIndex, getReplay } from './RoomRepository.js';
import type { ReplayData, RoomData, GameOverPayload, LeaderboardEntry } from './types.js';
import type { AuthManager } from '../auth.js';

/**
 * Получить данные комнаты для клиента (seed + активные фантомы + назначенная точка спавна)
 */
export async function getRoomData(seed: number, playerId?: string): Promise<RoomData> {
    const seedStr = seed.toString();

    // Назначаем точку спавна для игрока (с учетом его фантома, если есть)
    const { spawnIndex } = await assignSpawnIndex(seedStr, playerId);

    // Получаем оставшихся активных фантомов (исключая фантома игрока, так как он его "занимает")
    const phantoms = await getActiveReplays(seedStr, playerId);

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
 * Логика "ELO-based":
 * 1. Ищем комнаты (включая те, в которых играли), где средний ELO ближе всего к игроку
 * 2. Если разница ELO слишком большая (>500) или комнат нет — генерируем новую
 */
export async function findRoomForPlayer(playerId: string, playerElo: number = 1000): Promise<RoomData> {
    const allSeeds = await getAllRoomSeeds();
    const MAX_ELO_DIFF = 500;

    console.log(`[RoomService] Finding room for player ${playerId.substring(0, 8)} (ELO: ${playerElo})... (${allSeeds.length} rooms exist)`);

    let bestSeed: string | null = null;
    let minEloDiff = Infinity;
    let candidateCount = 0;

    for (const seed of allSeeds) {
        const meta = await getRoomMeta(seed);

        // Считаем средний ELO фантомов в комнате
        let avgElo = 1000; // По умолчанию, если фантомов нет
        if (meta.active_phantoms.length > 0) {
            const sumElo = meta.active_phantoms.reduce((sum, p) => sum + (p.elo ?? 1000), 0);
            avgElo = sumElo / meta.active_phantoms.length;
        }

        const diff = Math.abs(avgElo - playerElo);

        if (diff < minEloDiff) {
            minEloDiff = diff;
            bestSeed = seed;
        }

        if (diff <= MAX_ELO_DIFF) {
            candidateCount++;
        }
    }

    console.log(`[RoomService] Found ${candidateCount} labs with suitable ELO (diff <= ${MAX_ELO_DIFF})`);

    // Если нашли подходящую комнату по ELO
    if (bestSeed && minEloDiff <= MAX_ELO_DIFF) {
        console.log(`[RoomService] Selected room with ELO diff ${minEloDiff.toFixed(1)}: ${bestSeed}`);
        return getRoomData(parseInt(bestSeed, 10), playerId);
    }

    // Подходящих комнат нет (либо слишком большая разница, либо их вообще нет) — генерируем новую
    const newSeed = generateRandomSeed();
    console.log(`[RoomService] No suitable rooms found (min diff: ${minEloDiff.toFixed(1)}), generating new seed: ${newSeed}`);

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
export async function processGameOver(playerId: string, payload: GameOverPayload): Promise<{ saved: boolean; message: string; replayId?: string }> {
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
        elo: replay.elo, // Передаем ELO если оно есть в пейлоаде
        deathPosition: replay.deathPosition,
        trajectoryLog: replay.trajectoryLog
    };

    // Пытаемся добавить реплей в комнату
    const saved = await addReplayToRoom(seedStr, completeReplay);

    if (saved) {
        return { saved: true, message: 'Replay saved! You are now a phantom in this room.', replayId };
    } else {
        return { saved: false, message: 'Your score was not high enough to become a phantom.', replayId };
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
    console.log('║  Seed  │ Phantoms │ Total Games │ Avg ELO ║');
    console.log('╟────────┼──────────┼─────────────┼─────────╢');

    if (seeds.length === 0) {
        console.log('║        │ NO ROOMS │             │         ║');
    } else {
        for (const seed of seeds) {
            const meta = await getRoomMeta(seed);
            const seedPad = seed.substring(0, 6).padEnd(6, ' ');
            const phantomsPad = meta.active_phantoms.length.toString().padEnd(8, ' ');
            const totalPad = meta.total_games_played.toString().padEnd(11, ' ');

            let avgElo = 1000;
            if (meta.active_phantoms.length > 0) {
                const sumElo = meta.active_phantoms.reduce((sum, p) => sum + (p.elo ?? 1000), 0);
                avgElo = sumElo / meta.active_phantoms.length;
            }
            const eloPad = Math.round(avgElo).toString().padEnd(7, ' ');

            console.log(`║ ${seedPad} │ ${phantomsPad} │ ${totalPad} │ ${eloPad} ║`);
        }
    }
    console.log('╚═══════════════════════════════════════╝\n');
}

/**
 * Получить таблицу рекордов (Топ-N) из персональных рекордов пользователей
 */
export async function getLeaderboard(authManager: AuthManager, limit: number = 10): Promise<LeaderboardEntry[]> {
    const allUsers = await authManager.getAllUsers();

    // Собираем топ на основе персональных рекордов
    const topUsers = allUsers
        .filter(u => (u.data.highScore || 0) > 0)
        .sort((a, b) => b.data.highScore - a.data.highScore)
        .slice(0, limit);

    return topUsers.map(u => ({
        playerName: u.data.username,
        score: u.data.highScore,
        seed: u.data.highScoreSeed || 0,
        date: u.data.highScoreDate ? new Date(u.data.highScoreDate).getTime() : new Date(u.data.lastSeen).getTime(),
        replayId: u.data.highScoreReplayId || ''
    }));
}
