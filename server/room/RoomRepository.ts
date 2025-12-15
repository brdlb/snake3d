/**
 * RoomRepository - управление файловой системой для хранения реплеев
 * 
 * Структура:
 * /data/rooms/<seed>/
 *   meta.json - метаданные комнаты и список активных фантомов
 *   replays/
 *     replay_<id>.json - файлы реплеев
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import type { RoomMeta, ReplayData, PhantomInfo } from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Базовая директория для данных (относительно корня проекта)
const DATA_DIR = path.join(__dirname, '../../data/rooms');

// Максимальное количество активных фантомов в комнате (согласно новым правилам: 3)
export const MAX_PHANTOMS = 3;

// Количество точек спавна (всего 4)
export const MAX_SPAWN_POINTS = 4;

/**
 * Получить путь к директории комнаты
 */
function getRoomDir(seed: string): string {
    return path.join(DATA_DIR, `seed_${seed}`);
}

/**
 * Получить путь к meta.json комнаты
 */
function getMetaPath(seed: string): string {
    return path.join(getRoomDir(seed), 'meta.json');
}

/**
 * Получить путь к директории реплеев
 */
function getReplaysDir(seed: string): string {
    return path.join(getRoomDir(seed), 'replays');
}

/**
 * Получить путь к файлу реплея
 */
function getReplayPath(seed: string, replayId: string): string {
    return path.join(getReplaysDir(seed), `${replayId}.json`);
}

/**
 * Убедиться, что директория комнаты существует
 */
async function ensureRoomDir(seed: string): Promise<void> {
    const roomDir = getRoomDir(seed);
    const replaysDir = getReplaysDir(seed);

    await fs.mkdir(roomDir, { recursive: true });
    await fs.mkdir(replaysDir, { recursive: true });
}

/**
 * Получить метаданные комнаты или создать новые
 */
export async function getRoomMeta(seed: string): Promise<RoomMeta> {
    const metaPath = getMetaPath(seed);

    try {
        const data = await fs.readFile(metaPath, 'utf-8');
        const meta = JSON.parse(data) as RoomMeta;

        // Миграция: добавляем players_history если отсутствует
        if (!meta.players_history) {
            meta.players_history = [];
        }

        return meta;
    } catch {
        // Комната не существует — создаём пустую
        const newMeta: RoomMeta = {
            seed,
            total_games_played: 0,
            active_phantoms: [],
            players_history: []
        };
        return newMeta;
    }
}

/**
 * Сохранить метаданные комнаты
 */
export async function saveRoomMeta(seed: string, meta: RoomMeta): Promise<void> {
    await ensureRoomDir(seed);
    const metaPath = getMetaPath(seed);
    await fs.writeFile(metaPath, JSON.stringify(meta, null, 2), 'utf-8');
}

/**
 * Получить данные реплея по ID
 */
export async function getReplay(seed: string, replayId: string): Promise<ReplayData | null> {
    const replayPath = getReplayPath(seed, replayId);

    try {
        const data = await fs.readFile(replayPath, 'utf-8');
        return JSON.parse(data) as ReplayData;
    } catch {
        return null;
    }
}

/**
 * Сохранить реплей
 */
export async function saveReplay(seed: string, replay: ReplayData): Promise<void> {
    await ensureRoomDir(seed);
    const replayPath = getReplayPath(seed, replay.id);
    await fs.writeFile(replayPath, JSON.stringify(replay, null, 2), 'utf-8');
}

/**
 * Удалить реплей
 */
export async function deleteReplay(seed: string, replayId: string): Promise<void> {
    const replayPath = getReplayPath(seed, replayId);

    try {
        await fs.unlink(replayPath);
    } catch {
        // Файл не существует — ничего страшного
    }
}

/**
 * Получить все активные реплеи для комнаты
 */
export async function getActiveReplays(seed: string): Promise<ReplayData[]> {
    const meta = await getRoomMeta(seed);
    // При чтении реплеев также можно сделать lazy cleanup, 
    // но лучше это делать в assignSpawnIndex, чтобы не замедлять чтение.
    // Если фантомов > 3, просто вернем топ-3 для клиента, не удаляя файлы пока.

    let phantoms = meta.active_phantoms;
    if (phantoms.length > MAX_PHANTOMS) {
        phantoms = [...phantoms].sort((a, b) => b.score - a.score).slice(0, MAX_PHANTOMS);
    }

    const replays: ReplayData[] = [];

    for (const phantom of phantoms) {
        const replay = await getReplay(seed, phantom.replayId);
        if (replay) {
            replays.push(replay);
        }
    }

    return replays;
}

