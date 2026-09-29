# Snake3D

A browser-based 3D Snake game built with TypeScript, Three.js, and Vite. The current online runtime is a Cloudflare Worker with D1 for persistent data and a Durable Object with native WebSockets for each live room.

## What you can play

- Move through a 3D arena, collect three kinds of food, grow, and change speed.
- Complete the first-run tutorial; restart it from Settings.
- Create or select a room, share its `?room=<seed>` link, and play alongside other players.
- Coordinate rooms form a 3D grid. At length 100, the central five cells of each wall become a portal to the adjacent room. The new room appears when the head enters; earlier rooms remain visible until the body leaves them.
- Enter an invited room as a player or a spectator. Spectators can use a free camera or follow a snake.
- Encounter replay-based phantom snakes, compare room records, and view the leaderboard.
- Play locally when the online service is unavailable. Offline results and previously cached phantoms are stored in the browser.
- Customize the snake's appearance and audio and display settings.

## Requirements

- Node.js and npm compatible with the versions of Vite and Wrangler in `package.json`.
- A browser with WebGL support.
- A Cloudflare account and a configured D1 database only if you plan to deploy your own online instance.

Install dependencies from the repository root:

```bash
npm install
```

## Local development

### Game client and offline play

```bash
npm run dev
```

Open the URL printed by Vite, usually `http://localhost:5173`. This starts the client only. The client tries the API at `http://localhost:8787` in development and falls back to offline play if it cannot connect. A new browser profile starts with the tutorial.

### Online rooms on a local Worker

The Worker serves both the built client and the API from one origin. Build the client and initialize the local D1 database before starting it:

```bash
npm run build
npx wrangler d1 migrations apply snake3d --local
npm run cf:dev
```

Open the URL printed by Wrangler, usually `http://localhost:8787`. Use separate browser profiles or browsers to test multiple players, since a profile keeps its own session cookie. You can share a room by opening its `?room=<seed>` URL in another profile.

After editing client code, run `npm run build` again so the Worker serves the updated `dist` assets. Wrangler handles Worker code changes during local development.

`VITE_API_URL` can override the API base URL for a separately hosted client. The default is `http://localhost:8787` during Vite development and the page's origin in a production build. The current Worker does not provide cross-origin API responses, so use the same-origin Worker URL for local online play.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the Vite client development server. |
| `npm run build` | Type-check and build the client into `dist/`. |
| `npm run preview` | Preview the built client without the Worker API. |
| `npm run cf:dev` | Start the local Cloudflare Worker and serve `dist/`. |
| `npm run cf:test` | Run the Vitest suite. |
| `npm run lint` | Run ESLint. |
| `npm run cf:migrate` | Apply D1 migrations to the configured **remote** database. |
| `npm run cf:deploy` | Deploy the Worker and built assets to Cloudflare. |

## Online architecture

`worker/index.ts` serves the built assets and the `/api/v1` HTTP API. An automatic cookie-based guest session identifies each player. D1 stores users, rooms, records, and saved replays. A Durable Object holds each room's live state and relays WebSocket events to players and spectators. The browser runs the game simulation and sends direction and state checkpoints; other clients animate players between those checkpoints. Saved replays become phantom snakes in later runs.

The server checks message structure and some movement rules, but it currently accepts client-reported positions, speed, and score. Treat room records and leaderboard results as casual-game results, not cheat-resistant rankings.

Coordinate room IDs encode signed `(x, y, z)` positions and stay within JavaScript's safe integer range. `POST /api/v1/rooms` accepts `{ "x": 0, "y": 1, "z": -2 }` to create or retrieve a specific room, while an empty body creates the next room on the positive X axis. `NEXT` also advances one room along positive X. Portal travel uses `POST /api/v1/rooms/portal` and transfers the snake's full body, score, speed, and heading to the neighboring room. Older random-seed rooms remain accessible by their existing links but have no coordinate portals.

### Investigating a delayed game save

In an authenticated browser profile assigned to a room, open `/api/v1/rooms/<seed>/diagnostics` on the Worker origin. The endpoint returns the D1 room row and the player's latest submission, plus the Durable Object roster, the player's latest terminal record, and its latest save stage. Other profiles receive `ROOM_CONTEXT_MISMATCH`. The `submissionId` in the response matches the `game.save` entries in Worker logs and the `game_submissions.id` D1 row.

The browser sends `player.died` with a stable `submissionId`. The server responds with `game.saveStarted`, then `game.saved` or `game.saveFailed`. A retry uses the same ID and the stored terminal record, so an already committed result is returned without a second write. The Game Over screen shows the ID and offers `RETRY SAVE` while waiting or after a retryable failure. There is no client timeout: if no response arrives, inspect the diagnostics endpoint and Worker logs by `submissionId`.

## Deployment

`wrangler.jsonc` defines the Worker, its `DB` D1 binding, the `ROOMS` Durable Object binding, built asset directory, and custom-domain route. To deploy to your own Cloudflare account, configure the D1 database and route for that account first. Then build, apply the **remote** migrations, and deploy:

```bash
npm run build
npm run cf:migrate
npm run cf:deploy
```

The migration and deploy commands change remote Cloudflare resources. `npm run preview` is only a static preview; it does not provide online rooms.

## Project map

- `src/main.ts` and `src/core/Game.ts`: startup, tutorial, gameplay, rendering integration, and room events.
- `src/network/NetworkManager.ts`: HTTP session and room API, WebSocket connection and events.
- `src/entities/` and `src/graphics/`: snakes, food world, phantoms, and Three.js rendering.
- `src/ui/`: room browser, HUD, leaderboard, settings, pause, and spectator UI.
- `shared/`: appearance types, realtime protocol, and simulation rules shared with the Worker.
- `worker/index.ts`: Cloudflare API and `RoomDurableObject`.
- `migrations/`: D1 schema migrations.
- `public/`: service worker, web manifest, fonts, images, and audio assets.
- `specs/`: design and workflow notes; check the code for the current behavior.

Older files under `server/`, plus `QUICK_START.md`, `SERVER_DEPLOYMENT.md`, `RENDER_DEPLOYMENT_GUIDE.md`, and `.env.example`, describe the previous Socket.IO deployment. They are not used by the commands above.
