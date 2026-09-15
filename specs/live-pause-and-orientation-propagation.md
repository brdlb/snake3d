# Передача ориентации и паузы живой змейки
- Last edited with skill pack: `0.2.2`

## Title and scope

Живая комната должна передавать другим участникам изменение ориентации змейки вокруг оси движения и её вход/выход из паузы. Пока локальный игрок на паузе или уже погиб, клиент продолжает симулировать только непоставленных на паузу живых соперников; изменение паузы не попадает в историю движения или сохранённый replay.

## Planning anchor

- `src/core/Game.ts#setupInputs` уже отправляет `player.directionChanged` для `rollLeft`/`rollRight`, поскольку сравнивает полный quaternion; его `direction` и `up` несут ориентацию.
- `src/core/Game.ts#togglePause` меняет только локальный `isPaused`, а paused- и `isGameOver`-ветви `Game.update` возвращаются до `advanceLiveOpponent`, поэтому во время паузы или после локальной смерти удалённые змейки визуально замирают.
- `shared/realtime.ts`, `src/network/NetworkManager.ts`, `worker/index.ts#webSocketMessage`, `shared/simulation.ts#SimPlayer` образуют общий WebSocket-контракт и снимки комнат; изменение не локально.
- История replay строится только через `RoomDurableObject.recordDirection`; событие паузы должно обходить этот метод.
- Затронутых активных спецификаций в `specs/` до этой записи нет; действие: создать эту активную спецификацию.

## Connected groups or observed existing logic

1. Entry and client orchestration
   - `Game.setupInputs` отправляет направление после любого изменения quaternion, включая roll.
   - `Game.togglePause` показывает/скрывает UI и переключает звук/камеру, но не уведомляет комнату.
   - В paused-ветке `Game.update` обновляется только локальная камера.

2. Protocol and transport
   - `shared/realtime.ts` описывает discriminated union входящих и исходящих сообщений; `NetworkManager` имеет отправители направления и полного состояния.
   - `RoomSnapshot.players` использует `SimPlayer`, поэтому новое live-свойство будет доступно при reconnect/resync без отдельной миграции.

3. Authoritative room state and replay
   - `RoomDurableObject.webSocketMessage` валидирует и сохраняет direction/state, рассылает принятые изменения, а direction handler вызывает `recordDirection`.
   - `ReplayTrajectory.changes` содержит только позицию и направление; менять его тип или добавлять туда pause не требуется.

4. Remote simulation and rendering
   - `Game.applyLiveSnapshot` и `createLiveOpponent` строят клиентские модели соперников.
   - `advanceLiveOpponent` пропускает только мёртвых игроков; модели паузы пока нет.

5. Specs
   - `specs/live-pause-and-orientation-propagation.md` — новый активный план и будущая реализационная спецификация.

## Use cases

### 1. Передать ориентацию и смену паузы
активная локальная змейка --меняет roll или переключает паузу--> подтверждённое live-состояние комнаты --рассылается--> актуальные модели остальных клиентов

Requirements:

  R1:
  При roll вокруг оси движения клиент MUST передавать актуальную пару `direction` и `up`; сервер MUST принять только корректную ориентацию и разослать её соперникам.

  R2:
  При каждом фактическом входе в паузу и выходе из неё online-игрок MUST отправить отдельное состояние паузы со своим актуальным положением, `direction`, `up`, скоростью и монотонной последовательностью.

  R3:
  Сервер MUST хранить paused-признак в `SimPlayer`, включать его в snapshots и рассылать подтверждённое изменение всем другим сокетам; устаревшее или невалидное сообщение не меняет состояние.

  R4:
  Обработчик паузы MUST NOT вызывать `recordDirection` и MUST NOT дописывать pause-маркер в `ReplayTrajectory.changes`.

Detailed Workflow:
 - Изменение ориентации:
   локальный quaternion --извлечь direction и up--> `DirectionInput` --валидировать и сохранить--> `PlayerDirectionChanged` --применить к сопернику--> его следующий шаг использует новую ориентацию
 - Переключение паузы:
   локальный `isPaused` --собрать checkpoint без replay--> pause input --проверить seq и live state--> `SimPlayer.paused` --persist and broadcast--> pause-aware модель соперника
 - Reconnect/resync:
   сохранённый `SimPlayer.paused` --room.state--> snapshot --создать/заменить opponent--> его paused-состояние немедленно применяется.

