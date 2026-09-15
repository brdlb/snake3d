# Синхронизация набора фантомов в сетевой комнате
- Last edited with skill pack: `0.2.2`

## Title and scope

Участники одной сетевой комнаты должны видеть один и тот же актуальный набор фантомов: он передаётся подключившемуся игроку и заменяется у всех при занятии слота живым игроком. Фантомы могут восстанавливаться только для одиночной сетевой игры; респаун при существующем живом игроке не заполняет свободные слоты фантомами.

## Planning anchor

- `worker/index.ts#RoomDurableObject.restorePhantoms`, `#join`, `#socket` и `#snapshot` одновременно управляют runtime-набором `SimulationState.players`, но смена набора после `join` рассылает только `player.joined`, а не снимок состава.
- `src/core/Game.ts#initializeRoom` создаёт client-side `Phantom[]` из REST `RoomData.phantoms`; `#applyLiveSnapshot` отдельно строит `liveOpponents` из `RoomSnapshot.players`. Поэтому серверное удаление фантома не удаляет уже созданный локальный replay-фантом у остальных клиентов.
- Текущее специальное условие restart смотрит на WebSocket-подключения, а не на `alive && !phantom` игроков в состоянии комнаты. Оно не выражает требование «живой игрок уже играет».
- Это не локальная правка: меняются authoritative runtime state, WebSocket snapshot, REST bootstrap, клиентская проекция и тесты.
- `specs/live-pause-and-orientation-propagation.md` остаётся активной и авторитетной для pause/orientation; действие: `reuse`. Новая спецификация описывает только состав фантомов.

## Connected groups or observed existing logic

1. Entry and orchestration
   - `NetworkManager.requestRoom` получает `RoomData`, затем открывает socket; `openRoomSocket` немедленно запрашивает `room.resync`.
   - `RoomDurableObject.join` вызывает `prepareState`, выбирает spawn и при нехватке места удаляет lowest-score phantom; `socket` может добавить/пересоздать игрока при подключении.
   - Риск: два несвязанных сообщения оставляют уже подключённые клиенты со старым составом.

2. Authoritative state and replay roster
   - `SimulationState.players` содержит и живых игроков, и серверные записи `phantom=true`; идентификатор серверного фантома уже имеет вид `phantom:<replayId>`.
   - `restorePhantoms` берёт replay из D1 и превращает их в игроков; текущая ветка restart использует наличие socket, а не состояние живых игроков.
   - `RoomData.phantoms` — bootstrap-реплеи, а `RoomSnapshot.players` — текущие сущности комнаты. Их требуется согласовать, а не поддерживать как независимые наборы.

3. Propagation and frontend consumers
   - `snapshot` уже передаёт весь `players`, включая `phantom=true`; этого достаточно для идентификации актуального server roster при условии, что snapshot рассылается на каждую мутацию состава.
   - `Game.livePhantomReplays` связывает `phantom:<replayId>` с replay, а `Game.phantoms` — локальная проекция этих replay. Она должна удалять элементы, отсутствующие в snapshot, и никогда не добавлять локальный фантом без bootstrap replay.
   - `Game` уже делает `requestResync` при `player.joined`; это останется аварийной совместимостью, но корректность не должна зависеть от него.

4. Validation
   - `worker/room-selection.test.ts` уже проверяет restore, выбор spawn и eviction; туда добавляются правила roster и одиночного восстановления.
   - Нужны unit-тесты выделенной client-side reconciliation-функции, чтобы проверять удаление ранее отрисованного replay-фантома без WebGL runtime.

5. Specs
   - `specs/room-phantom-roster-synchronization.md` — новая активная спецификация для этой реализации.
   - `specs/live-pause-and-orientation-propagation.md` — `reuse`: её контракт pause не меняется.

## Use cases

### 1. Подключить игрока к актуальному набору фантомов
room state and saved replays --prepare one authoritative roster and player spawn--> REST bootstrap and socket snapshot --reconcile--> identical visible phantom membership for the joining client

Requirements:

  R1:
  При входе игрока сервер MUST сформировать набор runtime-фантомов из одного `SimulationState` до ответа REST и до первого `room.state`; bootstrap и snapshot MUST представлять один и тот же состав с учётом занятого игроком слота.

  R2:
  В сетевом режиме клиент MUST считать `RoomSnapshot.players` с `phantom=true` authoritative составом. Replay из `RoomData.phantoms` допустим только как данные для построения уже объявленного сервером фантома, а не как независимый источник его существования.

Input Validation And Contracts:
 - WebSocket snapshot принимается только для текущего `seed` и с массивом `players`, как сейчас.
 - После проверки клиент может считать, что фантом с идентификатором `phantom:<replayId>` существует тогда и только тогда, когда этот id присутствует в snapshot. Отсутствующий replay для объявленного сервером фантома не создаёт локальную сущность: клиент делает resync и не рисует догадку.

