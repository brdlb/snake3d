import * as THREE from 'three';
import { Loop } from './Loop';
import { InputManager } from './Input';
import { Snake } from '../entities/Snake';
import { World, FOOD_COLORS, WORLD_SIZE } from '../entities/World';
import { Phantom } from '../entities/Phantom';
import { getSpawnPoint, getRandomSpawnIndex } from '../entities/SpawnPoints';
import { ParticleSystem } from '../graphics/ParticleSystem';

import { SettingsManager } from './SettingsManager';
import { SceneManager } from '../graphics/SceneManager';
import { CameraController } from './CameraController';
import { PostProcessManager } from '../graphics/PostProcessManager';
import { getRenderableSegmentIndices } from '../graphics/SnakeRendering';
import { SettingsUI } from '../ui/SettingsUI';
import { GameOverUI } from '../ui/GameOverUI';
import { GameHUD } from '../ui/GameHUD';
import { WelcomeScreen } from '../ui/WelcomeScreen';
import { LeaderboardUI } from '../ui/LeaderboardUI';
import { SoundManager } from '../audio/SoundManager';
import { ReplayRecorder } from './ReplaySystem';
import { NetworkManager } from '../network/NetworkManager';
import { NetworkStatusUI } from '../network/NetworkStatusUI';
import { PauseUI, GameStats } from '../ui/PauseUI';
import type { ReplayData, RoomData } from '../types/replay';
import { replaceRoomInAddress } from '../utils/RoomUrl';
import type {
  PlayerDirectionChanged,
  PlayerDied,
  PlayerStateChanged,
  RoomSnapshot,
  SnakeState,
} from '../../shared/realtime';
import {
  advanceLiveOpponent,
  applyLiveDirectionState,
  findLocalPlayer,
  isLiveOpponent,
} from './livePlayers';

interface Pulse {
  color: THREE.Color;
  startTime: number;
  speed: number;
  originIndex: number; // Index of head when pulse started (always 0)
}

import { Pathfinder } from './Pathfinder';
import { OfflineDataManager } from '../utils/OfflineDataManager';
import { normalizeSnakeAppearance, type SnakeAppearance } from '../../shared/appearance';
import { createSnakePatternMesh, markSnakePatternsUpdated, setSnakePatternAt } from '../graphics/SnakePatternMaterial';

export class Game {
  private settingsManager: SettingsManager;
  private sceneManager: SceneManager;
  private cameraController: CameraController;
  private postProcess: PostProcessManager;
  private settingsUI: SettingsUI;
  private gameOverUI: GameOverUI;
  private pauseUI: PauseUI;
  private hud: GameHUD;
  private welcomeScreen: WelcomeScreen;
  private leaderboardUI: LeaderboardUI;
  private soundManager: SoundManager;
  private pathfinder: Pathfinder;
  private offlineManager: OfflineDataManager;

  private loop: Loop;
  private input: InputManager;

  private snake: Snake;
  private world: World;

  // Visuals
  private snakeMesh: THREE.InstancedMesh;
  private foodMesh: THREE.InstancedMesh;
  private particleSystem: ParticleSystem;

  // Shared Materials
  private foodMaterial: THREE.MeshBasicMaterial;

  // Helpers for InstancedMesh
  private dummy: THREE.Object3D;
  private _color: THREE.Color;
  private pulses: Pulse[] = [];
  private time: number = 0;
  private score: number = 0;
  private currentSPM: number = 300;
  private fpsTime: number = 0;
  private frames: number = 0;
  private isWaitingForStart: boolean = true;

  private _visibilityHandler: () => void;
  private _blurHandler: () => void;

  // Async Multiplayer: Phantoms & Replay
  private phantoms: Phantom[] = [];
  private liveOpponents: Array<{
    id: string;
    name: string;
    score: number;
    speed: number;
    alive: boolean;
    phantom: boolean;
    color: string;
    appearance: SnakeAppearance;
    segments: THREE.Vector3[];
    direction: THREE.Quaternion;
    directionVector: THREE.Vector3;
    up: THREE.Vector3;
    elapsed: number;
    serverTick: number;
    serverTime: number;
    replay?: ReplayData;
    replayIndex: number;
  }> = [];
  private livePhantomReplays = new Map<string, ReplayData>();
  private deadLivePhantoms = new Set<string>();
  private localEntityId: string | null = null;
  private phantomMesh: THREE.InstancedMesh | null = null;
  private replayRecorder: ReplayRecorder | null = null;
  private networkManager: NetworkManager;
  private currentSeed: number = 0;

  // Pause & Stats
  private isPaused: boolean = false;
  private gameStats: GameStats = {
    score: 0,
    length: 5,
    time: 0,
    distance: 0,
    avgSpeed: 0,
    maxSpeed: 0,
    foodCount: { green: 0, blue: 0, pink: 0, total: 0 },
  };
  // Accumulator for average speed calculation (sum of speeds per frame / frames)
  // Or better: integrate speed over time.
  private totalSpeedAccumulator: number = 0;
  private speedSamples: number = 0;
  private playerSpawnIndex: number = 0;
  private playerName: string;

  private lastRecordedDirection: THREE.Vector3 = new THREE.Vector3();
  private liveWorld = false;
  private isSpectating = false;
  private selectedRoomSeed: number | null = null;
  private initialSpectatorPromise: Promise<void> | null = null;
  private liveEventTicks = new Map<string, number>();
  private lastLiveTick: number | null = null;
  private spectatorBanner: HTMLDivElement | null = null;
  private playerTick = 0;
  private localInputSeq = 0;
  private localStateSeq = 0;
  private localSnakeInitialized = false;
  private wasBoosting = false;
  private appearance: SnakeAppearance;
  private appearanceSaveTimer: number | null = null;

  private logAction(action: string, data: unknown): void {
    console.log(`[ActionLog] ${action}`, data);
  }

  private positionData(position: THREE.Vector3) {
    return { x: position.x, y: position.y, z: position.z };
  }

  private changeAppearance(appearance: SnakeAppearance) {
    this.appearance = normalizeSnakeAppearance(appearance);
    localStorage.setItem('snake3d_appearance', JSON.stringify(this.appearance));
    if (this.appearanceSaveTimer !== null) window.clearTimeout(this.appearanceSaveTimer);
    this.appearanceSaveTimer = window.setTimeout(() => {
      this.appearanceSaveTimer = null;
      this.networkManager.sendAppearance(this.appearance);
      const user = this.networkManager.getUser();
      if (user) void this.networkManager.updateUser({ settings: { ...user.settings, snakeAppearance: this.appearance } })
        .catch((error) => console.warn('[Game] Could not save snake appearance', error));
    }, 150);
  }