Types:
PauseInput
 - type: `'pause'`
 - seq: number
 - step: number
 - paused: boolean
 - segments: Axis[]
 - direction: Axis
 - up: Axis
 - score: number
 - speed: number

PlayerPauseChanged
 - entityId: string
 - seq: number
 - step: number
 - paused: boolean
 - segments: Axis[]
 - direction: Axis
 - up: Axis
 - score: number
 - speed: number
 - serverTime: number

SimPlayer extension
 - paused: boolean # false for new players and legacy stored snapshots

Implementation Logic:
 - Add a distinct `player.pauseChanged` client/server WebSocket message rather than overload `player.directionChanged` or a replay-oriented direction checkpoint. Its payload shares the validated snake-state shape plus `paused`.
 - On the client, factor the current live checkpoint collection so roll and pause reuse the same integer-grid segments/direction/up data, while their sequence counters remain compatible with their corresponding server ordering rule.
 - On the Worker, accept the pause message after stale-connection/alive checks, reject non-boolean `paused` and stale sequence numbers, update the complete authoritative player checkpoint plus `paused`, persist, and broadcast `player.pauseChanged` without calling `recordDirection`.
 - Treat missing `paused` in durable storage as `false` during load/snapshot/model construction, preserving existing room records.

Events And Endpoints:
 - WebSocket client to room: `player.pauseChanged` carrying `PauseInput`.
 - WebSocket room to peers: `player.pauseChanged` carrying `PlayerPauseChanged`.
 - Existing `player.directionChanged` remains the orientation/trajectory event, including roll-induced `up` changes.

Files And Functions:
 - existing: `shared/realtime.ts` — extend realtime unions and pause payload types.
 - existing: `shared/simulation.ts#SimPlayer` and `addPlayer` — persist default paused state and make simulator skip paused players if server stepping is activated.
 - existing: `src/network/NetworkManager.ts` — add typed pause sender.
 - existing: `src/core/Game.ts#togglePause`, `#livePlayerState`, `#applyLiveSnapshot`, `#createLiveOpponent` — emit pause state and consume it for remote models.
 - existing: `src/core/livePlayers.ts#advanceLiveOpponent` — honour the remote paused flag.
 - existing: `worker/index.ts#webSocketMessage`, `#snapshot`, `#recordDirection` — validate/persist/broadcast pause separately while retaining trajectory-only direction recording.

Tests:
`shared/simulation.test.ts`
 - description: paused player is excluded from any authoritative `advanceSimulation` due set, while an unpaused player due at the same time still advances.
   input: two alive players differing only in `paused`.
   workflow: simulation state --advance to due time--> updated state
   expected outcome: only the unpaused player moves; paused player's `nextStepAt` is not consumed.
`src/core/livePlayers.test.ts`
 - description: remote paused opponent does not extrapolate, then resumes moving after a pause-change state clears the flag.
   input: a live opponent with known segments and speed.
   workflow: paused opponent --advance frame--> unchanged segments --receive resume--> next advance
   expected outcome: no movement while paused and one normal step after resume.
`worker/room-selection.test.ts` or a focused Worker realtime test
 - description: valid pause is persisted/broadcast but creates no trajectory change; invalid or stale pause is rejected/ignored.
   input: a connected player, a pause payload and the stored trajectory length.
   workflow: active player --pause message--> persisted paused player and peer message
   expected outcome: `paused=true`, unchanged `trajectory.changes`, and snapshot/reconnect exposes paused.
`src/core/Game`-level focused test or extracted helper test
 - description: while local pause or game over is active, update still advances only unpaused remote opponents.
   input: paused or game-over local game with one paused and one unpaused remote model.
   workflow: local paused/game-over frame --update remote models--> rendered live state
   expected outcome: unpaused remote position advances; paused remote position stays fixed; local snake does not move and its replay recorder receives no pause entry.

### 2. Продолжить симуляцию соперников во время локальной паузы или смерти
локальная пауза или game over с полученными remote states --обновить только допустимые модели--> сцена с движущимися живыми unpaused-соперниками и неподвижными paused/dead-соперниками

Requirements:

  R5:
  Локальная пауза MUST останавливать локальную змейку, статистику и запись replay как сейчас, но MUST NOT останавливать обработку входящих room-событий, рендер и `advanceLiveOpponent` для unpaused-соперников.

  R6:
  Remote opponent с `paused=true` MUST оставаться на последней подтверждённой позиции до resume/snapshot с `paused=false`.

  R7:
  После смерти локального игрока клиент MUST продолжать обработку room-событий, рендер и `advanceLiveOpponent` для живых unpaused-соперников до перехода в другую комнату или перезапуска; локальная змейка и её replay остаются остановленными как сейчас.

