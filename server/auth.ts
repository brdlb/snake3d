import { promises as fs } from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface UserData {
    username: string;
    createdAt: string;
    lastSeen: string;
    highScore: number;
    highScoreSeed?: number;
    highScoreReplayId?: string;
    highScoreDate?: string;
    gamesPlayed: number;
    totalScore: number;
    elo: number;
    settings: {
        musicVolume: number;
        sfxVolume: number;
    };
}

export class AuthManager {
    private dataDir: string;

    constructor() {
        this.dataDir = path.join(__dirname, '../data/users');
        this.ensureDataDir();
    }

    /**
     * Убедиться, что директория для данных существует
     */
    private async ensureDataDir(): Promise<void> {
        try {
            await fs.mkdir(this.dataDir, { recursive: true });
            console.log(`[Auth] Data directory ready: ${this.dataDir}`);
        } catch (error) {
            console.error('[Auth] Failed to create data directory:', error);
        }
    }

    /**
     * Генерация нового уникального токена
     */
    generateToken(): string {
        return crypto.randomUUID() + '-' + Date.now().toString(36);
    }

    /**
     * Получить путь к файлу пользователя по токену
     */
    private getUserFilePath(token: string): string {
        // Используем безопасное имя файла (только первые 36 символов UUID)
        const safeToken = token.replace(/[^a-zA-Z0-9-]/g, '');
        return path.join(this.dataDir, `${safeToken}.json`);
    }

    /**
     * Генерация случайного имени пользователя
     */
    private generateUsername(): string {
        const adjectives = [
            'Swift', 'Mighty', 'Stellar', 'Cosmic', 'Thunder',
            'Blazing', 'Shadow', 'Crystal', 'Neon', 'Cyber',
            'Golden', 'Silver', 'Phantom', 'Turbo', 'Ultra'
        ];
        const nouns = [
            'Snake', 'Viper', 'Python', 'Cobra', 'Serpent',
            'Dragon', 'Hunter', 'Striker', 'Racer', 'Champion',
            'Phoenix', 'Warrior', 'Ninja', 'Pilot', 'Runner'
        ];
        const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
        const noun = nouns[Math.floor(Math.random() * nouns.length)];
        const number = Math.floor(Math.random() * 999);
        return `${adj}${noun}${number}`;
    }

    /**
     * Создать нового пользователя
     */
    async createUser(token: string): Promise<UserData> {
        const userData: UserData = {
            username: this.generateUsername(),
            createdAt: new Date().toISOString(),
            lastSeen: new Date().toISOString(),
            highScore: 0,
            gamesPlayed: 0,
            totalScore: 0,
            elo: 1000,
            settings: {
                musicVolume: 0.5,
                sfxVolume: 0.7,
            },
        };

        await this.saveUser(token, userData);
        return userData;
    }

    /**
     * Сохранить данные пользователя
     */
    async saveUser(token: string, userData: UserData): Promise<void> {
        const filePath = this.getUserFilePath(token);
        try {
            await fs.writeFile(filePath, JSON.stringify(userData, null, 2), 'utf-8');
        } catch (error) {
            console.error(`[Auth] Failed to save user data:`, error);
            throw error;
        }
    }

    /**
     * Получить данные пользователя по токену
     */
    async getUserByToken(token: string): Promise<UserData | null> {
        const filePath = this.getUserFilePath(token);
        try {
            const data = await fs.readFile(filePath, 'utf-8');
            const userData = JSON.parse(data) as UserData;

            // Миграция: добавляем ELO если отсутствует
            if (userData.elo === undefined) {
                userData.elo = userData.highScore || 1000;
            }

            // Обновляем lastSeen при каждом обращении
            userData.lastSeen = new Date().toISOString();
            await this.saveUser(token, userData);

            return userData;
        } catch (error) {
            // Файл не найден - пользователь не существует
            return null;
        }
    }

    /**
     * Обновить данные пользователя
     */
    async updateUser(token: string, updates: Partial<UserData>): Promise<UserData | null> {
        const userData = await this.getUserByToken(token);
        if (!userData) {
            return null;
        }

        // Защищаем некоторые поля от изменения
        const protectedFields = ['createdAt'];
        protectedFields.forEach(field => {
            delete (updates as any)[field];
        });

        const updatedData: UserData = {
            ...userData,
            ...updates,
            lastSeen: new Date().toISOString(),
        };

        // Глубокое слияние для settings
        if (updates.settings) {
            updatedData.settings = {
                ...userData.settings,
                ...updates.settings,
            };
        }

        await this.saveUser(token, updatedData);
        return updatedData;
    }

    /**
     * Проверить существование пользователя
     */
    async userExists(token: string): Promise<boolean> {
        const filePath = this.getUserFilePath(token);
        try {
            await fs.access(filePath);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Получить список всех пользователей (для статистики)
     */
    async getAllUsers(): Promise<{ token: string; data: UserData }[]> {
        try {
            const files = await fs.readdir(this.dataDir);
            const users: { token: string; data: UserData }[] = [];

            for (const file of files) {
                if (file.endsWith('.json')) {
                    const token = file.replace('.json', '');
                    const userData = await this.getUserByToken(token);
                    if (userData) {
                        users.push({ token, data: userData });
                    }
                }
            }

            return users;
        } catch (error) {
            console.error('[Auth] Failed to get all users:', error);
            return [];
        }
    }
}
