import * as THREE from 'three';
import { SceneManager } from '../graphics/SceneManager';
import { World } from '../entities/World';
import { SettingsManager } from '../core/SettingsManager';

export class SoundManager {
    private sceneManager: SceneManager;
    private audioListener: THREE.AudioListener | null = null;
    private pickSound: THREE.Audio | undefined;
    private stepSound: THREE.Audio | undefined;
    private gameOverSound: THREE.Audio | undefined;
    private humBuffers: AudioBuffer[] = [];
    private world: World;
    private settings: SettingsManager;
    private isInitialized: boolean = false;

    // Pool for hums
    private humPool: { source: THREE.PositionalAudio, mesh: THREE.Object3D, foodIndex: number, filter: BiquadFilterNode }[] = [];
    private readonly POOL_SIZE = 16;

    constructor(sceneManager: SceneManager, world: World, settings: SettingsManager) {
        this.sceneManager = sceneManager;
        this.world = world;
        this.settings = settings;
        // Audio is NOT initialized here - must call initAudio() from user gesture
    }

    /**
     * Initialize audio system - MUST be called from a user gesture event handler
     * to work properly on iOS Safari
     * @returns true if audio initialized successfully, false otherwise
     */
    public async initAudio(): Promise<boolean> {
        if (this.isInitialized) return true;

        try {
            console.log('[Audio] Starting initialization...');

            // Create AudioListener NOW - during user gesture
            this.audioListener = this.sceneManager.initAudioListener();
            const context = this.audioListener.context;

            console.log(`[Audio] Initial context state: ${context.state}`);
            console.log(`[Audio] Sample rate: ${context.sampleRate}`);

            // Resume if suspended
            if (context.state === 'suspended') {
                console.log('[Audio] Attempting to resume...');
                await context.resume();
                console.log(`[Audio] After resume, state: ${context.state}`);
            }

            // iOS Safari workaround: play a silent buffer to "warm up" the audio engine
            await this.playWarmUpSound(context);

            // Wait a bit and check if currentTime is advancing
            const time1 = context.currentTime;
            await new Promise(r => setTimeout(r, 100));
            const time2 = context.currentTime;

            console.log(`[Audio] currentTime check: ${time1} -> ${time2}`);

            if (time1 === time2 && context.state === 'running') {
                console.warn('[Audio] Warning: AudioContext is running but currentTime is not advancing');
            }

            // Now load all sounds
            console.log('[Audio] Loading sounds...');
            await this.loadSounds();

            // Create hum pool
            this.createHumPool();

            this.isInitialized = true;
            console.log('[Audio] Audio system fully initialized');
            return true;

        } catch (e) {
            const errorMessage = e instanceof Error ? e.message : 'Unknown error';
            console.error('[Audio] Failed to initialize:', errorMessage);
            alert(`Audio initialization failed: ${errorMessage}\n\nThe game will continue without sound.`);
            return false;
        }
    }

    /**
     * Play a silent sound to "warm up" AudioContext on iOS Safari
     */
    private async playWarmUpSound(context: AudioContext): Promise<void> {
        return new Promise((resolve) => {
            try {
                // Create a short silent buffer
                const buffer = context.createBuffer(1, 1, context.sampleRate);
                const source = context.createBufferSource();
                source.buffer = buffer;
                source.connect(context.destination);
                source.onended = () => {
                    console.log('[Audio] Warm-up sound completed');
                    resolve();
                };
                source.start(0);
                console.log('[Audio] Playing warm-up sound...');

                // Fallback timeout in case onended doesn't fire
                setTimeout(resolve, 100);
            } catch (e) {
                console.warn('[Audio] Warm-up sound failed:', e);
                resolve();
            }
        });
    }

    private async loadSounds(): Promise<void> {
        if (!this.audioListener) return;

        const loader = new THREE.AudioLoader();

        // Load main sounds
        const loadSound = (url: string): Promise<AudioBuffer> => {
            return new Promise((resolve, reject) => {
                loader.load(url, resolve, undefined, reject);
            });
        };

        try {
            const [pickBuffer, stepBuffer, gameOverBuffer, hum1, hum2, hum3] = await Promise.all([
                loadSound('pick.mp4'),
                loadSound('step.mp4'),
                loadSound('gameover.mp4'),
                loadSound('hum1.mp4'),
                loadSound('hum2.mp4'),
                loadSound('hum3.mp4')
            ]);

            this.pickSound = new THREE.Audio(this.audioListener);
            this.pickSound.setBuffer(pickBuffer);
            this.pickSound.setVolume(this.settings.audioConfig.volume);

            this.stepSound = new THREE.Audio(this.audioListener);
            this.stepSound.setBuffer(stepBuffer);
            this.stepSound.setVolume(this.settings.audioConfig.volume);

            this.gameOverSound = new THREE.Audio(this.audioListener);
            this.gameOverSound.setBuffer(gameOverBuffer);
            this.gameOverSound.setVolume(this.settings.audioConfig.volume);

            this.humBuffers = [hum1, hum2, hum3];

            console.log('All sounds loaded');
        } catch (e) {
            console.error('Failed to load sounds:', e);
        }
    }

