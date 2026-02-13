import { ReplayData, Vec3 } from './types.js';

/**
 * Валидатор реплеев для предотвращения фейковых рекордов
 */
export class RoomValidator {
    /**
     * Основная функция валидации
     */
    public static validate(replay: ReplayData): { isValid: boolean; reason?: string } {
        // 1. Базовые проверки структуры
        if (replay.finalScore > 0 && (!replay.trajectoryLog || replay.trajectoryLog.length === 0)) {
            // Если есть очки, должен быть хоть какой-то путь
            if (replay.finalScore > 10) {
                return { isValid: false, reason: 'Score without trajectory' };
            }
        }

        // 2. Расчет пройденной дистанции
        const totalDistance = this.calculateTotalDistance(replay);

        // 3. Проверка на реалистичность очков относительно дистанции
        // В среднем игрок получает 1-5 очков за несколько шагов. 
        // Даже если учитывать бонусы (15 очков), среднее количество очков на шаг 
        // вряд ли превысит 5. Возьмем с запасом 10 очков на 1 шаг.
        const maxRealisticScore = Math.max(10, totalDistance * 10);

        if (replay.finalScore > maxRealisticScore) {
            return {
                isValid: false,
                reason: `Score too high for distance (${replay.finalScore} > ${Math.round(maxRealisticScore)} for ${Math.round(totalDistance)} steps)`
            };
        }

        // 4. Проверка сложности лога для высоких рекордов
        // Если рекорд > 1000, в логе должно быть минимум 5 поворотов
        if (replay.finalScore > 1000 && replay.trajectoryLog.length < 5) {
            return { isValid: false, reason: 'High score with suspicious low complexity' };
        }

        // 5. Проверка непрерывности пути (отсутствие телепортации)
        if (!this.checkContinuity(replay)) {
            return { isValid: false, reason: 'Trajectory is not continuous' };
        }

        return { isValid: true };
    }

    /**
     * Рассчитать суммарную дистанцию (в клетках), пройденную змейкой
     */
    private static calculateTotalDistance(replay: ReplayData): number {
        let distance = 0;
        let currentPos = replay.startParams.startPosition || { x: 0, y: 0, z: 0 };

        // Дистанция между точками поворотов
        for (const turn of replay.trajectoryLog) {
            distance += this.getDistance(currentPos, turn.position);
            currentPos = turn.position;
        }

        // Дистанция от последнего поворота до точки смерти
        distance += this.getDistance(currentPos, replay.deathPosition);

        return distance;
    }

    /**
     * Проверить, что каждый сегмент пути соответствует направлению
     */
    private static checkContinuity(replay: ReplayData): boolean {
        let currentPos = replay.startParams.startPosition || { x: 0, y: 0, z: 0 };
        let currentDir = replay.startParams.startDirection || { x: 0, y: 0, z: 1 };

        for (const turn of replay.trajectoryLog) {
            if (!this.isPointOnRay(currentPos, currentDir, turn.position)) {
                return false;
            }
            currentPos = turn.position;
            currentDir = turn.direction;
        }

        // Проверка точки смерти
        if (!this.isPointOnRay(currentPos, currentDir, replay.deathPosition)) {
            return false;
        }

        return true;
    }

    /**
     * Расстояние между двумя точками
     */
    private static getDistance(a: Vec3, b: Vec3): number {
        return Math.sqrt(
            Math.pow(b.x - a.x, 2) +
            Math.pow(b.y - a.y, 2) +
            Math.pow(b.z - a.z, 2)
        );
    }

    /**
     * Проверка, лежит ли целевая точка на луче из текущей позиции в текущем направлении
     */
    private static isPointOnRay(origin: Vec3, direction: Vec3, target: Vec3): boolean {
        // Вектор от origin до target
        const toTarget = {
            x: target.x - origin.x,
            y: target.y - origin.y,
            z: target.z - origin.z
        };

        const dist = this.getDistance(origin, target);
        if (dist === 0) return true;

        // Ожидаемый вектор (direction * dist)
        const expected = {
            x: direction.x * dist,
            y: direction.y * dist,
            z: direction.z * dist
        };

        // Проверяем близость с учетом погрешности (0.1 для работы с плавающей точкой)
        const diff = Math.abs(toTarget.x - expected.x) +
            Math.abs(toTarget.y - expected.y) +
            Math.abs(toTarget.z - expected.z);

        return diff < 0.1;
    }
}