/**
 * Получить список всех существующих комнат (seeds)
 */
export async function getAllRoomSeeds(): Promise<string[]> {
    try {
        // Убедимся, что директория существует
        await fs.mkdir(DATA_DIR, { recursive: true });

        const entries = await fs.readdir(DATA_DIR, { withFileTypes: true });
        const seeds: string[] = [];

        for (const entry of entries) {
            if (entry.isDirectory() && entry.name.startsWith('seed_')) {
                // Извлекаем seed из имени папки "seed_123456"
                const seed = entry.name.substring(5);
                seeds.push(seed);
            }
        }

        return seeds;
    } catch {
        return [];
    }
}

/**
 * Проверить, играл ли игрок в комнате
 */
export async function hasPlayerPlayedInRoom(seed: string, playerId: string): Promise<boolean> {
    const meta = await getRoomMeta(seed);
    return meta.players_history.includes(playerId);
}

/**
 * Добавить реплей в активные фантомы (с логикой вытеснения)
 * Возвращает true, если реплей был добавлен
 */
export async function addReplayToRoom(seed: string, replay: ReplayData): Promise<boolean> {
    const meta = await getRoomMeta(seed);

    // Увеличиваем счётчик игр
    meta.total_games_played++;

    // Добавляем игрока в историю (если ещё нет)
    if (!meta.players_history.includes(replay.playerId)) {
        meta.players_history.push(replay.playerId);
    }

    const newPhantom: PhantomInfo = {
        replayId: replay.id,
        score: replay.finalScore,
        spawnIndex: replay.startParams.spawnIndex,
        playerId: replay.playerId
    };

    // 1. Проверка на коллизию спавна (Race Condition Handling)
    // Если игрок играл на точке, которая уже занята (например, другой игрок успел записать результат раньше),
    // мы должны сравнить их и оставить только лучшего на этой точке.
    const collisionIndex = meta.active_phantoms.findIndex(p => p.spawnIndex === replay.startParams.spawnIndex);

    if (collisionIndex !== -1) {
        const incumbent = meta.active_phantoms[collisionIndex];

        if (replay.finalScore > incumbent.score) {
            console.log(`[Room ${seed}] Spawn Collision at ${incumbent.spawnIndex}. New (${replay.finalScore}) beats Old (${incumbent.score}). Replacing.`);

            // Удаляем старый реплей
            await deleteReplay(seed, incumbent.replayId);

            // Заменяем на новый
            meta.active_phantoms[collisionIndex] = newPhantom;
            await saveReplay(seed, replay);
            await saveRoomMeta(seed, meta);
            return true;
        } else {
            console.log(`[Room ${seed}] Spawn Collision at ${incumbent.spawnIndex}. New (${replay.finalScore}) lost to Old (${incumbent.score}). Discarding.`);
            await saveRoomMeta(seed, meta);
            return false;
        }
    }

    // 2. Если коллизии нет, используем стандартную логику Top-N
    // Если активных фантомов меньше максимума (3)
    if (meta.active_phantoms.length < MAX_PHANTOMS) {
        meta.active_phantoms.push(newPhantom);
        await saveReplay(seed, replay);
        await saveRoomMeta(seed, meta);
        console.log(`[Room ${seed}] Added replay ${replay.id} (score: ${replay.finalScore}, spawn: ${newPhantom.spawnIndex}). Total phantoms: ${meta.active_phantoms.length}`);
        return true;
    }

    // Все слоты заняты — ищем самого слабого
    let worstIndex = 0;
    let worstScore = meta.active_phantoms[0].score;

    for (let i = 1; i < meta.active_phantoms.length; i++) {
        if (meta.active_phantoms[i].score < worstScore) {
            worstScore = meta.active_phantoms[i].score;
            worstIndex = i;
        }
    }

    // Проверяем, победил ли новый реплей самого слабого
    if (replay.finalScore > worstScore) {
        const evictedId = meta.active_phantoms[worstIndex].replayId;

        // Удаляем старый реплей
        await deleteReplay(seed, evictedId);

        // Заменяем слот
        meta.active_phantoms[worstIndex] = newPhantom;

        // Сохраняем новый реплей
        await saveReplay(seed, replay);
        await saveRoomMeta(seed, meta);

        console.log(`[Room ${seed}] Replay ${replay.id} (score: ${replay.finalScore}) evicted ${evictedId} (score: ${worstScore})`);
        return true;
    }

    // Новый реплей не победил — сохраняем только счётчик игр
    await saveRoomMeta(seed, meta);
    console.log(`[Room ${seed}] Replay ${replay.id} (score: ${replay.finalScore}) did not beat worst score (${worstScore})`);
    return false;
}