Implementation Logic:
 - Вынести из `Game` чистую reconciliation-функцию: вход — сохранённый `Map<replayId, ReplayData>`, текущие `Phantom[]`, `snapshot.players`; выход — replay- и render-набор, отфильтрованный по server IDs. Так её можно тестировать без сцены.
 - `initializeRoom` сначала кэширует bootstrap-replay по `replayId`, но в online-режиме создаёт/оставляет Phantom только после server snapshot. Первый `room.state` сразу после открытия socket завершает reconciliation; offline flow не меняется.
 - `RoomDurableObject` после завершения подготовки/занятия spawn возвращает `roomData` из того же prepared state либо немедленно рассылает `room.state` всем существующим сокетам. Нельзя строить REST набор повторным независимым `activeReplays` query, который может расходиться с `state.players`.

Types:
Phantom roster identity
 - entityId: `phantom:<replayId>` # authoritative ID in `SimPlayer.id`
 - replayId: string
 - replay: ReplayData # bootstrap/render data; held only for IDs present in the roster
 - player: SimPlayer # current room snapshot representation

Files And Functions:
 - existing: `worker/index.ts#prepareState`, `#roomData`, `#snapshot`, `#join`, `#socket` — create one roster and expose it consistently.
 - existing: `shared/realtime.ts#RoomSnapshot` — document/extend the snapshot contract only if an explicit roster revision is needed beyond `players`.
 - existing: `src/network/NetworkManager.ts#requestRoom`, `#openRoomSocket` — preserve REST-before-WebSocket ordering and typed resync.
 - existing: `src/core/Game.ts#initializeRoom`, `#applyLiveSnapshot` — cache replays and reconcile visible phantoms against snapshot membership.
 - planned: `src/core/phantomRoster.ts#reconcilePhantomRoster` — pure roster projection used by `Game` and focused tests.

Tests:
`worker/room-selection.test.ts`
 - description: a joining player receives a room payload/snapshot whose phantom IDs equal the prepared state after the player occupies its spawn.
   requirements: R1
   input: saved replays including one at the selected spawn.
   workflow: prepared phantom roster --allocate player spawn--> room data and snapshot
   expected outcome: the occupied spawn's phantom is absent from both representations.
`src/core/phantomRoster.test.ts`
 - description: a previously rendered replay phantom is removed when a later snapshot lacks its authoritative ID.
   requirements: R2
   input: two cached replay entries, local render entries, snapshot with one `phantom=true` player.
   workflow: stale local roster --reconcile authoritative snapshot--> current local roster
   expected outcome: only the declared phantom remains; no replacement is fabricated.

### 2. Удалить фантом, если его слот занял новый игрок
authoritative phantom slot --allocate that slot to a joining live player--> remove matching phantom and persist state --broadcast room.state--> every connected client removes the same phantom

Requirements:

  R3:
  Если новый игрок получает слот, занятый фантомом, сервер MUST удалить именно фантом этого spawn до добавления живого игрока; выбор lowest-score phantom допустим только как алгоритм выбора spawn, но не как удаление другого фантома.

  R4:
  Каждая успешная мутация состава комнаты — добавление игрока, удаление фантома или оба действия — MUST сохранить `SimulationState` и разослать новый полный `room.state` всем сокетам после commit. Старый `player.joined` остаётся только уведомлением, не источником состава.

Execution Logic:
1. Input: prepared `state.players`, target spawn for join/restart.
   Outcome: target spawn свободен для live player, а фантомы на остальных слотах сохранены.
   Logic: найти `phantom=true` с `spawnIndex === target`; удалить его; затем повторно выполнить `safeSpawn` и добавить player. Если spawn небезопасен не из-за этого фантома, выбрать другой допустимый spawn или вернуть текущую `ROOM_FULL` ошибку без частичной мутации.
   External state: Durable Object storage получает готовое состояние только после успешного выбора.
   Config parameters: существующее число slot/spawn и правило `chooseSpawn`.
   Metrics: не вводятся.
2. Input: committed changed roster.
   Outcome: каждый подключённый клиент получает одинаковый membership checkpoint.
   Logic: `persist(state)` затем `broadcast(room.state(snapshot(state)))`; `player.joined` можно послать после snapshot для UI-индикатора.
   External state: WebSocket broadcast.
   Config parameters: отсутствуют.
   Metrics: не вводятся.

Invariants:

- Outline:

  ```text
  I1 @ committed room roster
    --D1: allocate occupied phantom spawn and publish snapshot-->
  I2 @ client-applied roster
  ```