    private createHumPool(): void {
        if (!this.audioListener) return;

        const container = new THREE.Group();
        this.sceneManager.scene.add(container);

        for (let i = 0; i < this.POOL_SIZE; i++) {
            const mesh = new THREE.Object3D();
            container.add(mesh);

            const sound = new THREE.PositionalAudio(this.audioListener);
            mesh.add(sound);
            sound.setRefDistance(this.settings.audioConfig.foodSoundRadius);
            sound.setRolloffFactor(1);
            sound.setLoop(true);
            sound.setVolume(this.settings.audioConfig.volume);

            // Create individual filter for each source to preserve spatialization
            const filter = this.audioListener.context.createBiquadFilter();
            filter.type = 'lowpass';
            filter.frequency.value = 22050; // Open by default
            sound.setFilter(filter);

            this.humPool.push({ source: sound, mesh: mesh, foodIndex: -1, filter: filter });
        }
    }

    public setAmbientLowPass(enabled: boolean) {
        if (!this.audioListener) return;

        const freq = enabled ? 500 : 22050;
        const now = this.audioListener.context.currentTime;

        for (const item of this.humPool) {
            item.filter.frequency.cancelScheduledValues(now);
            item.filter.frequency.linearRampToValueAtTime(freq, now + 0.5);
        }
    }

    public playPick() {
        if (this.pickSound && this.pickSound.buffer) {
            if (this.pickSound.isPlaying) this.pickSound.stop();
            this.pickSound.setVolume(this.settings.audioConfig.volume);
            this.pickSound.play();
        }
    }

    public playStep(playbackRate: number = 1.0) {
        if (this.stepSound && this.stepSound.buffer) {
            // To "return to beginning" in WEBAudio/Three.js we must stop and play again
            if (this.stepSound.isPlaying) {
                this.stepSound.stop();
            }
            this.stepSound.setVolume(this.settings.audioConfig.volume);
            this.stepSound.setPlaybackRate(playbackRate);
            this.stepSound.play();
        }
    }

    public playGameOver() {
        if (this.gameOverSound && this.gameOverSound.buffer) {
            if (this.gameOverSound.isPlaying) this.gameOverSound.stop();
            this.gameOverSound.setVolume(this.settings.audioConfig.volume);
            this.gameOverSound.play();
        }
    }

    public update(headPos: THREE.Vector3) {
        // Don't process if audio not initialized yet
        if (!this.isInitialized) return;

        // Validation: Ensure buffers are loaded
        if (this.humBuffers.length < 3 || !this.humBuffers[0]) return;

        // 1. Calculate distances to all food
        // We only care about active food.
        const foodDistances = this.world.foodPositions.map((pos, index) => {
            return {
                index: index,
                distance: pos.distanceToSquared(headPos)
            };
        });

        // 2. Sort by distance
        foodDistances.sort((a, b) => a.distance - b.distance);

        // 3. Take closest POOL_SIZE items
        const closestFood = foodDistances.slice(0, this.POOL_SIZE);
        const closestIndices = new Set(closestFood.map(f => f.index));

        // 4. Update Pool
        // First, stop playing sounds for food that is no longer in the closest set
        for (const item of this.humPool) {
            if (item.foodIndex !== -1 && !closestIndices.has(item.foodIndex)) {
                // Free this slot
                if (item.source.isPlaying) item.source.stop();
                item.foodIndex = -1;
            }
        }

        // Second, assign free slots to new closest food
        for (const closest of closestFood) {
            // Check if already playing
            const existing = this.humPool.find(p => p.foodIndex === closest.index);
            if (existing) {
                // Already playing, just update position if needed (though position is static for food)
                // But we should update settings like refDistance if they changed
                existing.source.setRefDistance(this.settings.audioConfig.foodSoundRadius);
                existing.source.setVolume(this.settings.audioConfig.volume);
                continue;
            }

            // Not playing, find a free slot
            const freeSlot = this.humPool.find(p => p.foodIndex === -1);
            if (freeSlot) {
                freeSlot.foodIndex = closest.index;
                freeSlot.mesh.position.copy(this.world.foodPositions[closest.index]);

                // Get Sound Type for this food
                const humType = this.world.foodSounds[closest.index] || 1; // Default to 1
                const buffer = this.humBuffers[humType - 1];

                if (buffer) {
                    freeSlot.source.setBuffer(buffer);
                    freeSlot.source.setRefDistance(this.settings.audioConfig.foodSoundRadius);
                    freeSlot.source.setVolume(this.settings.audioConfig.volume);

                    // Random offset to avoid phasing
                    // THREE.Audio uses .offset property when calling start()
                    if (buffer.duration > 0) {
                        freeSlot.source.offset = Math.random() * buffer.duration;
                    }

                    freeSlot.source.play();
                }
            }
        }
    }
}
