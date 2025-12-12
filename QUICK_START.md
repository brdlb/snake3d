# Быстрый старт деплоя

## TL;DR

### Вариант 1: Render (рекомендуется) ⭐

1. **Развернуть сервер на Render:**
   - Зайти на [render.com](https://render.com)
   - New + → Web Service → Connect GitHub → Выбрать репозиторий
   - Скопировать URL (например: `https://snake3d-server.onrender.com`)
   - **[📖 Подробная пошаговая инструкция](./RENDER_DEPLOYMENT_GUIDE.md)**

2. **Развернуть фронтенд на Cloudflare Pages:**
   - Зайти на [pages.cloudflare.com](https://pages.cloudflare.com)
   - Create a project → Подключить GitHub
   - Settings → Environment variables → Добавить:
     - `VITE_SOCKET_SERVER_URL` = `https://snake3d-server.onrender.com`
   - Save and Deploy

3. **Готово!** 🎉

### Вариант 2: Railway

1. **Развернуть сервер на Railway:**
   - Зайти на [railway.app](https://railway.app)
   - New Project → Deploy from GitHub → Выбрать репозиторий
   - Скопировать URL (например: `https://snake3d-server.railway.app`)

2. **Развернуть фронтенд на Cloudflare Pages:**
   - Зайти на [pages.cloudflare.com](https://pages.cloudflare.com)
   - Create a project → Подключить GitHub
   - Settings → Environment variables → Добавить:
     - `VITE_SOCKET_SERVER_URL` = `https://snake3d-server.railway.app`
   - Save and Deploy

3. **Готово!** 🎉

---

## Подробные инструкции

- **[📖 Render - Пошаговая инструкция](./RENDER_DEPLOYMENT_GUIDE.md)** - Детальное руководство для Render
- **[📖 Деплой сервера](./SERVER_DEPLOYMENT.md)** - Все варианты деплоя сервера
- **[📖 Cloudflare Pages](./CLOUDFLARE_PAGES.md)** - Деплой фронтенда

---

## Локальная разработка

```bash
# Запустить всё сразу (фронтенд + сервер)
npm run dev:all

# Или отдельно:
npm run dev      # Фронтенд (http://localhost:5173)
npm run server   # Сервер (http://localhost:3000)
```

---

## Переменные окружения

### Локально (.env)
```env
VITE_SOCKET_SERVER_URL=http://localhost:3000
```

### Production - Cloudflare Pages
```
VITE_SOCKET_SERVER_URL=https://snake3d-server.onrender.com
```
или
```
VITE_SOCKET_SERVER_URL=https://snake3d-server.railway.app
```

### Production - Server (Render/Railway)
```
FRONTEND_URL=https://snake3d.pages.dev
NODE_ENV=production
PORT=3000
```

---

## Важные заметки

⚠️ **Render Free Tier:**
- Сервер засыпает после 15 минут неактивности
- Первое подключение может занять 30-60 секунд
- Используйте UptimeRobot для постоянной работы (опционально)

✅ **Cloudflare Pages:**
- Unlimited requests и bandwidth
- Автоматический SSL
- Глобальная CDN

🔧 **Troubleshooting:**
- Если не подключается - подождите 1 минуту (сервер просыпается)
- Проверьте URL в переменных окружения
- Откройте DevTools (F12) → Console для логов
