import { SettingsManager, CameraConfig, BloomConfig, AudioConfig } from '../core/SettingsManager';

export class DebugUI {
    private panel: HTMLDivElement;
    private toggleBtn: HTMLButtonElement;
    private info: HTMLDivElement;
    private settingsManager: SettingsManager;
    private onSettingsChange: () => void;

    private fpsInfo: HTMLDivElement;

    constructor(settingsManager: SettingsManager, onSettingsChange: () => void) {
        this.settingsManager = settingsManager;
        this.onSettingsChange = onSettingsChange;

        // Toggle Button
        this.toggleBtn = document.createElement('button');
        this.toggleBtn.className = 'debug-toggle';
        this.toggleBtn.innerHTML = '⚙';
        this.toggleBtn.addEventListener('click', () => {
            this.panel.classList.toggle('active');
        });
        document.body.appendChild(this.toggleBtn);

        this.panel = document.createElement('div');
        this.panel.className = 'debug-panel';
        document.body.appendChild(this.panel);

        this.fpsInfo = document.createElement('div');
        this.fpsInfo.className = 'debug-info';
        this.fpsInfo.style.color = '#00ff00';
        this.panel.appendChild(this.fpsInfo);

        this.info = document.createElement('div');
        this.info.className = 'debug-info';

        this.createControls();
        this.panel.appendChild(this.info);
    }

    public updateInfo(text: string) {
        this.info.innerText = text;
    }

    public updateFPS(fps: number) {
        this.fpsInfo.innerText = `FPS: ${Math.round(fps)}`;
    }

    private createControls() {
        // Title
        const title = document.createElement('h3');
        title.innerText = 'Camera Settings';
        this.panel.appendChild(title);

        const createControl = (label: string, configKey: keyof CameraConfig, min: number, max: number, step: number = 0.1) => {
            const group = document.createElement('div');
            group.className = 'control-group';

            const header = document.createElement('div');
            header.className = 'control-header';

            const labelEl = document.createElement('span');
            labelEl.innerText = label;

            const valEl = document.createElement('span');
            valEl.className = 'value-display';
            valEl.innerText = this.settingsManager.cameraConfig[configKey].toFixed(1);

            header.appendChild(labelEl);
            header.appendChild(valEl);
            group.appendChild(header);

            const input = document.createElement('input');
            input.type = 'range';
            input.min = min.toString();
            input.max = max.toString();
            input.step = step.toString();
            input.value = this.settingsManager.cameraConfig[configKey].toString();

            input.addEventListener('input', (e) => {
                const val = parseFloat((e.target as HTMLInputElement).value);
                this.settingsManager.cameraConfig[configKey] = val;
                valEl.innerText = val.toFixed(1);
                this.settingsManager.save();
                this.onSettingsChange();
            });

            group.appendChild(input);
            this.panel.appendChild(group);
        };

        createControl('FOV', 'fov', 30, 120, 1);
        createControl('Dist Up', 'distanceUp', 1, 30);
        createControl('Dist Back', 'distanceBack', 1, 30);
        createControl('Lerp Speed', 'lerpSpeed', 0.1, 20);
        createControl('Horizon Offset', 'horizonOffset', -5, 5, 0.1);

        // Bloom
        const bloomTitle = document.createElement('h3');
        bloomTitle.innerText = 'Bloom Settings';
        bloomTitle.style.marginTop = '20px';
        this.panel.appendChild(bloomTitle);

        const createBloomControl = (label: string, configKey: keyof BloomConfig, min: number, max: number, step: number = 0.1) => {
            const group = document.createElement('div');
            group.className = 'control-group';

            const header = document.createElement('div');
            header.className = 'control-header';

            const labelEl = document.createElement('span');
            labelEl.innerText = label;

            const valEl = document.createElement('span');
            valEl.className = 'value-display';
            valEl.innerText = this.settingsManager.bloomConfig[configKey].toFixed(2);

            header.appendChild(labelEl);
            header.appendChild(valEl);
            group.appendChild(header);

            const input = document.createElement('input');
            input.type = 'range';
            input.min = min.toString();
            input.max = max.toString();
            input.step = step.toString();
            input.value = this.settingsManager.bloomConfig[configKey].toString();

            input.addEventListener('input', (e) => {
                const val = parseFloat((e.target as HTMLInputElement).value);
                this.settingsManager.bloomConfig[configKey] = val;
                valEl.innerText = val.toFixed(2);
                this.settingsManager.save();
                this.onSettingsChange();
            });

            group.appendChild(input);
            this.panel.appendChild(group);
        };

        createBloomControl('Strength', 'strength', 0, 3, 0.01);
        createBloomControl('Radius', 'radius', 0, 1, 0.01);
        createBloomControl('Threshold', 'threshold', 0, 2, 0.02);

        // Audio
        const audioTitle = document.createElement('h3');
        audioTitle.innerText = 'Audio Settings';
        audioTitle.style.marginTop = '20px';
        this.panel.appendChild(audioTitle);

        const createAudioControl = (label: string, configKey: keyof AudioConfig, min: number, max: number, step: number = 0.1) => {
            const group = document.createElement('div');
            group.className = 'control-group';

            const header = document.createElement('div');
            header.className = 'control-header';

            const labelEl = document.createElement('span');
            labelEl.innerText = label;

            const valEl = document.createElement('span');
            valEl.className = 'value-display';
            valEl.innerText = this.settingsManager.audioConfig[configKey].toFixed(1);

            header.appendChild(labelEl);
            header.appendChild(valEl);
            group.appendChild(header);

            const input = document.createElement('input');
            input.type = 'range';
            input.min = min.toString();
            input.max = max.toString();
            input.step = step.toString();
            input.value = this.settingsManager.audioConfig[configKey].toString();

            input.addEventListener('input', (e) => {
                const val = parseFloat((e.target as HTMLInputElement).value);
                this.settingsManager.audioConfig[configKey] = val;
                valEl.innerText = val.toFixed(1);
                this.settingsManager.save();
                this.onSettingsChange();
            });

            group.appendChild(input);
            this.panel.appendChild(group);
        };

        createAudioControl('Food Radius', 'foodSoundRadius', 0, 2, 0.1);
        createAudioControl('Volume', 'volume', 0, 3, 0.01);
    }

    public dispose() {
        if (this.panel.parentNode) {
            this.panel.parentNode.removeChild(this.panel);
        }
        if (this.toggleBtn.parentNode) {
            this.toggleBtn.parentNode.removeChild(this.toggleBtn);
        }
    }
}
