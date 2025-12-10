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

    constructor() {
        this.load();
    }

    public load() {
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

    public save() {
        localStorage.setItem('snake3d_camera_config', JSON.stringify(this.cameraConfig));
        localStorage.setItem('snake3d_bloom_config', JSON.stringify(this.bloomConfig));
        localStorage.setItem('snake3d_audio_config', JSON.stringify(this.audioConfig));
    }
}
