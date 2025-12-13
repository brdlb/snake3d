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

// Максимальное количество активных фантомов в комнате
export const MAX_PHANTOMS = 4;

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
    const replays: ReplayData[] = [];

    for (const phantom of meta.active_phantoms) {
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
        deathTick: replay.deathTick
    };

    if (meta.active_phantoms.length < MAX_PHANTOMS) {
        // Есть свободные слоты — просто добавляем
        meta.active_phantoms.push(newPhantom);
        await saveReplay(seed, replay);
        await saveRoomMeta(seed, meta);
        console.log(`[Room ${seed}] Added replay ${replay.id} (score: ${replay.finalScore}). Total phantoms: ${meta.active_phantoms.length}`);
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
