import { io, Socket } from 'socket.io-client';

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

export interface AuthResult {
    token: string;
    user: UserData;
    isNew: boolean;
}

type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'authenticated' | 'offline';

type EventCallback = (...args: any[]) => void;

export class NetworkManager {
    private static instance: NetworkManager;
    private socket: Socket | null = null;
    private token: string | null = null;
    private user: UserData | null = null;
    private connectionState: ConnectionState = 'disconnected';
    private eventListeners: Map<string, Set<EventCallback>> = new Map();
    private reconnectAttempts = 0;
    private maxReconnectAttempts = 5;
    private isOfflineMode: boolean = false;

    private readonly TOKEN_KEY = 'snake3d_auth_token';
    private readonly SERVER_URL = this.normalizeUrl(
        import.meta.env.VITE_SOCKET_SERVER_URL ?? (import.meta.env.PROD ? window.location.origin : 'http://localhost:3055')
    );

    private normalizeUrl(url: string): string {
        // Remove trailing /socket.io if present to avoid duplication
        return url.replace(/\/socket\.io\/?$/, '');
    }

    private constructor() {
        this.loadToken();
        this.setupNetworkListeners();
    }

    /**
     * Настройка слушателей состояния сети
     */
    private setupNetworkListeners(): void {
        // Слушаем изменения состояния сети
        window.addEventListener('online', () => {
            console.log('[Network] Connection restored');
            this.isOfflineMode = false;
            this.emit('networkOnline');
        });

        window.addEventListener('offline', () => {
            console.log('[Network] Connection lost - entering offline mode');
            this.isOfflineMode = true;
            this.connectionState = 'offline';
            this.emit('networkOffline');
            this.emit('connectionStateChange', this.connectionState);
        });

        // Проверяем начальное состояние
        if (!navigator.onLine) {
            this.isOfflineMode = true;
            this.connectionState = 'offline';
        }
    }

    /**
     * Получить singleton instance
     */
    public static getInstance(): NetworkManager {
        if (!NetworkManager.instance) {
            NetworkManager.instance = new NetworkManager();
        }
        return NetworkManager.instance;
    }

    /**
     * Загрузить токен из localStorage
     */
    private loadToken(): void {
        try {
            this.token = localStorage.getItem(this.TOKEN_KEY);
            if (this.token) {
                console.log('[Network] Token loaded from storage');
            }
        } catch (error) {
            console.warn('[Network] Failed to load token from localStorage:', error);
        }
    }

    /**
     * Сохранить токен в localStorage
     */
    private saveToken(token: string): void {
        try {
            localStorage.setItem(this.TOKEN_KEY, token);
            this.token = token;
            console.log('[Network] Token saved to storage');
        } catch (error) {
            console.warn('[Network] Failed to save token to localStorage:', error);
        }
    }

    /**
     * Удалить токен
     */
    public clearToken(): void {
        try {
            localStorage.removeItem(this.TOKEN_KEY);
            this.token = null;
            this.user = null;
            console.log('[Network] Token cleared');
        } catch (error) {
            console.warn('[Network] Failed to clear token:', error);
        }
    }

    /**
     * Подключиться к серверу
     */
    public connect(): Promise<AuthResult> {
        return new Promise((resolve, reject) => {
            // Проверяем, находимся ли мы в оффлайн режиме
            if (this.isOfflineMode || !navigator.onLine) {
                console.log('[Network] Offline mode - skipping connection');
                this.connectionState = 'offline';
                this.emit('connectionStateChange', this.connectionState);
                reject(new Error('Offline mode - no network connection'));
                return;
            }

            if (this.socket?.connected) {
                console.log('[Network] Already connected');
                if (this.user && this.token) {
                    resolve({ token: this.token, user: this.user, isNew: false });
                }
                return;
            }

            this.connectionState = 'connecting';
            this.emit('connectionStateChange', this.connectionState);

            console.log(`[Network] Connecting to ${this.SERVER_URL}...`);

            this.socket = io(this.SERVER_URL, {
                transports: ['websocket', 'polling'],
                timeout: 10000,
                reconnection: false,
            });

            this.socket.on('connect', () => {
                console.log('[Network] Connected to server');
                this.connectionState = 'connected';
                this.reconnectAttempts = 0;
                this.emit('connectionStateChange', this.connectionState);

                // Отправляем запрос на авторизацию
                this.socket!.emit('auth:login', this.token);
            });

            this.socket.on('auth:success', (result: AuthResult) => {
                console.log(`[Network] Authenticated as ${result.user.username}`);
                this.saveToken(result.token);
                this.user = result.user;
                this.connectionState = 'authenticated';
                this.emit('connectionStateChange', this.connectionState);
                this.emit('authenticated', result);
                resolve(result);
            });

            this.socket.on('connect_error', (error: Error) => {
                console.error('[Network] Connection error:', error.message);
                this.reconnectAttempts++;
                this.emit('connectionError', error);

                if (this.reconnectAttempts >= this.maxReconnectAttempts) {
                    this.connectionState = 'disconnected';
                    this.emit('connectionStateChange', this.connectionState);
                    reject(new Error('Failed to connect after maximum attempts'));
                }
            });

            this.socket.on('disconnect', (reason: string) => {
                console.log(`[Network] Disconnected: ${reason}`);
                this.connectionState = 'disconnected';
                this.emit('connectionStateChange', this.connectionState);
                this.emit('disconnected', reason);
            });

            this.socket.on('user:data', (userData: UserData) => {
                this.user = userData;
                this.emit('userDataUpdated', userData);
            });

            this.socket.on('user:updated', (userData: UserData) => {
                this.user = userData;
                this.emit('userDataUpdated', userData);
            });

            this.socket.on('user:error', (error: { message: string }) => {
                console.error('[Network] User error:', error);
                this.emit('userError', error);
            });

            this.socket.on('pong', (data: { sentAt?: number; serverTime: number }) => {
                const latency = Date.now() - (data.sentAt || Date.now());
                this.emit('latencyUpdate', latency);
            });

            // Room/Phantom system events
            this.socket.on('room:data', (data: any) => {
                console.log('[Network] Received room:data');
                this.emit('room:data', data);
            });

            this.socket.on('room:error', (error: { message: string }) => {
                console.error('[Network] Room error:', error);
                this.emit('room:error', error);
            });

            this.socket.on('game:result', (result: { saved: boolean; message: string }) => {
                console.log('[Network] Received game:result:', result);
                this.emit('game:result', result);
            });

            this.socket.on('leaderboard:data', (data: any[]) => {
                console.log('[Network] Received leaderboard data:', data.length, 'records');
                this.emit('leaderboard:data', data);
            });

            this.socket.on('leaderboard:error', (error: { message: string }) => {
                console.error('[Network] Leaderboard error:', error);
                this.emit('leaderboard:error', error);
            });
        });
    }

