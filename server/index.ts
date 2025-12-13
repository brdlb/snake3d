import express from 'express';
import { createServer } from 'http';
import { Server as SocketServer } from 'socket.io';
import { AuthManager } from './auth.js';
import path from 'path';
import { fileURLToPath } from 'url';
import { getRoomData, processGameOver, generateRandomSeed } from './room/RoomService.js';
import type { GameOverPayload } from './room/types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const httpServer = createServer(app);

// Socket.IO сервер с CORS для разработки и продакшена
const allowedOrigins = [
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'https://snake3d.pages.dev', // Cloudflare Pages URL
    /https:\/\/.*\.pages\.dev$/, // Любые preview деплои на Cloudflare Pages
];

// Добавляем custom domain если он есть
if (process.env.FRONTEND_URL) {
    allowedOrigins.push(process.env.FRONTEND_URL);
}

const io = new SocketServer(httpServer, {
    cors: {
        origin: allowedOrigins,
        methods: ['GET', 'POST'],
        credentials: true,
    },
});

const authManager = new AuthManager();

// Middleware
app.use(express.json());

// Health check endpoint для Render
app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        connections: io.engine.clientsCount,
    });
});

// Статические файлы для продакшена
app.use(express.static(path.join(__dirname, '../dist')));

// Обработка подключений Socket.IO
io.on('connection', (socket) => {
    console.log(`[Connection] New client connected: ${socket.id}`);

    // Клиент пытается авторизоваться с существующим токеном
    socket.on('auth:login', async (token: string | null) => {
        console.log(`[Auth] Login attempt with token: ${token ? token.substring(0, 8) + '...' : 'null'}`);

        if (token) {
            // Проверяем существующий токен
            const userData = await authManager.getUserByToken(token);
            if (userData) {
                console.log(`[Auth] User authenticated: ${userData.username}`);
                socket.data.token = token;
                socket.data.user = userData;
                socket.emit('auth:success', {
                    token,
                    user: userData,
                    isNew: false,
                });
                return;
            }
        }

        // Токен не валиден или отсутствует - создаём нового пользователя
        const newToken = authManager.generateToken();
        const newUser = await authManager.createUser(newToken);

        console.log(`[Auth] New user created: ${newUser.username} with token: ${newToken.substring(0, 8)}...`);

        socket.data.token = newToken;
        socket.data.user = newUser;

        socket.emit('auth:success', {
            token: newToken,
            user: newUser,
            isNew: true,
        });
    });

    // Получение данных пользователя
    socket.on('user:getData', async () => {
        if (!socket.data.token) {
            socket.emit('user:error', { message: 'Not authenticated' });
            return;
        }

        const userData = await authManager.getUserByToken(socket.data.token);
        if (userData) {
            socket.emit('user:data', userData);
        } else {
            socket.emit('user:error', { message: 'User not found' });
        }
    });

    // Обновление данных пользователя
    socket.on('user:update', async (updates: Partial<UserData>) => {
        if (!socket.data.token) {
            socket.emit('user:error', { message: 'Not authenticated' });
            return;
        }

        try {
            const updatedUser = await authManager.updateUser(socket.data.token, updates);
            socket.data.user = updatedUser;
            socket.emit('user:updated', updatedUser);
            console.log(`[User] Updated user data for: ${updatedUser?.username}`);
        } catch (error) {
            socket.emit('user:error', { message: 'Failed to update user data' });
        }
    });

    // Пинг для проверки соединения
    socket.on('ping', () => {
        socket.emit('pong', { serverTime: Date.now() });
    });

    // =====================================================
    // ROOM / PHANTOM SYSTEM
    // =====================================================

    // Клиент запрашивает вход в комнату (получение фантомов)
    socket.on('room:join', async (seed: number | null) => {
        try {
            // Если seed не указан, генерируем случайный
            const roomSeed = seed ?? generateRandomSeed();

            console.log(`[Room] Client ${socket.id} joining room with seed: ${roomSeed}`);

            const roomData = await getRoomData(roomSeed);

            socket.emit('room:data', roomData);
            console.log(`[Room] Sent ${roomData.phantoms.length} phantoms to client ${socket.id}`);
        } catch (error) {
            console.error(`[Room] Error joining room:`, error);
            socket.emit('room:error', { message: 'Failed to join room' });
        }
    });

    // Клиент завершил игру — отправляет свой реплей
    socket.on('game:over', async (payload: GameOverPayload) => {
        try {
            const playerId = socket.data.token || socket.id;

            console.log(`[Game] Client ${socket.id} finished game. Score: ${payload.replay?.finalScore}`);

            const result = await processGameOver(playerId, payload);

            socket.emit('game:result', result);
            console.log(`[Game] Result for ${socket.id}: ${result.message}`);
        } catch (error) {
            console.error(`[Game] Error processing game over:`, error);
            socket.emit('game:result', { saved: false, message: 'Server error' });
        }
    });

    socket.on('disconnect', (reason) => {
        console.log(`[Disconnect] Client ${socket.id} disconnected: ${reason}`);
    });
});

// Типы данных пользователя
interface UserData {
    username: string;
    createdAt: string;
    lastSeen: string;
    highScore?: number;
    gamesPlayed?: number;
}

const PORT = process.env.PORT || 3000;

httpServer.listen(PORT, () => {
    console.log(`
╔════════════════════════════════════════════════════════════╗
║              🐍 Snake3D Multiplayer Server 🐍               ║
╠════════════════════════════════════════════════════════════╣
║  Server running on port ${PORT}                               ║
║  Socket.IO ready for connections                           ║
╚════════════════════════════════════════════════════════════╝
    `);
});

export { io };
