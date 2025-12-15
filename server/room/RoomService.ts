/**
 * RoomService - бизнес-логика для работы с комнатами
 */

import {
    getActiveReplays,
    addReplayToRoom,
    getAllRoomSeeds,
    getRoomMeta,
    hasPlayerPlayedInRoom,
    assignSpawnIndex,
    getReplay
} from './RoomRepository.js';
import type { ReplayData, RoomData, GameOverPayload, LeaderboardEntry } from './types.js';

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

    // Ищем комнату, в которой игрок не играл И в которой меньше всего игр
    let candidates: string[] = [];
    let minGames = Infinity;
    let unplayedCount = 0;

    for (const seed of allSeeds) {
        // Получаем метаданные один раз, чтобы проверить и историю, и количество игр
        const meta = await getRoomMeta(seed);

        // Проверяем, есть ли у игрока активные игры в этой комнате
        let hasActiveGame = false;
        for (const phantom of meta.active_phantoms) {
            if (phantom.playerId === playerId) {
                hasActiveGame = true;
                break;
            }
            // Fallback для старых записей
            if (!phantom.playerId) {
                const replay = await getReplay(seed, phantom.replayId);
                if (replay && replay.playerId === playerId) {
                    hasActiveGame = true;
                    break;
                }
            }
        }

        if (hasActiveGame) {
            continue;
        }


        unplayedCount++;

        if (meta.total_games_played < minGames) {
            // Нашли новый минимум - сбрасываем кандидатов
            minGames = meta.total_games_played;
            candidates = [seed];
        } else if (meta.total_games_played === minGames) {
            // Такой же минимум - добавляем в кандидатов
            candidates.push(seed);
        }
    }

    console.log(`[RoomService] Player ${playerId.substring(0, 8)} has ${unplayedCount} unplayed rooms`);

    if (candidates.length > 0) {
        // Если есть несколько кандидатов с одинаковым минимумом - выбираем случайного
        // Это полезно, например, если есть много новых комнат с 0 игр
        const randomIndex = Math.floor(Math.random() * candidates.length);
        const selectedSeed = candidates[randomIndex];

        console.log(`[RoomService] Selected room with fewest games (${minGames}): ${selectedSeed} (from ${candidates.length} candidates)`);
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

/**
 * Получить таблицу рекордов (Топ-N) из активных фантомов
 */
export async function getLeaderboard(limit: number = 10): Promise<LeaderboardEntry[]> {
    const seeds = await getAllRoomSeeds();

    // Собираем всех фантомов со всех комнат
    // Используем простой массив объектов для первичной сортировки
    const allPhantoms: { score: number; replayId: string; seed: string }[] = [];

    for (const seed of seeds) {
        const meta = await getRoomMeta(seed);
        for (const phantom of meta.active_phantoms) {
            allPhantoms.push({
                score: phantom.score,
                replayId: phantom.replayId,
                seed: seed
            });
        }
    }

    // Сортируем по убыванию очков
    allPhantoms.sort((a, b) => b.score - a.score);

    // Берём топ-N
    const topPhantoms = allPhantoms.slice(0, limit);

    // Для топа подгружаем полные данные (имена, даты)
    const leaderboard: LeaderboardEntry[] = [];

    for (const p of topPhantoms) {
        const replay = await getReplay(p.seed, p.replayId);
        if (replay) {
            leaderboard.push({
                playerName: replay.playerName,
                score: replay.finalScore,
                seed: parseInt(p.seed, 10),
                date: replay.timestamp,
                replayId: replay.id
            });
        }
    }

    return leaderboard;
}
