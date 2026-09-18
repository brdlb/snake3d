# Обучающий вход нового игрока
- Last edited with skill pack: `0.2.2`

## Title and scope

Первый локальный запуск проходит через tutorial до обычного room-flow. Tutorial не открывает авторизацию, WebSocket, комнату или фантомов; после завершения сохраняется локальный маркер, а после смерти выполняется обычное подключение.

## Planning anchor

- `src/main.ts` вызывает `networkManager.connect()` до `new Game()`; это нарушает границу первого запуска.
- `Game` должен отложить создание `World`, стен, игровых mesh-объектов, змеи и Pathfinder: один только скрытый рендер поля всё равно создаёт игровое поле до выбора туториала.
- `Game.handleGameStart()` всегда запрашивает комнату или загружает offline-фантомов; tutorial должен использовать отдельную локальную инициализацию.
- Связанные активные спецификации `live-pause-and-orientation-propagation.md` и `room-phantom-roster-synchronization.md` переиспользуются без изменения серверных контрактов.

## Connected groups or observed existing logic

1. Entry and orchestration: `main.ts`, `Game` constructor, `handleGameStart`, `resetGame`, `handleGameOver`.
2. Local gameplay: `World`, `Snake`, `InputManager`, collision/effect path in `Game.checkCollisions`.
3. UI: `WelcomeScreen`, `PauseUI`, new `TutorialUI`; tutorial gates must consume only permitted input.
4. Persistence/network: `localStorage` first-run marker, existing `OfflineDataManager`, delayed `NetworkManager.connect`; no Worker/D1 changes.
5. Validation: pure `TutorialSession` tests, bootstrap guards, build/lint and existing Vitest suite.

## Use cases

### 1. Новый игрок начинает локальное обучение

first-run marker absent --click «Начать обучение»--> local tutorial session without auth, room, WebSocket or phantoms

Requirements:

- Before onboarding completion, `connect`, `requestRoom`, room sockets and phantom loading MUST NOT be called.
- Tutorial death MUST NOT set the completion marker; the next page load starts tutorial again.

### 2. Игрок проходит обязательные gates

tutorial collectible --effect and permitted input--> paused explanation or required turn/roll gate --accepted action--> next tutorial phase

Requirements:

- Required positions are derived from spawn direction/up.
- Wrong turn/roll and ordinary pause/Escape do not bypass a gate.
- Desktop hints use A/D and Q/E; mobile hints describe horizontal/vertical swipes.

### 3. После roll поле становится обычной игрой

accepted roll --expand local world and remove tutorial-only collectibles--> standard local gameplay --death--> persist offline result and connect once

Requirements:

- Completion marker is written only after roll and expansion succeed.
- The existing standard food effects and room-flow remain unchanged after the delayed connection boundary.

## Implementation checklist

1. [x] Add `TutorialSession` layout/state helper and pure tests.
2. [x] Add tutorial overlay UI and styles.
3. [x] Add first-run bootstrap branch and local Game initialization.
4. [x] Gate movement/effects and delayed post-death connection in `Game`.
5. [x] Defer playfield construction until tutorial confirmation, while preserving automatic construction for completed onboarding.
6. [x] Run focused and repository validation, including `npm run cf:test`, `npm run build`, `npm run lint`, and `git diff --check`.
7. [ ] Manual desktop/mobile browser smoke; deployment remains deferred.

## Open questions

- Non-blocking: the existing scene already renders a full boundary cube; visual layer-by-layer animation can be represented by a local transition without changing the server world geometry.

## Decision log

- 2026-09-19: Keep tutorial state in a pure client module and leave realtime, Worker, D1, replay submission and room contracts unchanged.
- 2026-09-19: Use localStorage marker `snake3d_onboarding_completed`; failed tutorial runs remain replayable.
- 2026-09-19: A tutorial `Game` instance may create scene/UI infrastructure, but no playfield state or field renderables before the player confirms tutorial start. Returning players construct the playfield before the room flow begins.