- State invariants:

  - `I1` at `committed room roster`: для каждого spawn есть не более одной живой runtime-сущности; живой player и phantom не занимают один spawn.
  - `I2` at `client-applied roster`: локальный replay-фантом существует только при наличии соответствующего `phantom:<replayId>` в последнем принятом snapshot.

- Derivations:

  - `D1: I1 -> I2`
    - workflow transition: `allocate occupied phantom spawn and publish snapshot`
    - justification: сервер удаляет фантом того же spawn до создания player, затем один snapshot несёт полный roster; reconciliation отбрасывает отсутствующие IDs. Это обосновывает R3 и R4.

Tests:
`worker/room-selection.test.ts`
 - description: join removes the phantom at the allocated spawn rather than an unrelated lowest-score phantom.
   requirements: R3, R4
   input: full roster with distinguishable scores and a requested occupied spawn.
   workflow: join request --remove occupant and persist--> broadcast snapshot
   expected outcome: target phantom absent, unrelated phantom retained, snapshot contains the new player.

### 3. Восстанавливать фантомов только для одиночной сетевой игры
room membership before join or restart --evaluate living non-phantom players--> [no living players: restore saved replay phantoms, at least one living player: preserve current roster without restore]

Requirements:

  R5:
  Восстановление replay-фантомов MUST выполняться только когда в authoritative `SimulationState` нет ни одного `alive && !phantom` игрока после применения удаления/замены респавнящегося игрока.

  R6:
  Если существует хотя бы один другой живой игрок, респаун или новое socket-подключение MUST NOT создавать фантомов в свободных слотах. Проверка MUST опираться на live players в `SimulationState`, а не на число WebSocket-соединений.

Logic Details:
 - Ввести явный предикат `hasLivingHuman(state, excludingUserId?)`, который считает только `player.alive && !player.phantom`; он заменяет ветвление по `ctx.getWebSockets()` в `restorePhantoms`.
 - Для restart сначала удалить прежнюю runtime-сущность этого пользователя, затем оценить остальных живых людей. Только если их нет, пересобрать roster из saved replay; после этого занять назначенный spawn респавнящимся игроком. Если другой живой есть, не вызывать restore и не удалять/добавлять фантомы.
 - Для обычного первого входа одиночного игрока `prepareState` может восстановить saved replay-фантомы. При присоединении второго игрока UC 2 освобождает ровно его слот и рассылает обновление.

Tests:
`worker/room-selection.test.ts`
 - description: restart beside a live player neither restores absent replays nor changes the existing phantom roster.
   requirements: R5, R6
   input: state with one alive human, dead/restarting user and saved replay rows for free slots.
   workflow: restart socket --evaluate living humans--> connected state
   expected outcome: no new `phantom=true` players; existing live human remains unchanged.
 - description: solo restart restores saved replay phantoms before its player is added, excluding the allocated player spawn.
   requirements: R5
   input: state with no alive humans and saved replays.
   workflow: solo restart --restore roster then allocate player--> published state
   expected outcome: permitted saved phantoms exist only on slots not occupied by the player.

## Implementation checklist

1. [ ] Add this active specification to the repository and reuse the existing pause/orientation specification without modifying its contract.
2. [ ] Make `RoomDurableObject` derive `roomData` and socket snapshot from one prepared roster; add an atomic occupied-spawn replacement helper with a UC 2 traceability docstring.
3. [ ] Replace socket-count restart logic with `alive && !phantom` membership logic and enforce the solo-only restore rule.
4. [ ] Broadcast a full `room.state` after each committed roster mutation and retain `player.joined` as non-authoritative UI notification.
5. [ ] Add client phantom-roster reconciliation and use it for bootstrap/resync; leave offline cached phantom behavior unchanged.
6. [ ] Add Worker and client regressions; run `npm run cf:test`, `npm run build`, `npm run lint`, `git diff --check`, and the specification validator if its configured environment is available.

## Open questions

- Non-blocking: this plan treats a disconnected but still `alive` player retained during the existing 15-second reconnect grace period as a living player. Therefore it suppresses phantom restoration until the room cleanup removes that player; this prevents a reconnect from seeing newly created phantoms.
- Non-blocking: the plan synchronizes roster membership and uses current snapshots for entity state. It does not broaden this slice into redesigning replay trajectory simulation or food arbitration; those need separate authority rules if they are later made fully server-authoritative.

## Decision log

- 2026-09-15: Chosen authority is the Durable Object `SimulationState.players` roster, distributed through full `room.state`; REST `RoomData.phantoms` is bootstrap data, not a competing membership source.
- 2026-09-15: A player replaces the phantom on its own allocated spawn, rather than deleting an unrelated lowest-score phantom as a side effect of `safeSpawn` failure.
- 2026-09-15: «Игрок играет в сетевом режиме» is represented by authoritative `alive && !phantom` state, not a presently open WebSocket; this deliberately includes reconnect grace.
