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
import { SettingsUI } from '../ui/SettingsUI';
import { GameOverUI } from '../ui/GameOverUI';
import { GameHUD } from '../ui/GameHUD';
import { WelcomeScreen } from '../ui/WelcomeScreen';
import { LeaderboardUI } from '../ui/LeaderboardUI';
import { SoundManager } from '../audio/SoundManager';
import { ReplayRecorder } from './ReplaySystem';
import { NetworkManager } from '../network/NetworkManager';
// import { NetworkStatusUI } from '../network/NetworkStatusUI';
import { PauseUI, GameStats } from '../ui/PauseUI';
import type { ReplayData, RoomData } from '../types/replay';

interface Pulse {
    color: THREE.Color;
    startTime: number;
    speed: number;
    originIndex: number; // Index of head when pulse started (always 0)
}

import { Pathfinder } from './Pathfinder';
import { OfflineDataManager } from '../utils/OfflineDataManager';

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
    private phantomMesh: THREE.InstancedMesh | null = null;
    private replayRecorder: ReplayRecorder | null = null;
    private networkManager: NetworkManager;
    // private networkStatusUI: NetworkStatusUI;
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
        foodCount: { green: 0, blue: 0, pink: 0, total: 0 }
    };
    // Accumulator for average speed calculation (sum of speeds per frame / frames)
    // Or better: integrate speed over time.
    private totalSpeedAccumulator: number = 0;
    private speedSamples: number = 0;
    private playerSpawnIndex: number = 0;
    private playerName: string;

    private lastRecordedDirection: THREE.Vector3 = new THREE.Vector3();

    constructor() {
        // Initialize Player Name (Persistent)
        this.playerName = localStorage.getItem('snake3d_player_name') || `Player${Math.floor(Math.random() * 10000)}`;
        localStorage.setItem('snake3d_player_name', this.playerName);

        // 1. Managers Setup
        this.settingsManager = new SettingsManager();
        this.sceneManager = new SceneManager(this.settingsManager.cameraConfig.fov);

        this.cameraController = new CameraController(
            this.sceneManager.camera,
            this.settingsManager.cameraConfig,
            this.sceneManager.scene
        );

        this.postProcess = new PostProcessManager(
            this.sceneManager.renderer,
            this.sceneManager.scene,
            this.sceneManager.camera,
            this.settingsManager.bloomConfig
        );

        // Settings UI
        this.settingsUI = new SettingsUI(
            this.settingsManager,
            () => {
                this.cameraController.updateConfig(this.settingsManager.cameraConfig);
                this.postProcess.updateBloomConfig(this.settingsManager.bloomConfig);
            },
            () => { // On Close Callback
                this.settingsUI.hide();
                this.hud.togglePauseButton(true);
                this.pauseUI.show();
            }
        );



        // Leaderboard UI
        this.leaderboardUI = new LeaderboardUI(this.playerName);

        this.gameOverUI = new GameOverUI(
            () => this.resetGame(),
            () => this.leaderboardUI.show()
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
            () => this.leaderboardUI.show()
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

        this.soundManager = new SoundManager(
            this.sceneManager,
            this.world,
            this.settingsManager
        );

        // 5. Setup Visuals
        const textureLoader = new THREE.TextureLoader();
        const texture = textureLoader.load('sp.png',
            () => console.log("Texture loaded successfully"),
            undefined,
            (err) => console.error("Error loading texture", err)
        );
        texture.colorSpace = THREE.SRGBColorSpace;

        const instanceMaterial = new THREE.MeshBasicMaterial({
            color: 0xffffff,
            map: texture
        });

        // Setup InstancedMesh
        const boxGeo = new THREE.BoxGeometry(0.9, 0.9, 0.9);
        this.snakeMesh = new THREE.InstancedMesh(boxGeo, instanceMaterial, 10000);
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
        const phantomMaterial = new THREE.MeshBasicMaterial({
            color: 0x88ffff,
            map: texture,
            transparent: true,
            opacity: 0.5
        });
        const phantomGeo = new THREE.BoxGeometry(0.85, 0.85, 0.85);
        this.phantomMesh = new THREE.InstancedMesh(phantomGeo, phantomMaterial, 10000);
        this.phantomMesh.count = 0;
        this.phantomMesh.frustumCulled = false;
        this.sceneManager.scene.add(this.phantomMesh);

        // Network Manager
        this.networkManager = NetworkManager.getInstance();

        // Offline Data Manager - для работы в оффлайн режиме
        this.offlineManager = new OfflineDataManager();
        this.offlineManager.setupOnlineHandler(this.networkManager);

        // Network Status UI removed in favor of Pause Button
        // this.networkStatusUI = new NetworkStatusUI();

        // Listen for room data (phantoms)
        this.networkManager.on('room:data', (data: RoomData) => {
            console.log(`[Game] Received room data: seed=${data.seed}, phantoms=${data.phantoms.length}`);
            this.initializeRoom(data);
            // Кэшируем фантомов для оффлайн режима
            this.cachePhantomsForOffline(data.phantoms);
        });

        this.networkManager.on('game:result', (result: { saved: boolean; message: string }) => {
            console.log(`[Game] Game result: ${result.message}`);
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
        }

        // Listen for authentication to sync player name (reconnects)
        this.networkManager.on('authenticated', (result: any) => {
            if (result.user && result.user.username) {
                console.log(`[Game] Syncing player name from server: ${result.user.username}`);
                this.playerName = result.user.username;
                localStorage.setItem('snake3d_player_name', this.playerName);
                this.leaderboardUI.setPlayerName(this.playerName);
            }
        });

        // Visibility Handler to stop loop when tab is hidden
        this._visibilityHandler = () => {
            if (document.hidden) {
                if (!this.isPaused && !this.isGameOver && !this.isWaitingForStart) {
                    this.togglePause();
                }
                this.loop.stop();
            } else {
                this.loop.start();
            }
        };
        document.addEventListener('visibilitychange', this._visibilityHandler);

        // Blur Handler to pause when window loses focus
        this._blurHandler = () => {
            if (!this.isPaused && !this.isGameOver && !this.isWaitingForStart) {
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
        this.welcomeScreen = new WelcomeScreen(() => this.handleGameStart());

        // Initialize Player Name
        const user = this.networkManager.getUser();
        // Check for stored name fallback
        const storedName = localStorage.getItem('snake3d_username');
        this.playerName = user?.username || storedName || `Player ${Math.floor(Math.random() * 9000) + 1000}`;
    }

    private setupInputs() {
        const handleTurn = (action: () => void) => {
            const prevDir = this.snake.direction.clone();
            action();
            if (!this.snake.direction.equals(prevDir)) {
                this.pathfinder.updatePathVisualization(this.snake.getHead(), this.snake.segments, this.snake.direction);
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
        this.currentSeed = data.seed;

        // Обновляем UI с seed комнаты
        // this.networkStatusUI.setSeed(data.seed);

        // Обновляем seed в мире для детерминированной генерации еды
        this.world.setSeed(data.seed);

        // Используем точку спавна, назначенную сервером
        this.playerSpawnIndex = data.playerSpawnIndex;
        const spawn = getSpawnPoint(this.playerSpawnIndex);

        // Сбрасываем змейку на выбранную точку спауна
        this.snake.reset(spawn.position.clone(), spawn.direction.clone());

        // Создаём фантомов из данных реплеев
        this.phantoms = data.phantoms.map((replayData: ReplayData, index: number) => {
            return new Phantom(replayData, index);
        });

        // Выводим координаты и направление респавна
        const spawnDir = new THREE.Vector3(0, 0, 1).applyQuaternion(spawn.direction);
        console.log(`[Game] Spawn position: (${spawn.position.x}, ${spawn.position.y}, ${spawn.position.z})`);
        console.log(`[Game] Spawn direction: (${spawnDir.x.toFixed(2)}, ${spawnDir.y.toFixed(2)}, ${spawnDir.z.toFixed(2)})`);
        console.log(`[Game] Initialized room with seed ${data.seed}, spawn ${this.playerSpawnIndex}, ${this.phantoms.length} phantoms`);

        // Инициализируем запись реплея с индексом спауна и начальной скоростью
        this.replayRecorder = new ReplayRecorder(data.seed, this.playerSpawnIndex, this.currentSPM);
        // Начинаем запись с начальным направлением
        const initialDir = new THREE.Vector3(0, 0, -1).applyQuaternion(spawn.direction);
        if (Math.abs(initialDir.x) > 0.5) initialDir.set(Math.sign(initialDir.x), 0, 0);
        else if (Math.abs(initialDir.y) > 0.5) initialDir.set(0, Math.sign(initialDir.y), 0);
        else initialDir.set(0, 0, Math.sign(initialDir.z));
        this.lastRecordedDirection.copy(initialDir);
        this.replayRecorder.start(initialDir, spawn.position);
    }

    /**
     * Обработчик нажатия кнопки "Старт" на приветственном экране
     * Инициализирует аудио и запускает игру
     */
    private async handleGameStart(): Promise<void> {
        // Инициализируем AudioContext по клику пользователя
        await this.soundManager.initAudio();

        // Запрашиваем комнату с сервера (null = случайный seed)
        if (this.networkManager.isConnected()) {
            this.networkManager.send('room:join', null);
        } else {
            // Оффлайн режим — загружаем кэшированные фантомы или генерируем локально
            await this.initializeOfflineRoom();
        }

        // Снимаем флаг ожидания старта
        this.isWaitingForStart = false;

        console.log('Game started!');
    }

    /**
     * Инициализация комнаты в оффлайн режиме с кэшированными фантомами
     */
    private async initializeOfflineRoom(): Promise<void> {
        const localSeed = Math.floor(Math.random() * 1000000);
        const localSpawnIndex = getRandomSpawnIndex();

        try {
            // Пытаемся загрузить кэшированные фантомы
            const cachedPhantoms = await this.loadCachedPhantoms();
            
            this.initializeRoom({ 
                seed: localSeed, 
                phantoms: cachedPhantoms, 
                playerSpawnIndex: localSpawnIndex 
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
                timestamp: Date.now()
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

    private isGameOver: boolean = false;

    private update(delta: number) {
        this.time += delta;

        // Если ожидаем нажатия кнопки "Старт" — только рендерим сцену
        if (this.isWaitingForStart) {
            // Обновляем камеру для красивого вида
            const head = this.snake.getHead();
            this.cameraController.update(delta, head, this.snake.direction, 0);
            return;
        }

        if (this.isGameOver) {
            // In Game Over, we only update visual systems
            const head = this.snake.getHead();
            this.cameraController.update(delta, head, this.snake.direction, 0);
            this.particleSystem.update(delta);

            // Allow manual restart via input as fallback
            if (this.input.isActionPressed('boost')) {
                this.resetGame();
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
        if (this.input.isActionPressed('boost')) {
            this.snake.setSpeed(0.05);
        } else {
            this.snake.setSpeed(60 / this.currentSPM);
        }

        // Logic Update
        const preStepHead = this.snake.getHead().clone();
        if (this.snake.update(delta)) {
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

            // выводим координаты и направление
            const stepHead = this.snake.getHead();
            const stepDir = new THREE.Vector3(0, 0, 1).applyQuaternion(this.snake.direction);

            // Stats: Distance (1 unit per step roughly, grid based)
            this.gameStats.distance += 1;

            console.log(`[Step] Position: (${stepHead.x}, ${stepHead.y}, ${stepHead.z}) Direction: (${stepDir.x.toFixed(2)}, ${stepDir.y.toFixed(2)}, ${stepDir.z.toFixed(2)})`);

            // Calculate pitch based on speed (normalize around 300 SPM)
            // Clamp roughly between 0.8 and 1.5 to stay realistic
            let rate = this.currentSPM / 300;
            if (rate < 0.5) rate = 0.5;
            if (rate > 4.0) rate = 4.0;

            this.soundManager.playStep(rate);

            this.checkCollisions();

            // Update Pathfinder on Step
            this.pathfinder.updatePathVisualization(this.snake.getHead(), this.snake.segments, this.snake.direction);
        }

        // Update phantoms every frame (independently of player step)
        for (const phantom of this.phantoms) {
            if (!phantom.isDeadNow()) {
                // Phantom manages its own speed internally
                if (phantom.update(delta)) {
                    // Safety check: Kill if out of bounds (prevents infinite walking if replay desyncs)
                    if (this.world.isOutOfBounds(phantom.getHead())) {
                        console.warn(`[Game] Phantom ${phantom.getPlayerName()} went out of bounds at ${phantom.getHead().toArray()}. Killing.`);
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
                        console.log(`[Phantom] Ate food at index ${phantomFoodIndex}, position: (${this.world.foodPositions[phantomFoodIndex].x}, ${this.world.foodPositions[phantomFoodIndex].y}, ${this.world.foodPositions[phantomFoodIndex].z})`);
                        this.world.respawnFood(this.snake.segments, phantomFoodIndex);
                        console.log(`[Phantom] Food respawned to: (${this.world.foodPositions[phantomFoodIndex].x}, ${this.world.foodPositions[phantomFoodIndex].y}, ${this.world.foodPositions[phantomFoodIndex].z})`);
                    }
                }
            }
        }

        const head = this.snake.getHead();

        // Update Settings UI (FPS etc)
        this.frames++;
        this.fpsTime += delta;
        if (this.fpsTime >= 0.5) {
            this.settingsUI.updateFPS(this.frames / this.fpsTime);
            this.frames = 0;
            this.fpsTime = 0;
        }
        this.settingsUI.updateInfo(`Head: x:${Math.round(head.x)} y:${Math.round(head.y)} z:${Math.round(head.z)}`);

        // Manual Camera Control
        if (this.input.isLeftMouseDown) {
            this.cameraController.setManualControlActive(true);
            const { x, y } = this.input.getAndResetMouseDelta();
            this.cameraController.applyManualMovement(x, y, 0.005);
        } else {
            this.cameraController.setManualControlActive(false);
        }

        // Camera Update
        this.cameraController.update(
            delta,
            head,
            this.snake.direction,
            this.snake.getStepProgress()
        );

        // Update Audio
        this.soundManager.update(head);

        // Update Particles
        this.particleSystem.update(delta);

        // Update HUD with all players info
        const currentLength = this.snake.segments.length;
        const speed = this.snake.getStepsPerMinute();

        // Build players list for HUD
        const players = [];

        // Current player first
        players.push({
            name: this.playerName,
            score: this.score,
            length: currentLength,
            speed: speed,
            isPlayer: true,
            color: '#ffffff'
        });

        // Add phantoms
        for (const phantom of this.phantoms) {
            // Include dead phantoms so they show up as dead in HUD
            const name = phantom.getPlayerName();
            players.push({
                name: name,
                score: phantom.getScore(),
                length: phantom.segments.length,
                speed: phantom.getSPM(),
                isPlayer: false,
                color: phantom.getColorHex(),
                isDead: phantom.isDeadNow()
            });
        }

        this.hud.updatePlayers(players);
    }

    private checkCollisions() {
        const head = this.snake.getHead();
        const snakeColor = new THREE.Color(0xffffff);

        if (this.world.isOutOfBounds(head)) {
            console.log("Game Over: Bounds");
            this.particleSystem.emit(head, this.snake.direction, 50, snakeColor);
            this.handleGameOver();
            return;
        }

        if (this.world.checkSelfCollision(this.snake.segments)) {
            console.log("Game Over: Self");
            this.particleSystem.emit(head, this.snake.direction, 50, snakeColor);
            this.handleGameOver();
            return;
        }

        // Check collision with phantom bodies (dead phantoms still block the player)
        for (const phantom of this.phantoms) {
            // Player head vs Phantom body (including dead phantoms - they remain obstacles)
            for (const segment of phantom.segments) {
                if (head.distanceToSquared(segment) < 0.1) {
                    console.log("Game Over: Phantom collision");
                    this.particleSystem.emit(head, this.snake.direction, 50, phantom.phantomColor);
                    this.handleGameOver();
                    return;
                }
            }

            // Skip further checks for dead phantoms (they can't move or die again)
            if (phantom.isDeadNow()) continue;

            // Phantom head vs Player body (phantom dies)
            const phantomHead = phantom.getHead();
            for (let i = 1; i < this.snake.segments.length; i++) {
                if (phantomHead.distanceToSquared(this.snake.segments[i]) < 0.1) {
                    console.log(`Phantom ${phantom.replayPlayer.replayId} died: hit player`);
                    phantom.kill();
                    this.particleSystem.emit(phantomHead, phantom.direction, 30, phantom.phantomColor);
                    break;
                }
            }

            // Phantom vs Phantom collisions
            for (const otherPhantom of this.phantoms) {
                if (otherPhantom === phantom || otherPhantom.isDeadNow() || phantom.isDeadNow()) continue;

                const otherHead = otherPhantom.getHead();
                for (const segment of phantom.segments) {
                    if (otherHead.distanceToSquared(segment) < 0.1) {
                        console.log(`Phantom ${otherPhantom.replayPlayer.replayId} died: hit another phantom`);
                        otherPhantom.kill();
                        this.particleSystem.emit(otherHead, otherPhantom.direction, 30, otherPhantom.phantomColor);
                        break;
                    }
                }
            }
        }

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
            console.log("Spm: " + spmChange);
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
                originIndex: 0
            });

            this.world.respawnFood(this.snake.segments, foodIndex);
        }
    }

    private async handleGameOver() {
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

        // Stop replay recording and send to server
        if (this.replayRecorder) {
            this.replayRecorder.stop();

            const deathPosition = this.snake.getHead();
            const replayData = this.replayRecorder.getReplayData(this.score, deathPosition, this.playerName);

            if (this.networkManager.isConnected()) {
                this.networkManager.send('game:over', {
                    seed: this.currentSeed,
                    replay: replayData
                });
                console.log(`[Game] Sent replay to server. Score: ${this.score}, Changes: ${this.replayRecorder.getChangeCount()}`);
            } else {
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
                playerName: this.playerName
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
                    replay: replayData
                });
                console.log(`[Game] New offline high score saved: ${this.score}`);
            }

            console.log(`[Game] Game result saved offline. Score: ${this.score}`);
        } catch (error) {
            console.error('[Game] Failed to save offline game result:', error);
        }
    }

    private async resetGame() {
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
            foodCount: { green: 0, blue: 0, pink: 0, total: 0 }
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

        // Request new room from server (initializeRoom will reset snake position)
        if (this.networkManager.isConnected()) {
            this.networkManager.send('room:join', null);
        } else {
            // Offline mode - use cached phantoms or empty room
            await this.initializeOfflineRoom();
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
        const count = this.snake.segments.length;
        this.snakeMesh.count = count;

        // Prune old pulses
        this.pulses = this.pulses.filter(p => (this.time - p.startTime) * p.speed < count + 10);

        for (let i = 0; i < count; i++) {
            const segment = this.snake.segments[i];

            this.dummy.position.copy(segment);
            this.dummy.rotation.set(0, 0, 0);

            if (i === 0) {
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
                const segmentPos = i; // Distance from head is index i
                const diff = Math.abs(segmentPos - dist);
                const width = 2.0;

                if (diff < width) {
                    const intensity = 1.0 - (diff / width);
                    // Simple additive/mix
                    this._color.lerp(pulse.color, intensity * 0.8);
                }
            }

            this.dummy.updateMatrix();
            this.snakeMesh.setMatrixAt(i, this.dummy.matrix);
            this.snakeMesh.setColorAt(i, this._color);
        }

        this.snakeMesh.instanceMatrix.needsUpdate = true;
        if (this.snakeMesh.instanceColor) this.snakeMesh.instanceColor.needsUpdate = true;

        // Render Phantoms
        if (this.phantomMesh) {
            let phantomInstanceIndex = 0;

            for (const phantom of this.phantoms) {
                // Dead phantoms stay visible on the field (they just stop moving)

                for (let i = 0; i < phantom.segments.length; i++) {
                    const segment = phantom.segments[i];

                    this.dummy.position.copy(segment);
                    this.dummy.rotation.set(0, 0, 0);

                    if (i === 0) {
                        // Phantom head
                        this.dummy.quaternion.copy(phantom.direction);
                    }

                    this.dummy.scale.set(1, 1, 1);
                    this.dummy.updateMatrix();

                    this.phantomMesh.setMatrixAt(phantomInstanceIndex, this.dummy.matrix);
                    this.phantomMesh.setColorAt(phantomInstanceIndex, phantom.phantomColor);
                    phantomInstanceIndex++;
                }
            }

            this.phantomMesh.count = phantomInstanceIndex;
            this.phantomMesh.instanceMatrix.needsUpdate = true;
            if (this.phantomMesh.instanceColor) this.phantomMesh.instanceColor.needsUpdate = true;
        }

        this.postProcess.render();
    }
}