/**
 * Получить занятые точки спавна в комнате
 */
export async function getOccupiedSpawnIndices(seed: string): Promise<number[]> {
    const meta = await getRoomMeta(seed);
    return meta.active_phantoms
        .filter(p => p.spawnIndex !== undefined)
        .map(p => p.spawnIndex);
}

/**
 * Проверить, есть ли у игрока активный фантом в комнате
 */
export async function isPlayerActiveInRoom(seed: string, playerId: string): Promise<boolean> {
    const meta = await getRoomMeta(seed);

    for (const phantom of meta.active_phantoms) {
        // Если playerId записан в метаданных (новый формат)
        if (phantom.playerId && phantom.playerId === playerId) {
            return true;
        }

        // Если playerId нет (старый формат), проверяем файл реплея
        if (!phantom.playerId) {
            const replay = await getReplay(seed, phantom.replayId);
            if (replay && replay.playerId === playerId) {
                return true;
            }
        }
    }

    return false;
}

/**
 * Найти свободную точку спавна.
 * Если комната содержит старые данные (>3 фантомов), производит очистку.
 */
export async function assignSpawnIndex(seed: string): Promise<{ spawnIndex: number }> {
    const meta = await getRoomMeta(seed);

    // Миграция/Очистка: Если фантомов больше, чем MAX_PHANTOMS (3), удаляем лишних
    if (meta.active_phantoms.length > MAX_PHANTOMS) {
        console.log(`[Room ${seed}] Cleanup: Has ${meta.active_phantoms.length} phantoms, limit is ${MAX_PHANTOMS}. Removing weakest.`);

        while (meta.active_phantoms.length > MAX_PHANTOMS) {
            // Находим слабейшего
            let worstIndex = 0;
            let worstScore = meta.active_phantoms[0].score;
            for (let i = 1; i < meta.active_phantoms.length; i++) {
                if (meta.active_phantoms[i].score < worstScore) {
                    worstScore = meta.active_phantoms[i].score;
                    worstIndex = i;
                }
            }

            const evictedId = meta.active_phantoms[worstIndex].replayId;
            console.log(`[Room ${seed}] Cleanup: Evicting ${evictedId} (score: ${worstScore})`);

            await deleteReplay(seed, evictedId);
            meta.active_phantoms.splice(worstIndex, 1);
        }

        await saveRoomMeta(seed, meta);
    }

    // Получаем занятые точки
    const occupiedIndices = meta.active_phantoms
        .filter(p => p.spawnIndex !== undefined)
        .map(p => p.spawnIndex);

    // Ищем свободную точку (0-MAX_SPAWN_POINTS)
    for (let i = 0; i < MAX_SPAWN_POINTS; i++) {
        if (!occupiedIndices.includes(i)) {
            console.log(`[Room ${seed}] Found free spawn index: ${i}`);
            return { spawnIndex: i };
        }
    }

    // Если мы здесь, значит все точки заняты, хотя фантомов всего 3.
    // Это невозможно математически, если MAX_SPAWN_POINTS=4 и MAX_PHANTOMS=3.
    // Но на всякий случай вернем 0 или выбросим ошибку.
    console.error(`[Room ${seed}] Critical Error: No free spawn points! Active phantoms: ${meta.active_phantoms.length}, Max Spawn: ${MAX_SPAWN_POINTS}`);
    return { spawnIndex: 0 };
}
