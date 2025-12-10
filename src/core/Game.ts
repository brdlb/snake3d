import * as THREE from 'three';
import { Loop } from './Loop';
import { InputManager } from './Input';
import { Snake } from '../entities/Snake';
import { World, FOOD_COLORS, WORLD_SIZE } from '../entities/World';
import { ParticleSystem } from '../graphics/ParticleSystem';

import { SettingsManager } from './SettingsManager';
import { SceneManager } from '../graphics/SceneManager';
import { CameraController } from './CameraController';
import { PostProcessManager } from '../graphics/PostProcessManager';
import { DebugUI } from '../ui/DebugUI';
import { GameOverUI } from '../ui/GameOverUI';
import { GameHUD } from '../ui/GameHUD';
import { WelcomeScreen } from '../ui/WelcomeScreen';
import { SoundManager } from '../audio/SoundManager';

interface Pulse {
    color: THREE.Color;
    startTime: number;
    speed: number;
    originIndex: number; // Index of head when pulse started (always 0)
}

import { Pathfinder } from './Pathfinder';

export class Game {
    private settingsManager: SettingsManager;
    private sceneManager: SceneManager;
    private cameraController: CameraController;
    private postProcess: PostProcessManager;
    private debugUI: DebugUI;
    private gameOverUI: GameOverUI;
    private hud: GameHUD;
    private welcomeScreen: WelcomeScreen;
    private soundManager: SoundManager;
    private pathfinder: Pathfinder;

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

    constructor() {
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

        // Debug UI
        this.debugUI = new DebugUI(this.settingsManager, () => {
            this.cameraController.updateConfig(this.settingsManager.cameraConfig);
            this.postProcess.updateBloomConfig(this.settingsManager.bloomConfig);
        });

        this.gameOverUI = new GameOverUI(() => this.resetGame());
        this.hud = new GameHUD();



        // 2. Window Events override
        // We need to hook into resize to update post process as well
        window.addEventListener('resize', this.onWindowResize.bind(this));


        // 3. Initialize Core Systems
        this.loop = new Loop();
        this.input = new InputManager();

        // 4. Initialize Game Entities
        this.world = new World(WORLD_SIZE);
        this.snake = new Snake(new THREE.Vector3(0, 0, 0));

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
        this.sceneManager.setupWalls(this.world.boundary);

        // Particles
        this.particleSystem = new ParticleSystem(this.sceneManager.scene, texture);

        // Pathfinder
        this.pathfinder = new Pathfinder(this.sceneManager.scene, this.world);

        // Visibility Handler to stop loop when tab is hidden
        this._visibilityHandler = () => {
            if (document.hidden) {
                this.loop.stop();
            } else {
                this.loop.start();
            }
        };
        document.addEventListener('visibilitychange', this._visibilityHandler);

        // Input Bindings
        this.setupInputs();

        // Start Loop (will only render while waiting for start)
        this.loop.add(this.update.bind(this));
        this.loop.add(this.render.bind(this));
        this.loop.start();

        // Welcome Screen - показываем приветственный экран
        this.welcomeScreen = new WelcomeScreen(() => this.handleGameStart());
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
    }

    /**
     * Обработчик нажатия кнопки "Старт" на приветственном экране
     * Инициализирует аудио и запускает игру
     */
    private async handleGameStart(): Promise<void> {
        // Инициализируем AudioContext по клику пользователя
        await this.soundManager.initAudio();

        // Снимаем флаг ожидания старта
        this.isWaitingForStart = false;

        console.log('Game started!');
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

        // Dispose Managers
        this.sceneManager.dispose();
        this.debugUI.dispose();
        this.gameOverUI.dispose();
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

        // Boost
        if (this.input.isActionPressed('boost')) {
            this.snake.setSpeed(0.05);
        } else {
            this.snake.setSpeed(60 / this.currentSPM);
        }

        // Logic Update
        if (this.snake.update(delta)) {
            // Step occurred
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

        const head = this.snake.getHead();

        // Update Debug UI
        this.frames++;
        this.fpsTime += delta;
        if (this.fpsTime >= 0.5) {
            this.debugUI.updateFPS(this.frames / this.fpsTime);
            this.frames = 0;
            this.fpsTime = 0;
        }
        this.debugUI.updateInfo(`Head: x:${Math.round(head.x)} y:${Math.round(head.y)} z:${Math.round(head.z)}`);

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

        // Update HUD (score is now state-based)
        const currentLength = this.snake.segments.length;
        const speed = this.snake.getStepsPerMinute();
        this.hud.update(this.score, currentLength, speed);
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
            }
            // Blue: +10 SPM, +5 Len, +5 Score
            else if (hex === FOOD_COLORS.BLUE) {
                spmChange = 10;
                growAmount = 5;
                scorePoints = 15;
            }
            // Pink: -10 SPM, +1 Len, +1 Score
            else if (hex === FOOD_COLORS.PINK) {
                spmChange = -10;
                growAmount = 3;
                scorePoints = 3;
            }
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

    private handleGameOver() {
        this.isGameOver = true;
        this.cameraController.triggerShake(0.2, 0.2);
        this.cameraController.setGameOverMode();
        this.particleSystem.stopTime();
        this.soundManager.playGameOver();
        this.soundManager.setAmbientLowPass(true);
        this.gameOverUI.show();
    }

    private resetGame() {
        this.gameOverUI.hide();
        this.isGameOver = false;
        this.score = 0;
        this.currentSPM = 300;
        this.snake.reset(new THREE.Vector3(0, 0, 0));
        this.snake.setSpeed(60 / this.currentSPM);
        this.world.respawnFood([]);
        this.particleSystem.clear();
        this.pathfinder.clear();
        this.cameraController.reset();
        this.soundManager.setAmbientLowPass(false);
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

        this.postProcess.render();
    }
}
