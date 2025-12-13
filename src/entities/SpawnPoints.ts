/**
 * Spawn Points - общие точки спауна для игроков и фантомов
 * 
 * Согласно дизайн-документу:
 * - Игрок появляется не в углах куба (чтобы избежать мгновенной смерти)
 * - Стартовое направление — от ближайшей стены к центру
 */

import * as THREE from 'three';
import { WORLD_SIZE } from './World';

export interface SpawnPoint {
    position: THREE.Vector3;
    direction: THREE.Quaternion;
}

// Отступ от стен
const OFFSET = 5;

/**
 * Предопределённые точки спауна
 * Расположены вблизи углов куба, но с отступом
 */
export const SPAWN_POINTS: SpawnPoint[] = [
    // Нижний уровень (y = OFFSET)
    {
        position: new THREE.Vector3(OFFSET, OFFSET, OFFSET),
        direction: new THREE.Quaternion() // Смотрит вперёд (-Z)
    },
    {
        position: new THREE.Vector3(WORLD_SIZE - OFFSET, OFFSET, OFFSET),
        direction: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI) // Смотрит назад (+Z)
    },
    {
        position: new THREE.Vector3(OFFSET, OFFSET, WORLD_SIZE - OFFSET),
        direction: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2) // Смотрит вправо (+X)
    },
    {
        position: new THREE.Vector3(WORLD_SIZE - OFFSET, OFFSET, WORLD_SIZE - OFFSET),
        direction: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.PI / 2) // Смотрит влево (-X)
    },
];

/**
 * Получить точку спауна по индексу
 */
export function getSpawnPoint(index: number): SpawnPoint {
    const safeIndex = Math.abs(index) % SPAWN_POINTS.length;
    return SPAWN_POINTS[safeIndex];
}

/**
 * Получить случайный индекс спауна
 */
export function getRandomSpawnIndex(): number {
    return Math.floor(Math.random() * SPAWN_POINTS.length);
}