  constructor() {
    let savedAppearance: unknown;
    try { savedAppearance = JSON.parse(localStorage.getItem('snake3d_appearance') ?? 'null'); } catch { savedAppearance = null; }
    this.appearance = normalizeSnakeAppearance(savedAppearance);
    // Initialize Player Name (Persistent)
    this.playerName =
      localStorage.getItem('snake3d_player_name') || `Player${Math.floor(Math.random() * 10000)}`;
    localStorage.setItem('snake3d_player_name', this.playerName);

    // 1. Managers Setup
    this.settingsManager = new SettingsManager();
    this.sceneManager = new SceneManager(this.settingsManager.cameraConfig.fov);

    this.cameraController = new CameraController(
      this.sceneManager.camera,
      this.settingsManager.cameraConfig,
      this.sceneManager.scene,
    );

    this.postProcess = new PostProcessManager(
      this.sceneManager.renderer,
      this.sceneManager.scene,
      this.sceneManager.camera,
      this.settingsManager.bloomConfig,
    );

    // Settings UI
    this.settingsUI = new SettingsUI(
      this.settingsManager,
      () => {
        this.cameraController.updateConfig(this.settingsManager.cameraConfig);
        this.postProcess.updateBloomConfig(this.settingsManager.bloomConfig);
      },
      () => {
        // On Close Callback
        this.settingsUI.hide();
        this.hud.togglePauseButton(true);
        this.pauseUI.show();
      },
    );

    // Leaderboard UI
    this.leaderboardUI = new LeaderboardUI(this.playerName);

    this.gameOverUI = new GameOverUI(
      () => {
        void this.resetGame('restart');
      },
      () => {
        void this.resetGame('next');
      },
      () => this.leaderboardUI.show(),
    );
    this.hud = new GameHUD();

    this.pauseUI = new PauseUI(
      () => this.togglePause(),
      () => {
        // When opening settings:
        this.pauseUI.hide(); // Hide Pause UI
        this.hud.togglePauseButton(false); // Hide Pause Button
        this.settingsUI.show(); // Show Settings
      },
      () => this.leaderboardUI.show(),
      (locked) => void this.setOrientationLock(locked),
      this.appearance,
      (appearance) => this.changeAppearance(appearance),
    );

    // Add Pause Button to HUD
    this.hud.addPauseButton(() => this.togglePause());

    // 2. Window Events override
    // We need to hook into resize to update post process as well
    window.addEventListener('resize', this.onWindowResize.bind(this));

    // 3. Initialize Core Systems
    this.loop = new Loop();
    this.input = new InputManager();

    // 4. Initialize Game Entities
    this.world = new World(WORLD_SIZE);

    // Начальная точка спауна (будет обновлена при initializeRoom)
    this.playerSpawnIndex = getRandomSpawnIndex();
    const initialSpawn = getSpawnPoint(this.playerSpawnIndex);
    this.snake = new Snake(initialSpawn.position.clone(), initialSpawn.direction.clone());

    this.soundManager = new SoundManager(this.sceneManager, this.world, this.settingsManager);

    // 5. Setup Visuals
    const textureLoader = new THREE.TextureLoader();
    const texture = textureLoader.load(
      'sp.png',
      () => console.log('Texture loaded successfully'),
      undefined,
      (err) => console.error('Error loading texture', err),
    );
    texture.colorSpace = THREE.SRGBColorSpace;

    // Setup InstancedMesh
    this.snakeMesh = createSnakePatternMesh(10000, texture);
    this.snakeMesh.count = 0; // Starts empty
    this.snakeMesh.castShadow = true;
    this.snakeMesh.receiveShadow = true;
    this.snakeMesh.frustumCulled = false;
    this.sceneManager.scene.add(this.snakeMesh);

    // Helpers
    this.dummy = new THREE.Object3D();
    this._color = new THREE.Color();

    // Food
    this.foodMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, map: texture });
    const foodGeo = new THREE.BoxGeometry(0.8, 0.8, 0.8);
    this.foodMesh = new THREE.InstancedMesh(foodGeo, this.foodMaterial, this.world.FOOD_COUNT);
    this.foodMesh.count = this.world.FOOD_COUNT;
    this.foodMesh.castShadow = true;
    this.sceneManager.scene.add(this.foodMesh);

    // Scene Walls
    this.sceneManager.setupWalls(this.world.size);

    // Particles
    this.particleSystem = new ParticleSystem(this.sceneManager.scene, texture);

    // Pathfinder
    this.pathfinder = new Pathfinder(this.sceneManager.scene, this.world);

    // Phantom Mesh (ghostly appearance)
    this.phantomMesh = createSnakePatternMesh(10000, texture, 0.5);
    this.phantomMesh.count = 0;
    this.phantomMesh.frustumCulled = false;
    this.sceneManager.scene.add(this.phantomMesh);

    // Network Manager
    this.networkManager = NetworkManager.getInstance();

    // Offline Data Manager - для работы в оффлайн режиме
    this.offlineManager = new OfflineDataManager();
    this.offlineManager.setupOnlineHandler(this.networkManager);

    new NetworkStatusUI();

    // Listen for room data (phantoms)
    this.networkManager.on('game.saved', (result: { saved: boolean; message: string }) => {
      console.log(`[Game] Game result: ${result.message}`);
      if (result.saved) {
        this.gameOverUI.setLoading(false);
        this.gameOverUI.setSaveStatus(result.message);
      }
    });

    // Check if already authenticated (initialized in main.ts)
    const currentUser = this.networkManager.getUser();
    if (currentUser) {
      console.log(`[Game] Initial player name sync: ${currentUser.username}`);
      this.playerName = currentUser.username;
      localStorage.setItem('snake3d_player_name', this.playerName);
      // LeaderboardUI might not be initialized yet if this is called early,
      // but we are in constructor, LeaderboardUI is init at line 140.
      // We are at line ~250. So it is strictly safe.
      this.leaderboardUI.setPlayerName(this.playerName);
      if (currentUser.settings.snakeAppearance) {
        this.appearance = normalizeSnakeAppearance(currentUser.settings.snakeAppearance);
        localStorage.setItem('snake3d_appearance', JSON.stringify(this.appearance));
        this.pauseUI.setAppearance(this.appearance);
      }
    }

    // Listen for authentication to sync player name (reconnects)
    this.networkManager.on('authenticated', (result: any) => {
      if (result.user && result.user.username) {
        console.log(`[Game] Syncing player name from server: ${result.user.username}`);
        this.playerName = result.user.username;
        localStorage.setItem('snake3d_player_name', this.playerName);
        this.leaderboardUI.setPlayerName(this.playerName);
      }
      if (result.user?.settings?.snakeAppearance) {
        this.appearance = normalizeSnakeAppearance(result.user.settings.snakeAppearance);
        localStorage.setItem('snake3d_appearance', JSON.stringify(this.appearance));
        this.pauseUI.setAppearance(this.appearance);
      }
    });
    this.networkManager.on('roomSocketConnected', () => {
      if (this.liveWorld && !this.isSpectating) this.sendLivePlayerState('reconnect');
    });
    this.networkManager.on('room.state', (snapshot: RoomSnapshot) =>
      this.applyLiveSnapshot(snapshot),
    );
    this.networkManager.on('room.syncRequested', () => {
      if (this.liveWorld && !this.isSpectating) this.sendLivePlayerState('spectator-sync');
    });
    this.networkManager.on('player.joined', () => this.networkManager.requestResync());
    this.networkManager.on('room.left', (change: any) => {
      if (change?.entityId)
        this.liveOpponents = this.liveOpponents.filter(
          (opponent) => opponent.id !== change.entityId,
        );
    });
    this.networkManager.on('player.directionChanged', (change: PlayerDirectionChanged) =>
      this.applyLiveDirection(change),
    );
    this.networkManager.on('player.state', (change: PlayerStateChanged) =>
      this.applyLiveState(change),
    );
    this.networkManager.on('food.changed', (change: any) => this.applyLiveFood(change));
    this.networkManager.on('player.died', (death: PlayerDied) => this.applyLiveDeath(death));
    this.networkManager.on('player.appearance', (change: any) => {
      const opponent = this.liveOpponents.find((candidate) => candidate.id === change?.entityId);
      if (opponent && change?.appearance) opponent.appearance = normalizeSnakeAppearance(change.appearance);
    });

    // Visibility Handler to stop loop when tab is hidden
    this._visibilityHandler = () => {
      if (document.hidden) {
        if (
          !this.isSpectating &&
          !this.isPaused &&
          !this.isGameOver &&
          !this.isWaitingForStart
        ) {
          this.togglePause();
          this.loop.stop();
        }
      } else {
        this.loop.start();
      }
    };
    document.addEventListener('visibilitychange', this._visibilityHandler);

    // Blur Handler to pause when window loses focus
    this._blurHandler = () => {
      if (
        !this.isSpectating &&
        !this.isPaused &&
        !this.isGameOver &&
        !this.isWaitingForStart
      ) {
        this.togglePause();
      }
    };
    window.addEventListener('blur', this._blurHandler);

    // Input Bindings
    this.setupInputs();

    // Start Loop (will only render while waiting for start)
    this.loop.add(this.update.bind(this));
    this.loop.add(this.render.bind(this));
    this.loop.start();

    // Welcome Screen - показываем приветственный экран
    this.welcomeScreen = new WelcomeScreen((mode, roomSeed) => this.handleGameStart(mode, roomSeed));
    if (new URLSearchParams(window.location.search).get('room') === null) {
      this.initialSpectatorPromise = this.handleGameStart('spectator');
    }

    // Initialize Player Name
    const user = this.networkManager.getUser();
    // Check for stored name fallback
    const storedName = localStorage.getItem('snake3d_username');
    this.playerName =
      user?.username || storedName || `Player ${Math.floor(Math.random() * 9000) + 1000}`;
  }

  private setupInputs() {
    const handleTurn = (action: () => void) => {
      if (this.isSpectating) return;
      const prevDir = this.snake.direction.clone();
      action();
      if (!this.snake.direction.equals(prevDir)) {
        if (this.liveWorld) {
          const state = this.livePlayerState();
          this.networkManager.sendDirection({
            type: 'direction',
            seq: ++this.localInputSeq,
            step: this.playerTick,
            head: this.positionData(this.snake.getHead()),
            segments: state.segments,
            direction: state.direction,
            up: state.up,
          });
        }
        this.pathfinder.updatePathVisualization(
          this.snake.getHead(),
          this.snake.segments,
          this.snake.direction,
        );
      }
    };

    this.input.on('left', () => handleTurn(() => this.snake.rotate(Math.PI / 2)));
    this.input.on('right', () => handleTurn(() => this.snake.rotate(-Math.PI / 2)));
    this.input.on('rollLeft', () => handleTurn(() => this.snake.roll(-Math.PI / 2)));
    this.input.on('rollRight', () => handleTurn(() => this.snake.roll(Math.PI / 2)));
    this.input.on('pause', () => this.togglePause()); // Escape key
  }

  /**
   * Инициализация комнаты с фантомами
   */
  private initializeRoom(data: RoomData): void {
    this.liveWorld = this.networkManager.isConnected();
    this.liveOpponents = [];
    this.livePhantomReplays = new Map(
      data.phantoms.map((replay) => [`phantom:${replay.id}`, replay]),
    );
    this.deadLivePhantoms.clear();
    this.playerTick = 0;
    this.localInputSeq = 0;
    this.localStateSeq = 0;
    this.localSnakeInitialized = false;
    this.wasBoosting = false;
    this.currentSeed = data.seed;
    this.pauseUI.updateRoom(data.seed);

    // Обновляем UI с seed комнаты
    // this.networkStatusUI.setSeed(data.seed);

    // Обновляем seed в мире для детерминированной генерации еды
    this.world.setSeed(data.seed);

    // Используем точку спавна, назначенную сервером
    this.playerSpawnIndex = data.playerSpawnIndex;
    const spawn = getSpawnPoint(this.playerSpawnIndex);
    const serverSpawn = data.playerSpawn;
    const spawnPosition = serverSpawn
      ? new THREE.Vector3(serverSpawn.position.x, serverSpawn.position.y, serverSpawn.position.z)
      : spawn.position.clone();
    const spawnDirection = serverSpawn
      ? this.orientationQuaternion(
          new THREE.Vector3(
            serverSpawn.direction.x,
            serverSpawn.direction.y,
            serverSpawn.direction.z,
          ),
          new THREE.Vector3(serverSpawn.up.x, serverSpawn.up.y, serverSpawn.up.z),
        )
      : spawn.direction.clone();

    // Сбрасываем змейку на выбранную точку спауна
    this.snake.reset(spawnPosition, spawnDirection);

    // Phantoms are fully client-side replay entities. Their recorded input
    // controls turns, while their food effects are calculated locally.
    this.phantoms = data.phantoms
      .map((replayData: ReplayData, index: number) => {
        this.logAction('phantom.received', { seed: data.seed, index, replay: replayData });
        return new Phantom(replayData, index);
      })
      .filter((phantom) => {
        const overlapsPlayer = phantom.segments.some((phantomSegment) =>
          this.snake.segments.some(
            (playerSegment) => phantomSegment.distanceToSquared(playerSegment) < 0.1,
          ),
        );
        if (overlapsPlayer)
          this.logAction('phantom.rejected', {
            seed: data.seed,
            replayId: phantom.replayPlayer.replayId,
            reason: 'spawn-overlap',
          });
        return !overlapsPlayer;
      });

    // Выводим координаты и направление респавна
    const spawnDir = new THREE.Vector3(0, 0, -1).applyQuaternion(spawnDirection);
    console.log(
      `[Game] Spawn position: (${spawnPosition.x}, ${spawnPosition.y}, ${spawnPosition.z})`,
    );
    console.log(
      `[Game] Spawn direction: (${spawnDir.x.toFixed(2)}, ${spawnDir.y.toFixed(2)}, ${spawnDir.z.toFixed(2)})`,
    );
    console.log(
      `[Game] Initialized room with seed ${data.seed}, spawn ${this.playerSpawnIndex}, ${this.phantoms.length} phantoms`,
    );

    if (this.isSpectating) {
      // Наблюдатель не управляет змейкой и не должен создавать реплей.
      this.replayRecorder?.stop();
      this.replayRecorder = null;
    } else {
      // Инициализируем запись реплея с индексом спауна и начальной скоростью
      this.replayRecorder = new ReplayRecorder(data.seed, this.playerSpawnIndex, this.currentSPM);
      // Начинаем запись с начальным направлением
      const initialDir = new THREE.Vector3(0, 0, -1).applyQuaternion(spawnDirection);
      if (Math.abs(initialDir.x) > 0.5) initialDir.set(Math.sign(initialDir.x), 0, 0);
      else if (Math.abs(initialDir.y) > 0.5) initialDir.set(0, Math.sign(initialDir.y), 0);
      else initialDir.set(0, 0, Math.sign(initialDir.z));
      this.lastRecordedDirection.copy(initialDir);
      this.replayRecorder.start(initialDir, spawnPosition);
    }
  }

  /**
   * Обработчик нажатия кнопки "Старт" на приветственном экране
   * Инициализирует аудио и запускает игру
   */
  private async handleGameStart(
    mode: 'player' | 'spectator' = 'player',
    selectedRoomSeed?: number,
  ): Promise<void> {
    if (mode === 'player' && this.initialSpectatorPromise && this.selectedRoomSeed === null) {
      await this.initialSpectatorPromise.catch(() => undefined);
    }
    // Инициализируем AudioContext по клику пользователя
    if (mode === 'player') await this.soundManager.initAudio();

    // Запрашиваем комнату с сервера (null = случайный seed)
    this.isSpectating = mode === 'spectator';
    if (this.networkManager.isConnected()) {
      const requestedSeed = new URLSearchParams(window.location.search).get('room');
      const invitedSeed =
        requestedSeed !== null && /^\d+$/.test(requestedSeed) ? Number(requestedSeed) : null;
      const roomSeed = selectedRoomSeed ?? invitedSeed ?? (this.isSpectating ? null : this.selectedRoomSeed);
      const action = this.isSpectating ? 'spectate' : roomSeed === null ? 'initial' : 'join';

      try {
        const room = await this.networkManager.requestRoom(action, roomSeed ?? undefined);
        this.selectedRoomSeed = room.seed;
        if (!this.isSpectating) replaceRoomInAddress(room.seed);
        this.initializeRoom(room);
        // The socket can deliver its initial snapshot before room initialization
        // finishes. Request one more snapshot after the local room is ready.
        if (this.liveWorld) this.networkManager.requestResync();
        if (!this.isSpectating) this.cachePhantomsForOffline(room.phantoms);
      } catch (error) {
        console.warn('[Game] Failed to enter online room, falling back to local game:', error);
        await this.initializeOfflineRoom();
      }
    } else {
      // Оффлайн режим — загружаем кэшированные фантомы или генерируем локально
      await this.initializeOfflineRoom();
    }

    // Снимаем флаг ожидания старта
    this.isWaitingForStart = false;
    if (this.isSpectating) {
      this.cameraController.setOrbitMode(
        new THREE.Vector3(WORLD_SIZE / 2, WORLD_SIZE / 2, WORLD_SIZE / 2),
      );
      this.showSpectatorBanner();
    } else {
      this.cameraController.stopOrbitMode();
      this.spectatorBanner?.remove();
      this.spectatorBanner = null;
    }

    console.log('Game started!');
  }

  private showSpectatorBanner(): void {
    this.spectatorBanner = document.createElement('div');
    this.spectatorBanner.className = 'spectator-banner';
    this.spectatorBanner.textContent = `SPECTATING ROOM ${this.currentSeed}`;
    document.body.appendChild(this.spectatorBanner);
  }

  private applyLiveSnapshot(snapshot: RoomSnapshot) {
    if (
      !snapshot ||
      snapshot.seed !== this.currentSeed ||
      !Array.isArray(snapshot.food) ||
      !Array.isArray(snapshot.players)
    )
      return;
    const me = this.networkManager.getUser()?.id;
    this.liveEventTicks.clear();
    this.lastLiveTick = snapshot.tick;
    this.world.foodPositions = snapshot.food.map(
      (food: any) => new THREE.Vector3(food.x, food.y, food.z),
    );
    this.world.foodColors = snapshot.food.map(
      (food: any) =>
        new THREE.Color(
          food.kind === 'green'
            ? FOOD_COLORS.GREEN
            : food.kind === 'pink'
              ? FOOD_COLORS.PINK
              : FOOD_COLORS.BLUE,
        ),
    );
    const localPlayer = findLocalPlayer(snapshot.players, this.localEntityId, me);
    this.localEntityId = localPlayer?.entityId ?? null;
    if (!this.localSnakeInitialized && localPlayer?.segments?.length && localPlayer.direction) {
      const direction = new THREE.Vector3(
        localPlayer.direction.x,
        localPlayer.direction.y,
        localPlayer.direction.z,
      );
      const up = new THREE.Vector3(
        localPlayer.up?.x ?? 0,
        localPlayer.up?.y ?? 1,
        localPlayer.up?.z ?? 0,
      );
      this.snake.applyAuthoritativeState(
        localPlayer.segments.map(
          (position: any) => new THREE.Vector3(position.x, position.y, position.z),
        ),
        this.orientationQuaternion(direction, up),
        localPlayer.speed ?? 300,
      );
      this.score = localPlayer.score ?? this.score;
      this.currentSPM = localPlayer.speed ?? this.currentSPM;
      this.localSnakeInitialized = true;
    }
    this.liveOpponents = snapshot.players
      .filter((player: any) => isLiveOpponent(player, this.localEntityId, me))
      .map((player: any) => {
        this.liveEventTicks.set(player.entityId, player.lastInputSeq ?? -1);
        return this.createLiveOpponent(player, snapshot.tick, snapshot.serverTime);
      });
  }

  private createLiveOpponent(player: any, tick = 0, serverTime = Date.now()) {
    const directionVector = new THREE.Vector3(
      player.direction?.x ?? 0,
      player.direction?.y ?? 0,
      player.direction?.z ?? -1,
    ).normalize();
    const up = new THREE.Vector3(
      player.up?.x ?? 0,
      player.up?.y ?? 1,
      player.up?.z ?? 0,
    ).normalize();
    const direction = this.orientationQuaternion(directionVector, up);
    const segments = (player.segments ?? []).map(
      (position: any) => new THREE.Vector3(position.x, position.y, position.z),
    );
    const replay = player.phantom ? this.livePhantomReplays.get(player.id) : undefined;
    const replayIndex = replay
      ? replay.trajectoryLog.findIndex((change) => {
          const offset = new THREE.Vector3(
            change.position.x,
            change.position.y,
            change.position.z,
          ).sub(segments[0]);
          return (
            offset.dot(directionVector) >= 0 && offset.cross(directionVector).lengthSq() < 0.01
          );
        })
      : -1;
    return {
      id: player.entityId ?? player.id,
      name: player.name ?? 'Player',
      score: player.score ?? 0,
      speed: player.speed ?? 300,
      alive: player.alive !== false && !this.deadLivePhantoms.has(player.entityId ?? player.id),
      phantom: player.phantom === true,
      color: player.color ?? '#ffffff',
      appearance: normalizeSnakeAppearance(player.appearance),
      segments,
      direction,
      directionVector,
      up,
      elapsed: 0,
      serverTick: tick,
      serverTime,
      replay,
      replayIndex: replayIndex < 0 ? 0 : replayIndex,
    };
  }

  private orientationQuaternion(direction: THREE.Vector3, up: THREE.Vector3) {
    const right = direction.clone().cross(up).normalize();
    return new THREE.Quaternion().setFromRotationMatrix(
      new THREE.Matrix4().makeBasis(right, up, direction.clone().negate()),
    );
  }

  private applyLiveDirection(change: PlayerDirectionChanged) {
    const entityId = change?.entityId;
    if (!entityId || !change.direction || !change.up) return;
    if (entityId === this.localEntityId) return;
    const lastSeq = this.liveEventTicks.get(entityId);
    if (lastSeq !== undefined && change.seq <= lastSeq) return;
    this.liveEventTicks.set(entityId, change.seq);
    const opponent = this.liveOpponents.find((existing) => existing.id === entityId);
    if (!opponent) {
      this.networkManager.requestResync();
      return;
    }
    applyLiveDirectionState(opponent, change, (direction, up) =>
      this.orientationQuaternion(direction, up),
    );
  }

  private applyLiveState(change: PlayerStateChanged) {
    if (change.entityId === this.localEntityId) return;
    const opponent = this.liveOpponents.find((existing) => existing.id === change.entityId);
    if (!opponent) {
      this.networkManager.requestResync();
      return;
    }
    opponent.segments = change.segments.map(
      (position) => new THREE.Vector3(position.x, position.y, position.z),
    );
    opponent.directionVector
      .set(change.direction.x, change.direction.y, change.direction.z)
      .normalize();
    opponent.up.set(change.up.x, change.up.y, change.up.z).normalize();
    opponent.direction.copy(this.orientationQuaternion(opponent.directionVector, opponent.up));
    opponent.score = change.score;
    opponent.speed = Math.max(60, change.speed);
    opponent.elapsed = 0;
    opponent.serverTick = change.step;
    opponent.serverTime = change.serverTime;
  }

  private livePlayerState(): SnakeState {
    const direction = new THREE.Vector3(0, 0, -1).applyQuaternion(this.snake.direction);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.snake.direction);
    return {
      segments: this.snake.segments.map((segment) => this.positionData(segment)),
      direction: this.positionData(direction.round()),
      up: this.positionData(up.round()),
      score: this.score,
      speed: this.input.isActionPressed('boost') ? 1200 : this.currentSPM,
    };
  }

  private sendLivePlayerState(
    reason: 'food' | 'speed' | 'reconnect' | 'spawn' | 'spectator-sync',
  ) {
    this.networkManager.sendPlayerState({
      type: 'state',
      seq: ++this.localStateSeq,
      step: this.playerTick,
      reason,
      ...this.livePlayerState(),
    });
  }

  private applyLiveFood(change: any) {
    if (!change?.removed || !change?.added) return;
    if (
      typeof change.tick === 'number' &&
      this.lastLiveTick !== null &&
      change.tick < this.lastLiveTick
    ) {
      this.networkManager.requestResync();
      return;
    }
    if (typeof change.tick === 'number')
      this.lastLiveTick = Math.max(this.lastLiveTick ?? change.tick, change.tick);
    const removed = new THREE.Vector3(change.removed.x, change.removed.y, change.removed.z);
    const index = this.world.foodPositions.findIndex((position) => position.equals(removed));
    const added = new THREE.Vector3(change.added.x, change.added.y, change.added.z);
    const color = new THREE.Color(
      change.added.kind === 'green'
        ? FOOD_COLORS.GREEN
        : change.added.kind === 'pink'
          ? FOOD_COLORS.PINK
          : FOOD_COLORS.BLUE,
    );
    if (index >= 0) {
      this.world.foodPositions[index] = added;
      this.world.foodColors[index] = color;
    } else {
      this.world.foodPositions.push(added);
      this.world.foodColors.push(color);
    }
    if (change.entityId) {
      if (change.entityId === this.localEntityId) {
        if (typeof change.score === 'number') this.score = change.score;
        if (typeof change.speed === 'number') this.currentSPM = change.speed;
        if (typeof change.length === 'number') this.syncSnakeLength(change.length);
      } else {
        const opponent = this.liveOpponents.find((existing) => existing.id === change.entityId);
        if (opponent) {
          if (typeof change.score === 'number') opponent.score = change.score;
          if (typeof change.speed === 'number') opponent.speed = change.speed;
          if (typeof change.length === 'number') this.syncOpponentLength(opponent, change.length);
        }
      }
    }
  }

  private applyLiveDeath(death: PlayerDied) {
    const player = death?.player;
    if (!player) return;
    const isLocalPlayer = player.entityId === this.localEntityId;
    this.logAction('player.death', {
      seq: player.lastStateSeq,
      playerId: player.id,
      entityId: player.entityId,
      reason: death.reason ?? 'unknown reason',
      position: death.position,
    });
    if (!isLocalPlayer) {
      const opponent = this.createLiveOpponent(player, 0, death.serverTime);
      this.liveOpponents = [
        ...this.liveOpponents.filter((existing) => existing.id !== player.entityId),
        opponent,
      ];
      return;
    }
    if (!this.isGameOver) void this.handleGameOver();
  }

  private syncOpponentLength(opponent: { segments: THREE.Vector3[] }, length: number) {
    while (opponent.segments.length < length)
      opponent.segments.push(opponent.segments[opponent.segments.length - 1].clone());
    if (opponent.segments.length > length) opponent.segments.length = length;
  }
  private syncSnakeLength(length: number) {
    while (this.snake.segments.length < length)
      this.snake.segments.push(this.snake.segments[this.snake.segments.length - 1].clone());
    if (this.snake.segments.length > length) this.snake.segments.length = length;
  }

  /**
   * Инициализация комнаты в оффлайн режиме с кэшированными фантомами
   */
  private async initializeOfflineRoom(): Promise<void> {
    this.liveWorld = false;
    this.isSpectating = false;
    const localSeed = Math.floor(Math.random() * 1000000);
    const localSpawnIndex = getRandomSpawnIndex();

    try {
      // Пытаемся загрузить кэшированные фантомы
      const cachedPhantoms = await this.loadCachedPhantoms();

      this.initializeRoom({
        seed: localSeed,
        phantoms: cachedPhantoms,
        playerSpawnIndex: localSpawnIndex,
      });

      console.log(`[Game] Offline room initialized with ${cachedPhantoms.length} cached phantoms`);
    } catch (error) {
      console.warn('[Game] Failed to load cached phantoms, starting with empty room:', error);
      this.initializeRoom({ seed: localSeed, phantoms: [], playerSpawnIndex: localSpawnIndex });
    }
  }

  /**
   * Загрузка кэшированных фантомов из IndexedDB
   */
  private async loadCachedPhantoms(): Promise<any[]> {
    try {
      const cachedData = await this.offlineManager.getGameData('cachedPhantoms');
      if (cachedData && cachedData.phantoms && Array.isArray(cachedData.phantoms)) {
        // Проверяем, не устарели ли данные (кэш на 24 часа)
        const cacheAge = Date.now() - (cachedData.timestamp || 0);
        const MAX_CACHE_AGE = 24 * 60 * 60 * 1000; // 24 часа

        if (cacheAge < MAX_CACHE_AGE) {
          return cachedData.phantoms;
        } else {
          console.log('[Game] Cached phantoms are too old, will use empty room');
        }
      }
    } catch (error) {
      console.error('[Game] Error loading cached phantoms:', error);
    }
    return [];
  }

  /**
   * Кэширование фантомов для использования в оффлайн режиме
   */
  private async cachePhantomsForOffline(phantoms: any[]): Promise<void> {
    try {
      await this.offlineManager.saveGameData('cachedPhantoms', {
        phantoms: phantoms,
        timestamp: Date.now(),
      });
      console.log(`[Game] Cached ${phantoms.length} phantoms for offline play`);
    } catch (error) {
      console.error('[Game] Failed to cache phantoms:', error);
    }
  }

  private onWindowResize() {
    // SceneManager handles camera internal and renderer resize via its own listener
    // But we need to update PostProcess
    this.postProcess.setSize(window.innerWidth, window.innerHeight);
  }

  public dispose() {
    this.loop.stop();
    this.input.destroy();
    window.removeEventListener('resize', this.onWindowResize.bind(this));
    document.removeEventListener('visibilitychange', this._visibilityHandler);
    window.removeEventListener('blur', this._blurHandler);

    // Dispose Managers
    this.sceneManager.dispose();
    this.settingsUI.dispose();
    this.gameOverUI.dispose();
    this.leaderboardUI.dispose();
    this.pauseUI.dispose();
    this.hud.dispose();
    if (this.welcomeScreen) this.welcomeScreen.dispose();
    this.spectatorBanner?.remove();

    // Dispose Resources
    this.snakeMesh.geometry.dispose();
    this.foodMesh.geometry.dispose();
    this.particleSystem.dispose();
    this.pathfinder.dispose();

    // @ts-ignore
    if (this.snakeMesh.material.dispose) this.snakeMesh.material.dispose();
    if (this.foodMaterial.dispose) this.foodMaterial.dispose();
  }

  private togglePause() {
    if (this.isGameOver || this.isWaitingForStart) return;

    this.isPaused = !this.isPaused;

    if (this.isPaused) {
      this.pauseUI.updateStats(this.gameStats);
      this.pauseUI.show();
      this.cameraController.setOrbitMode();
      this.soundManager.setAmbientLowPass(true);
    } else {
      this.pauseUI.hide();
      this.settingsUI.hide(); // Hide settings if they were open
      this.cameraController.stopOrbitMode();
      this.soundManager.setAmbientLowPass(false);
    }
  }

  private async setOrientationLock(locked: boolean) {
    const orientation = screen.orientation as ScreenOrientation & {
      lock?: (orientation: 'landscape') => Promise<void>;
    };
    if (typeof orientation.lock !== 'function') {
      this.pauseUI.setOrientationLocked(false);
      return;
    }

    try {
      if (locked) {
        await orientation.lock('landscape');
      } else {
        orientation.unlock();
      }
    } catch (error) {
      console.warn('[Game] Screen orientation lock is unavailable:', error);
      this.pauseUI.setOrientationLocked(false);
    }
  }

  private isGameOver: boolean = false;

  private update(delta: number) {
    this.time += delta;
    if (!this.input.isActionPressed('boost')) this.restartKeyWasPressed = false;

    // Если ожидаем нажатия кнопки "Старт" — только рендерим сцену
    if (this.isWaitingForStart) {
      // Обновляем камеру для красивого вида
      const head = this.snake.getHead();
      this.cameraController.update(delta, head, this.snake.direction, 0);
      return;
    }

    if (this.isSpectating) {
      if (this.liveWorld)
        for (const opponent of this.liveOpponents)
          advanceLiveOpponent(opponent, delta, (direction, up) =>
            this.orientationQuaternion(direction, up),
          );
      const focus =
        this.liveOpponents[0]?.segments[0] ?? this.phantoms[0]?.getHead() ?? this.snake.getHead();
      this.cameraController.update(delta, focus, this.snake.direction, 0);
      this.particleSystem.update(delta);
      return;
    }

    if (this.isGameOver) {
      // In Game Over, we only update visual systems
      const head = this.snake.getHead();
      this.cameraController.update(delta, head, this.snake.direction, 0);
      this.particleSystem.update(delta);

      // Consume Space: holding it must not start one restart per frame.
      const restartPressed = this.input.isActionPressed('boost');
      if (restartPressed && !this.restartKeyWasPressed) {
        this.restartKeyWasPressed = true;
        void this.resetGame('restart');
      }
      return;
    }

    if (this.isPaused) {
      const head = this.snake.getHead();
      this.cameraController.update(delta, head, this.snake.direction, 0);
      return;
    }

    // Stats Update
    this.gameStats.time += delta;
    this.totalSpeedAccumulator += this.currentSPM * delta;
    this.speedSamples += delta;
    if (this.speedSamples > 0) {
      this.gameStats.avgSpeed = this.totalSpeedAccumulator / this.speedSamples;
    }

    // Stats: Dynamic
    this.gameStats.score = this.score;
    this.gameStats.length = this.snake.segments.length;
    if (this.currentSPM > (this.gameStats.maxSpeed || 0)) {
      this.gameStats.maxSpeed = this.currentSPM;
    }

    // Boost
    const boosting = this.input.isActionPressed('boost');
    if (boosting) {
      this.snake.setSpeed(0.05);
    } else {
      this.snake.setSpeed(60 / this.currentSPM);
    }
    if (this.liveWorld && !this.isSpectating && boosting !== this.wasBoosting) {
      this.wasBoosting = boosting;
      this.sendLivePlayerState('speed');
    }

    // Logic Update
    if (this.liveWorld)
      for (const opponent of this.liveOpponents)
        advanceLiveOpponent(opponent, delta, (direction, up) =>
          this.orientationQuaternion(direction, up),
        );
    if (this.liveWorld) this.checkLivePhantomCollisions();
    const preStepHead = this.snake.getHead().clone();
    if (this.snake.update(delta)) {
      this.playerTick++;
      // Step occurred - check if we need to record a direction change
      if (this.replayRecorder) {
        const currentDir = new THREE.Vector3(0, 0, -1).applyQuaternion(this.snake.direction);
        // Snap to grid
        if (Math.abs(currentDir.x) > 0.5) currentDir.set(Math.sign(currentDir.x), 0, 0);
        else if (Math.abs(currentDir.y) > 0.5) currentDir.set(0, Math.sign(currentDir.y), 0);
        else currentDir.set(0, 0, Math.sign(currentDir.z));

        if (!currentDir.equals(this.lastRecordedDirection)) {
          // Direction changed since the last step!
          // Record it as happening at the PREVIOUS head position (where the turn effectively executed)
          this.replayRecorder.recordDirectionChange(preStepHead, currentDir);
          this.lastRecordedDirection.copy(currentDir);
        }
      }

      // Stats: Distance (1 unit per step roughly, grid based)
      this.gameStats.distance += 1;

      // Calculate pitch based on speed (normalize around 300 SPM)
      // Clamp roughly between 0.8 and 1.5 to stay realistic
      let rate = this.currentSPM / 300;
      if (rate < 0.5) rate = 0.5;
      if (rate > 4.0) rate = 4.0;

      this.soundManager.playStep(rate);

      this.checkCollisions();

      // Update Pathfinder on Step
      this.pathfinder.updatePathVisualization(
        this.snake.getHead(),
        this.snake.segments,
        this.snake.direction,
      );
    }

    // Update phantoms every frame (independently of player step)
    for (const phantom of this.phantoms) {
      if (!phantom.isDeadNow()) {
        // Phantom manages its own speed internally
        const phantomStepped = phantom.update(delta);
        if (phantom.isDeadNow()) {
          const phantomId =
            phantom.replayPlayer.replayId || `phantom-${this.phantoms.indexOf(phantom)}`;
          this.logAction('phantom.death', {
            replayId: phantomId,
            reason: 'replay',
            position: this.positionData(phantom.getHead()),
          });
        }
        if (phantomStepped && !phantom.isDeadNow()) {
          const phantomId =
            phantom.replayPlayer.replayId || `phantom-${this.phantoms.indexOf(phantom)}`;
          phantom.consumeDirectionChange();
          // Safety check: Kill if out of bounds (prevents infinite walking if replay desyncs)
          if (this.world.isOutOfBounds(phantom.getHead())) {
            this.logAction('phantom.death', {
              replayId: phantomId,
              reason: 'bounds',
              position: this.positionData(phantom.getHead()),
            });
            phantom.kill();
            continue;
          }
          // Phantom made a step - check if it eats food
          const phantomHead = phantom.getHead();
          const phantomFoodIndex = this.world.checkFoodCollision(phantomHead);
          if (phantomFoodIndex !== -1) {
            // Determine effects based on food color (same as player)
            const foodColor = this.world.foodColors[phantomFoodIndex];
            const hex = foodColor.getHex();
            let spmChange = 10;
            let growAmount = 1;
            let scorePoints = 1;

            // Apply same food effects as player
            if (hex === FOOD_COLORS.GREEN) {
              spmChange = 50;
              growAmount = 3;
              scorePoints = 5;
            } else if (hex === FOOD_COLORS.BLUE) {
              spmChange = 10;
              growAmount = 5;
              scorePoints = 15;
            } else if (hex === FOOD_COLORS.PINK) {
              spmChange = -10;
              growAmount = 3;
              scorePoints = 3;
            }

            // Apply growth
            for (let i = 0; i < growAmount; i++) {
              phantom.grow();
            }

            // Apply speed change
            phantom.applyFoodEffect(spmChange);

            // Apply score
            phantom.addScore(scorePoints);

            // Respawn food when phantom eats it (phantoms compete with player for food)
            this.logAction('phantom.food', {
              replayId: phantomId,
              index: phantomFoodIndex,
              position: this.positionData(this.world.foodPositions[phantomFoodIndex]),
            });
            this.world.respawnFood(
              this.snake.segments,
              phantomFoodIndex,
              true,
              this.phantoms.flatMap((other) => other.segments),
            );
            this.logAction('food.respawned', {
              by: phantomId,
              index: phantomFoodIndex,
              position: this.positionData(this.world.foodPositions[phantomFoodIndex]),
            });
          }
        }
      }
    }

    // Phantom movement is independent from the player's step, so check
    // their collisions after all phantom positions have been updated.
    this.checkPhantomCollisions();

    const head = this.snake.getHead();

    // Update Settings UI (FPS etc)
    this.frames++;
    this.fpsTime += delta;
    if (this.fpsTime >= 0.5) {
      this.settingsUI.updateFPS(this.frames / this.fpsTime);
      this.frames = 0;
      this.fpsTime = 0;
    }
    this.settingsUI.updateInfo(
      `Head: x:${Math.round(head.x)} y:${Math.round(head.y)} z:${Math.round(head.z)}`,
    );

    // Manual Camera Control
    if (this.input.isLeftMouseDown) {
      this.cameraController.setManualControlActive(true);
      const { x, y } = this.input.getAndResetMouseDelta();
      this.cameraController.applyManualMovement(x, y, 0.005);
    } else {
      this.cameraController.setManualControlActive(false);
    }

    // Camera Update
    this.cameraController.update(delta, head, this.snake.direction, this.snake.getStepProgress());

    // Update Audio
    this.soundManager.update(head);

    // Update Particles
    this.particleSystem.update(delta);

    // Update HUD with all players info
    const currentLength = this.snake.segments.length;
    const speed = this.snake.getStepsPerMinute();

    // Build players list for HUD
    const players = [];

    // A spectator is not part of the room snapshot, so do not add a
    // synthetic "current player" row to the room participant list.
    if (!this.isSpectating) {
      players.push({
        name: this.playerName,
        score: this.score,
        length: currentLength,
        speed: speed,
        isPlayer: true,
        color: '#ffffff',
      });
    }

    // Live opponents come from the room snapshot; replay phantoms stay client-side.
    if (this.liveWorld)
      for (const opponent of this.liveOpponents) {
        players.push({
          name: opponent.name,
          score: opponent.score,
          length: opponent.segments.length,
          speed: opponent.speed,
          isPlayer: false,
          color: opponent.color,
          isDead: !opponent.alive,
        });
      }
    for (const phantom of this.phantoms) {
      // Include dead phantoms so they show up as dead in HUD.
      const name = phantom.getPlayerName();
      players.push({
        name: name,
        score: phantom.getScore(),
        length: phantom.segments.length,
        speed: phantom.getSPM(),
        isPlayer: false,
        color: phantom.getColorHex(),
        isDead: phantom.isDeadNow(),
      });
    }

    this.hud.updatePlayers(players);
  }

  private checkCollisions() {
    const head = this.snake.getHead();
    const snakeColor = new THREE.Color(0xffffff);

    if (this.world.isOutOfBounds(head)) {
      console.log('Game Over: Bounds');
      this.logAction('player.death', {
        tick: this.playerTick,
        reason: 'bounds',
        position: this.positionData(head),
      });
      this.particleSystem.emit(head, this.snake.direction, 50, snakeColor);
      this.handleGameOver('bounds');
      return;
    }

    if (this.world.checkSelfCollision(this.snake.segments)) {
      console.log('Game Over: Self');
      this.logAction('player.death', {
        tick: this.playerTick,
        reason: 'self-collision',
        position: this.positionData(head),
      });
      this.particleSystem.emit(head, this.snake.direction, 50, snakeColor);
      this.handleGameOver('self-collision');
      return;
    }

    if (this.liveWorld) {
      for (const opponent of this.liveOpponents) {
        for (const segment of opponent.segments) {
          if (head.distanceToSquared(segment) < 0.1) {
            console.log('Game Over: Remote player collision');
            this.logAction('player.death', {
              tick: this.playerTick,
              reason: 'remote-player-collision',
              position: this.positionData(head),
              opponentId: opponent.id,
            });
            this.particleSystem.emit(
              head,
              this.snake.direction,
              50,
              new THREE.Color(opponent.color),
            );
            this.handleGameOver('remote-player-collision');
            return;
          }
        }
      }
    }

    if (this.checkPhantomCollisions()) return;

    const foodIndex = this.world.checkFoodCollision(head);
    if (foodIndex !== -1) {
      const eatenColor = this.world.foodColors[foodIndex] || new THREE.Color(0x0088ff);

      // Determine effects based on color
      const hex = eatenColor.getHex();
      let spmChange = 10;
      let growAmount = 1;
      let scorePoints = 1;

      // Green: +50 SPM, +1 Len, +1 Score
      if (hex === FOOD_COLORS.GREEN) {
        spmChange = 50;
        growAmount = 3;
        scorePoints = 5;
        this.gameStats.foodCount.green++;
      }
      // Blue: +10 SPM, +5 Len, +5 Score
      else if (hex === FOOD_COLORS.BLUE) {
        spmChange = 10;
        growAmount = 5;
        scorePoints = 15;
        this.gameStats.foodCount.blue++;
      }
      // Pink: -10 SPM, +1 Len, +1 Score
      else if (hex === FOOD_COLORS.PINK) {
        spmChange = -10;
        growAmount = 3;
        scorePoints = 3;
        this.gameStats.foodCount.pink++;
      }
      this.gameStats.foodCount.total++;
      for (let i = 0; i < growAmount; i++) {
        this.snake.grow();
      }

      // Apply Score
      this.score += scorePoints;
      console.log('Spm: ' + spmChange);
      // Apply Speed Change
      this.currentSPM += spmChange;
      if (this.currentSPM < 60) this.currentSPM = 60; // Minimum speed cap

      if (this.currentSPM < 60) this.currentSPM = 60; // Minimum speed cap

      this.cameraController.triggerShake(0.1);
      this.particleSystem.emit(head, this.snake.direction, 30, eatenColor);
      this.soundManager.playPick();

      // Effect: Skip Step and Color Pulse
      this.snake.skipStep();

      this.pulses.push({
        color: eatenColor.clone(),
        startTime: this.time,
        speed: 15, // Segments per second
        originIndex: 0,
      });

      this.world.respawnFood(
        this.snake.segments,
        foodIndex,
        true,
        this.phantoms.flatMap((phantom) => phantom.segments),
      );
      if (this.liveWorld && !this.isGameOver) this.sendLivePlayerState('food');
    }
  }

  private checkPhantomCollisions(): boolean {
    const playerHead = this.snake.getHead();

    // Dead phantom bodies remain obstacles for the player, matching the
    // existing game behavior.
    for (const phantom of this.phantoms) {
      if (phantom.segments.some((segment) => playerHead.distanceToSquared(segment) < 0.1)) {
        console.log('Game Over: Phantom collision');
        this.logAction('player.death', {
          tick: this.playerTick,
          reason: 'phantom-collision',
          position: this.positionData(playerHead),
          phantomId: phantom.replayPlayer.replayId,
        });
        this.particleSystem.emit(playerHead, this.snake.direction, 50, phantom.phantomColor);
        void this.handleGameOver('phantom-collision');
        return true;
      }
    }

    for (const phantom of this.phantoms) {
      if (phantom.isDeadNow()) continue;

      const phantomHead = phantom.getHead();
      if (
        this.snake.segments.slice(1).some((segment) => phantomHead.distanceToSquared(segment) < 0.1)
      ) {
        this.logAction('phantom.death', {
          replayId: phantom.replayPlayer.replayId,
          reason: 'hit-player',
          position: this.positionData(phantomHead),
        });
        phantom.kill();
        this.particleSystem.emit(phantomHead, phantom.direction, 30, phantom.phantomColor);
        continue;
      }

      if (
        phantom.segments.slice(1).some((segment) => phantomHead.distanceToSquared(segment) < 0.1)
      ) {
        this.logAction('phantom.death', {
          replayId: phantom.replayPlayer.replayId,
          reason: 'self-collision',
          position: this.positionData(phantomHead),
        });
        phantom.kill();
        this.particleSystem.emit(phantomHead, phantom.direction, 30, phantom.phantomColor);
      }
    }

    for (let i = 0; i < this.phantoms.length; i++) {
      const first = this.phantoms[i];
      if (first.isDeadNow()) continue;
      for (let j = i + 1; j < this.phantoms.length; j++) {
        const second = this.phantoms[j];
        if (second.isDeadNow()) continue;

        const firstHitsSecond = second.segments.some(
          (segment) => first.getHead().distanceToSquared(segment) < 0.1,
        );
        const secondHitsFirst = first.segments.some(
          (segment) => second.getHead().distanceToSquared(segment) < 0.1,
        );
        if (!firstHitsSecond && !secondHitsFirst) continue;

        if (firstHitsSecond) {
          this.logAction('phantom.death', {
            replayId: first.replayPlayer.replayId,
            reason: 'phantom-collision',
            position: this.positionData(first.getHead()),
          });
          first.kill();
          this.particleSystem.emit(first.getHead(), first.direction, 30, first.phantomColor);
        }
        if (secondHitsFirst) {
          this.logAction('phantom.death', {
            replayId: second.replayPlayer.replayId,
            reason: 'phantom-collision',
            position: this.positionData(second.getHead()),
          });
          second.kill();
          this.particleSystem.emit(second.getHead(), second.direction, 30, second.phantomColor);
        }
      }
    }

    return false;
  }

  private checkLivePhantomCollisions(): void {
    const phantoms = this.liveOpponents.filter((opponent) => opponent.phantom && opponent.alive);
    for (const phantom of phantoms) {
      const phantomHead = phantom.segments[0];
      if (!phantomHead) continue;
      if (this.world.isOutOfBounds(phantomHead)) {
        this.killLivePhantom(phantom, 'bounds');
        continue;
      }
      if (this.snake.segments.some((segment) => phantomHead.distanceToSquared(segment) < 0.1)) {
        this.killLivePhantom(phantom, 'hit-player');
        continue;
      }
      for (const other of phantoms) {
        if (other.id === phantom.id || !other.alive) continue;
        if (other.segments.some((segment) => phantomHead.distanceToSquared(segment) < 0.1)) {
          this.killLivePhantom(phantom, 'phantom-collision');
          this.killLivePhantom(other, 'phantom-collision');
          break;
        }
      }
    }
  }

  private killLivePhantom(
    phantom: (typeof this.liveOpponents)[number],
    reason: 'bounds' | 'hit-player' | 'phantom-collision',
  ): void {
    if (!phantom.alive) return;
    phantom.alive = false;
    this.deadLivePhantoms.add(phantom.id);
    const head = phantom.segments[0];
    if (!head) return;
    this.logAction('phantom.death', {
      entityId: phantom.id,
      reason,
      position: this.positionData(head),
    });
    this.particleSystem.emit(head, phantom.direction, 30, new THREE.Color(phantom.color));
  }

  private async handleGameOver(reason?: string) {
    if (this.isGameOver) return;
    this.isGameOver = true;
    this.cameraController.triggerShake(0.2, 0.2);
    this.cameraController.setOrbitMode(); // Replaces setGameOverMode
    this.particleSystem.stopTime();
    this.soundManager.playGameOver();
    this.soundManager.setAmbientLowPass(true);
    this.gameOverUI.updateStats(this.gameStats);
    this.gameOverUI.show();
    this.hud.togglePauseButton(false);
    this.hud.setVisibility(false);

    if (reason && this.liveWorld) {
      // The restart assignment reads replays from D1, so wait until the
      // WebSocket death handler has committed this run.
      this.gameOverUI.setLoading(true);
      this.networkManager.sendPlayerDeath({
        type: 'death',
        seq: ++this.localStateSeq,
        step: this.playerTick,
        reason,
        ...this.livePlayerState(),
      });
    }

    // Online results are persisted only after the local client confirms death.
    if (this.replayRecorder) {
      this.replayRecorder.stop();
      if (!this.networkManager.isConnected()) {
        const deathPosition = this.snake.getHead();
        const replayData = this.replayRecorder.getReplayData(
          this.score,
          deathPosition,
          this.playerName,
        );
        replayData.appearance = this.appearance;
        // Оффлайн режим — сохраняем результат локально
        await this.saveOfflineGameResult(replayData);
      }
    }
  }

  /**
   * Сохранение результата игры в оффлайн режиме
   */
  private async saveOfflineGameResult(replayData: any): Promise<void> {
    try {
      // Сохраняем результат игры
      await this.offlineManager.saveGameData('lastGameResult', {
        score: this.score,
        seed: this.currentSeed,
        replay: replayData,
        timestamp: Date.now(),
        playerName: this.playerName,
      });

      // Проверяем, нужно ли обновить рекорд
      const highScoreData = await this.offlineManager.getGameData('highScore');
      const currentHighScore = highScoreData?.highScore || 0;

      if (this.score > currentHighScore) {
        await this.offlineManager.saveGameData('highScore', {
          highScore: this.score,
          highScoreSeed: this.currentSeed,
          highScoreReplayId: replayData.id,
          highScoreDate: new Date().toISOString(),
          replay: replayData,
        });
        console.log(`[Game] New offline high score saved: ${this.score}`);
      }

      console.log(`[Game] Game result saved offline. Score: ${this.score}`);
    } catch (error) {
      console.error('[Game] Failed to save offline game result:', error);
    }
  }

  private isRoomTransitionPending: boolean = false;
  private restartKeyWasPressed: boolean = false;

  private async resetGame(action: 'restart' | 'next') {
    if (this.isRoomTransitionPending) return;
    this.isRoomTransitionPending = true;
    this.gameOverUI.setLoading(true);
    try {
      let room: RoomData | null = null;
      if (this.networkManager.isConnected()) {
        try {
          room = await this.networkManager.requestRoom(action, this.currentSeed);
        } catch (error) {
          console.warn(
            '[Game] Failed to enter the next online room, falling back to local game:',
            error,
          );
        }
      }
      this.gameOverUI.hide();
      this.pauseUI.hide();
      this.isGameOver = false;
      this.isPaused = false;
      this.hud.togglePauseButton(true);
      this.hud.setVisibility(true);

      // Reset Stats
      this.gameStats = {
        score: 0,
        length: 5,
        time: 0,
        distance: 0,
        avgSpeed: 0,
        maxSpeed: 0,
        foodCount: { green: 0, blue: 0, pink: 0, total: 0 },
      };
      this.totalSpeedAccumulator = 0;
      this.speedSamples = 0;

      this.score = 0;
      this.currentSPM = 300;
      this.snake.setSpeed(60 / this.currentSPM);
      this.particleSystem.clear();
      this.pathfinder.clear();
      this.cameraController.reset();
      this.soundManager.setAmbientLowPass(false);

      // Reset phantoms
      this.phantoms = [];

      // The assignment has completed before this screen is closed, so an API
      // error leaves the player on Game Over with a retryable action.
      if (room) {
        this.selectedRoomSeed = room.seed;
        replaceRoomInAddress(room.seed);
        this.initializeRoom(room);
        this.cachePhantomsForOffline(room.phantoms);
      } else {
        // Offline mode - use cached phantoms or empty room
        await this.initializeOfflineRoom();
      }
    } catch (error) {
      this.gameOverUI.setLoading(
        false,
        error instanceof Error ? error.message : 'Could not start a new room. Try again.',
      );
    } finally {
      this.isRoomTransitionPending = false;
    }
  }

  private render() {
    // Render Food
    const foodCount = this.world.foodPositions.length;
    this.foodMesh.count = foodCount;

    for (let i = 0; i < foodCount; i++) {
      this.dummy.position.copy(this.world.foodPositions[i]);
      this.dummy.rotation.set(0, 0, 0);
      this.dummy.scale.set(1, 1, 1);
      this.dummy.updateMatrix();
      this.foodMesh.setMatrixAt(i, this.dummy.matrix);
      this.foodMesh.setColorAt(i, this.world.foodColors[i]);
    }
    this.foodMesh.instanceMatrix.needsUpdate = true;
    if (this.foodMesh.instanceColor) this.foodMesh.instanceColor.needsUpdate = true;

    // Update Snake InstancedMesh
    const occupiedSnakePositions = new Set<string>();
    const localSegmentIndices = this.isSpectating
      ? []
      : getRenderableSegmentIndices(this.snake.segments, occupiedSnakePositions);
    const count = localSegmentIndices.length;
    this.snakeMesh.count = count;

    // Prune old pulses
    this.pulses = this.pulses.filter((p) => (this.time - p.startTime) * p.speed < count + 10);

    for (let instanceIndex = 0; instanceIndex < count; instanceIndex++) {
      const segmentIndex = localSegmentIndices[instanceIndex];
      const segment = this.snake.segments[segmentIndex];

      this.dummy.position.copy(segment);
      this.dummy.rotation.set(0, 0, 0);

      if (segmentIndex === 0) {
        // Head
        this.dummy.quaternion.copy(this.snake.direction);
        this.dummy.scale.set(1, 1, 1);
        this._color.setHex(0xffffff);
      } else {
        // Body
        this.dummy.scale.set(1, 1, 1);
        this._color.setHex(0xffffff);
      }

      // Apply Pulses
      for (const pulse of this.pulses) {
        const dist = (this.time - pulse.startTime) * pulse.speed;
        const segmentPos = segmentIndex;
        const diff = Math.abs(segmentPos - dist);
        const width = 2.0;

        if (diff < width) {
          const intensity = 1.0 - diff / width;
          // Simple additive/mix
          this._color.lerp(pulse.color, intensity * 0.8);
        }
      }

      this.dummy.updateMatrix();
      this.snakeMesh.setMatrixAt(instanceIndex, this.dummy.matrix);
      const localAppearance = { ...this.appearance, backgroundColor: '#' + this._color.clone().multiply(new THREE.Color(this.appearance.backgroundColor)).getHexString() };
      setSnakePatternAt(this.snakeMesh, instanceIndex, localAppearance);
    }

    this.snakeMesh.instanceMatrix.needsUpdate = true;
    markSnakePatternsUpdated(this.snakeMesh);

    // Render Phantoms
    if (this.phantomMesh) {
      let phantomInstanceIndex = 0;

      for (const phantom of this.phantoms) {
        // Dead phantoms stay visible on the field (they just stop moving)

        const renderableIndices = getRenderableSegmentIndices(
          phantom.segments,
          occupiedSnakePositions,
        );
        for (const segmentIndex of renderableIndices) {
          const segment = phantom.segments[segmentIndex];

          this.dummy.position.copy(segment);
          this.dummy.rotation.set(0, 0, 0);

          if (segmentIndex === 0) {
            // Phantom head
            this.dummy.quaternion.copy(phantom.direction);
          }

          this.dummy.scale.set(1, 1, 1);
          this.dummy.updateMatrix();

          this.phantomMesh.setMatrixAt(phantomInstanceIndex, this.dummy.matrix);
          setSnakePatternAt(this.phantomMesh, phantomInstanceIndex, phantom.appearance);
          phantomInstanceIndex++;
        }
      }
      for (const opponent of this.liveOpponents) {
        const renderableIndices = getRenderableSegmentIndices(
          opponent.segments,
          occupiedSnakePositions,
        );
        for (const segmentIndex of renderableIndices) {
          this.dummy.position.copy(opponent.segments[segmentIndex]);
          this.dummy.rotation.set(0, 0, 0);
          if (segmentIndex === 0) this.dummy.quaternion.copy(opponent.direction);
          this.dummy.scale.set(1, 1, 1);
          this.dummy.updateMatrix();
          this.phantomMesh.setMatrixAt(phantomInstanceIndex, this.dummy.matrix);
          setSnakePatternAt(this.phantomMesh, phantomInstanceIndex, opponent.appearance);
          phantomInstanceIndex++;
        }
      }

      this.phantomMesh.count = phantomInstanceIndex;
      this.phantomMesh.instanceMatrix.needsUpdate = true;
      markSnakePatternsUpdated(this.phantomMesh);
    }

    this.postProcess.render();
  }
}