Execution Logic:
1. Input: `isPaused=true` или `isGameOver=true`, `liveWorld`, коллекция remote моделей.
   Outcome: unpaused-модели получили frame delta; paused-модели и локальная змейка не сдвинуты.
   Logic: до paused и game-over early return выполнить существующий проход `advanceLiveOpponent`; функция сразу возвращает для `!alive || paused`.
   External state: отсутствует; это только клиентская интерполяция.
   Config parameters: существующие speed и delta.
   Metrics: отсутствуют; не вводить телеметрию для этой точечной правки.
2. Input: `player.pauseChanged` или `room.state`.
   Outcome: модель соперника получает checkpoint и paused-флаг до следующего кадра.
   Logic: применить полный checkpoint, сбросить elapsed и сохранить статус; не выполнять искусственный catch-up за время паузы.
   External state: WebSocket snapshot/event.
   Config parameters: отсутствуют.
   Metrics: отсутствуют.

Invariants:
- Outline:

  ```text
  I1 @ обработанный live checkpoint
    --D1: persist/broadcast pause without trajectory recording-->
  I2 @ pause-aware remote model
    --D2: paused-frame update-->
  I3 @ кадр локальной паузы или смерти
  ```

- State invariants:

  - `I1` at `обработанный live checkpoint`: `paused` принадлежит конкретной `SimPlayer` и совпадает с последним принятым для неё валидным seq.
  - `I2` at `pause-aware remote model`: remote модель содержит серверный `paused` и не имеет искусственно добавленного replay-маркера.
  - `I3` at `кадр локальной паузы или смерти`: локальная змейка не делает gameplay step и recorder не изменяется; каждый remote игрок продвигается только при `alive && !paused`.

- Derivations:

  - `D1: I1 -> I2`
    - workflow transition: `persist/broadcast pause without trajectory recording`
    - justification: pause handler сохраняет только live checkpoint и не вызывает `recordDirection`, поэтому `ReplayTrajectory.changes` не меняется; это обосновывает R4.
  - `D2: I2 -> I3`
    - workflow transition: `paused-frame update`
    - justification: pause-флаг фильтрует только соответствующую remote модель перед `advanceLiveOpponent`, а shared remote update выполняется до paused и game-over early returns; это обосновывает R5, R6 и R7.

## Implementation checklist

1. [x] Добавить `paused=false` в создаваемого игрока, совместимую нормализацию старых snapshots и pause-aware server/client типы.
2. [x] Реализовать отдельную отправку, валидацию, хранение и broadcast `player.pauseChanged` без `recordDirection`; handler содержит docstring, связывающий его с UC 1.
3. [x] Применить pause state к remote моделям и вынести client-side remote advancement до ранних `isPaused` и `isGameOver` returns; отфильтровать paused/dead opponents.
4. [x] Добавить регрессии для протокола, snapshot/reconnect, replay trajectory, server simulation и paused local frame через выделенный проход remote-моделей.
5. [x] Выполнить `npm run cf:test` (54 tests), `npm run build`, `npm run lint`, `git diff --check` и структурную проверку этой спецификации.

## Open questions

- Non-blocking: план исходит из того, что пауза — видимое участникам комнаты временное состояние, а не основание удалять игрока или завершать его игру. Если требуется сохранить уязвимость змейки во время паузы, это сохраняется: только её клиентский шаг останавливается, отдельная проверка коллизий server-side не расширяется этим изменением.

## Decision log

- 2026-09-15: Выбран отдельный `player.pauseChanged`, а не перегрузка `player.directionChanged`, чтобы пауза не была ошибочно записана как изменение маршрута replay.
- 2026-09-15: Roll остаётся направляющим событием: он уже меняет `up` при том же векторе движения, а значит существующий direction payload достаточен для передачи ориентации.
- 2026-09-15: После уточнения добавлен одинаковый live-rendering rule для локальной паузы и локальной смерти: remote simulation продолжается для `alive && !paused`.
- 2026-09-15: Реализован `player.pauseChanged` с независимой sequence-линейкой state checkpoint, без вызова `recordDirection`; отсутствующий durable `paused` нормализуется в `false`.
- 2026-09-15: Реализация и локальные проверки завершены; browser smoke и deployment остаются отдельной runtime-границей.
