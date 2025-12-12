# Snake3D Multiplayer Server

## Структура

```
server/
├── index.ts       # Основной сервер Socket.IO
├── auth.ts        # Менеджер авторизации и работы с пользователями
└── tsconfig.json  # TypeScript конфигурация для сервера

data/
└── users/         # Директория с данными пользователей
    └── {token}.json
```

## Установка

```bash
# Установить зависимости (в корне проекта)
npm install
```

## Запуск

### Режим разработки
```bash
# Запустить сервер с hot-reload
npm run server

# Или запустить всё вместе (клиент + сервер)
npm run dev:all
```

### Продакшен
```bash
# Собрать сервер
npm run server:build

# Запустить
npm run start
# или
node server/dist/index.js
```

## API Socket.IO

### События от клиента к серверу

| Событие | Данные | Описание |
|---------|--------|----------|
| `auth:login` | `token: string \| null` | Авторизация с токеном (или null для нового) |
| `user:getData` | - | Запрос данных пользователя |
| `user:update` | `Partial<UserData>` | Обновление данных пользователя |
| `ping` | - | Проверка соединения |

### События от сервера к клиенту

| Событие | Данные | Описание |
|---------|--------|----------|
| `auth:success` | `{ token, user, isNew }` | Успешная авторизация |
| `user:data` | `UserData` | Данные пользователя |
| `user:updated` | `UserData` | Обновлённые данные |
| `user:error` | `{ message }` | Ошибка |
| `pong` | `{ serverTime }` | Ответ на ping |

## Структура UserData

```typescript
interface UserData {
    username: string;      // Сгенерированное имя
    createdAt: string;     // ISO дата создания
    lastSeen: string;      // ISO последнего входа
    highScore: number;     // Лучший результат
    gamesPlayed: number;   // Количество игр
    totalScore: number;    // Общий счёт
    settings: {
        musicVolume: number;
        sfxVolume: number;
    };
}
```

## Порт

По умолчанию сервер слушает порт `3000`. Можно изменить через переменную окружения:

```bash
PORT=8080 npm run server
```