    /**
     * Отключиться от сервера
     */
    public disconnect(): void {
        if (this.socket) {
            this.socket.disconnect();
            this.socket = null;
            this.connectionState = 'disconnected';
            this.emit('connectionStateChange', this.connectionState);
        }
    }

    /**
     * Запросить данные пользователя
     */
    public requestUserData(): void {
        if (this.socket?.connected) {
            this.socket.emit('user:getData');
        }
    }

    /**
     * Обновить данные пользователя на сервере
     */
    public updateUser(updates: Partial<UserData>): void {
        if (this.socket?.connected) {
            this.socket.emit('user:update', updates);
        }
    }

    /**
     * Отправить произвольное сообщение на сервер
     */
    public send(event: string, data?: any): void {
        if (this.socket?.connected) {
            this.socket.emit(event, data);
        } else {
            console.warn(`[Network] Cannot send ${event}: not connected`);
        }
    }

    /**
     * Проверить пинг
     */
    public ping(): void {
        if (this.socket?.connected) {
            this.socket.emit('ping', { sentAt: Date.now() });
        }
    }

    /**
     * Запросить таблицу рекордов
     */
    public requestLeaderboard(): void {
        if (this.socket?.connected) {
            console.log('[Network] Requesting leaderboard...');
            this.socket.emit('leaderboard:request');
        } else {
            console.warn('[Network] Cannot request leaderboard: not connected');
        }
    }

    // ============ Event System ============

    /**
     * Подписаться на событие
     */
    public on(event: string, callback: EventCallback): void {
        if (!this.eventListeners.has(event)) {
            this.eventListeners.set(event, new Set());
        }
        this.eventListeners.get(event)!.add(callback);
    }

    /**
     * Отписаться от события
     */
    public off(event: string, callback: EventCallback): void {
        const listeners = this.eventListeners.get(event);
        if (listeners) {
            listeners.delete(callback);
        }
    }

    /**
     * Вызвать событие
     */
    private emit(event: string, ...args: any[]): void {
        const listeners = this.eventListeners.get(event);
        if (listeners) {
            listeners.forEach((callback) => {
                try {
                    callback(...args);
                } catch (error) {
                    console.error(`[Network] Error in event handler for ${event}:`, error);
                }
            });
        }
    }

    // ============ Getters ============

    public getConnectionState(): ConnectionState {
        return this.connectionState;
    }

    public isConnected(): boolean {
        return this.connectionState === 'authenticated';
    }

    public getUser(): UserData | null {
        return this.user;
    }

    public getToken(): string | null {
        return this.token;
    }

    public getSocket(): Socket | null {
        return this.socket;
    }

    /**
     * Проверить, находимся ли мы в оффлайн режиме
     */
    public isOffline(): boolean {
        return this.isOfflineMode || !navigator.onLine;
    }

    /**
     * Получить сохранённые данные пользователя из localStorage (для оффлайн режима)
     */
    public getOfflineUserData(): UserData | null {
        try {
            const stored = localStorage.getItem('snake3d_offline_user');
            if (stored) {
                return JSON.parse(stored);
            }
        } catch (error) {
            console.warn('[Network] Failed to load offline user data:', error);
        }
        return null;
    }

    /**
     * Сохранить данные пользователя для оффлайн режима
     */
    public saveOfflineUserData(user: UserData): void {
        try {
            localStorage.setItem('snake3d_offline_user', JSON.stringify(user));
        } catch (error) {
            console.warn('[Network] Failed to save offline user data:', error);
        }
    }
}

// Экспортируем singleton для удобства
export const networkManager = NetworkManager.getInstance();
