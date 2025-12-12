# Snake3D Refactored

Modern implementation of the classic Snake 3D game using TypeScript, Three.js, and Vite with multiplayer support.

## Features

- 🎮 Classic Snake 3D gameplay
- 🌐 Multiplayer support via Socket.IO
- 👤 User authentication and persistent profiles
- 📊 High scores and statistics tracking
- 🎨 Modern graphics with Three.js
- 📱 Responsive design

## Prerequisites

- Node.js (v18 or higher recommended)
- npm (comes with Node.js)

## Getting Started

### Local Development (Single Player)

1.  **Navigate to the project directory:**
    ```bash
    cd snake3d
    ```

2.  **Install dependencies:**
    ```bash
    npm install
    ```

3.  **Start the development server:**
    ```bash
    npm run dev
    ```
    Open your browser and navigate to the URL shown in the terminal (usually `http://localhost:5173`).

### Local Development (Multiplayer)

To enable multiplayer features, you need to run both the frontend and the Socket.IO server:

1.  **Install dependencies** (if not already done):
    ```bash
    npm install
    ```

2.  **Start both servers:**
    ```bash
    npm run dev:all
    ```
    This will start:
    - Frontend dev server on `http://localhost:5173`
    - Socket.IO server on `http://localhost:3000`

Alternatively, you can run them separately in different terminals:
```bash
# Terminal 1 - Frontend
npm run dev

# Terminal 2 - Server
npm run server
```

## Build for Production

To create an optimized production build:

```bash
npm run build
```

The output will be in the `dist` directory. You can preview the production build locally using:

```bash
npm run preview
```

## Deployment

This project uses a split deployment architecture:
- **Frontend:** Cloudflare Pages (static assets)
- **Backend:** Railway/Render/etc. (Socket.IO server)

### Quick Deployment Guide

1. **Deploy the Socket.IO server** first:
   - See [SERVER_DEPLOYMENT.md](./SERVER_DEPLOYMENT.md) for detailed instructions
   - Recommended platforms: Railway, Render, or Glitch
   - Copy the deployed server URL

2. **Deploy the frontend** to Cloudflare Pages:
   - See [CLOUDFLARE_PAGES.md](./CLOUDFLARE_PAGES.md) for detailed instructions
   - Set `VITE_SOCKET_SERVER_URL` environment variable to your server URL
   - Deploy via GitHub integration or Wrangler CLI

## Project Structure

- `src/main.ts`: Application entry point and Three.js scene setup
- `src/network/`: Socket.IO client and network management
- `src/style.css`: Global styles
- `server/`: Socket.IO server and authentication
- `public/`: Static assets (textures, fonts)
- `index.html`: Main HTML template

## Environment Variables

Create a `.env` file in the root directory (see `.env.example`):

```env
VITE_SOCKET_SERVER_URL=http://localhost:3000
```

For production, set this to your deployed server URL.

## Documentation

- [Server Deployment Guide](./SERVER_DEPLOYMENT.md) - How to deploy the Socket.IO server
- [Cloudflare Pages Guide](./CLOUDFLARE_PAGES.md) - How to deploy the frontend
- [Game Development Notes](./gamedev.md) - Development notes and ideas

