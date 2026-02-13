import { OfflineDataManager } from '../utils/OfflineDataManager';

export interface CameraConfig {
    fov: number;
    distanceUp: number;
    distanceBack: number;
    lerpSpeed: number;
    horizonOffset: number;
}

export interface BloomConfig {
    strength: number;
    radius: number;
    threshold: number;
}

export interface AudioConfig {
    foodSoundRadius: number;
    volume: number;
}

export class SettingsManager {
    public cameraConfig: CameraConfig = {
        fov: 115.0,
        distanceUp: 2.1,
        distanceBack: 3.1,
        lerpSpeed: 4.5,
        horizonOffset: 1.5,
    };

    public bloomConfig: BloomConfig = {
        strength: 0.15,
        radius: 0.60,
        threshold: 0.00
    };

    public audioConfig: AudioConfig = {
        foodSoundRadius: 1.5,
        volume: 0.8
    };

    private offlineManager: OfflineDataManager;

    constructor() {
        this.offlineManager = new OfflineDataManager();
        this.load();
    }

    public async load() {
        // Сначала загружаем из localStorage для быстрого старта
        this.loadFromLocalStorage();

        // Затем пытаемся загрузить из IndexedDB для более надежного хранения
        try {
            await this.loadFromIndexedDB();
        } catch (error) {
            console.warn('[SettingsManager] Failed to load from IndexedDB, using localStorage:', error);
        }
    }

    /**
     * Загрузка настроек из localStorage (синхронно)
     */
    private loadFromLocalStorage() {
        const savedCamera = localStorage.getItem('snake3d_camera_config');
        if (savedCamera) {
            try {
                this.cameraConfig = { ...this.cameraConfig, ...JSON.parse(savedCamera) };
            } catch (e) {
                console.warn('Failed to parse camera settings', e);
            }
        }

        const savedBloom = localStorage.getItem('snake3d_bloom_config');
        if (savedBloom) {
            try {
                this.bloomConfig = { ...this.bloomConfig, ...JSON.parse(savedBloom) };
            } catch (e) {
                console.warn('Failed to parse bloom settings', e);
            }
        }

        const savedAudio = localStorage.getItem('snake3d_audio_config');
        if (savedAudio) {
            try {
                this.audioConfig = { ...this.audioConfig, ...JSON.parse(savedAudio) };
            } catch (e) {
                console.warn('Failed to parse audio settings', e);
            }
        }
    }

    /**
     * Загрузка настроек из IndexedDB (асинхронно)
     */
    private async loadFromIndexedDB() {
        const settings = await this.offlineManager.getGameData('settings');
        if (settings) {
            if (settings.cameraConfig) {
                this.cameraConfig = { ...this.cameraConfig, ...settings.cameraConfig };
            }
            if (settings.bloomConfig) {
                this.bloomConfig = { ...this.bloomConfig, ...settings.bloomConfig };
            }
            if (settings.audioConfig) {
                this.audioConfig = { ...this.audioConfig, ...settings.audioConfig };
            }
            console.log('[SettingsManager] Loaded settings from IndexedDB');
        }
    }

    /**
     * Сохранение настроек (синхронно в localStorage, асинхронно в IndexedDB)
     */
    public save() {
        // Сохраняем в localStorage синхронно
        localStorage.setItem('snake3d_camera_config', JSON.stringify(this.cameraConfig));
        localStorage.setItem('snake3d_bloom_config', JSON.stringify(this.bloomConfig));
        localStorage.setItem('snake3d_audio_config', JSON.stringify(this.audioConfig));

        // Асинхронно сохраняем в IndexedDB
        this.saveToIndexedDB();
    }

    /**
     * Сохранение настроек в IndexedDB
     */
    private async saveToIndexedDB() {
        try {
            await this.offlineManager.saveGameData('settings', {
                cameraConfig: this.cameraConfig,
                bloomConfig: this.bloomConfig,
                audioConfig: this.audioConfig,
                timestamp: Date.now()
            });
            console.log('[SettingsManager] Settings saved to IndexedDB');
        } catch (error) {
            console.error('[SettingsManager] Failed to save settings to IndexedDB:', error);
        }
    }
}
