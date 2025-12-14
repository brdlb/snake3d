import { SettingsManager, CameraConfig, BloomConfig, AudioConfig } from '../core/SettingsManager';

export class SettingsUI {
    private overlay: HTMLDivElement;
    private panel: HTMLDivElement;
    private info: HTMLDivElement;
    private settingsManager: SettingsManager;
    private onSettingsChange: () => void;
    private onClose: () => void;
    private closeBtn: HTMLButtonElement;

    private fpsInfo: HTMLDivElement;

    constructor(
        settingsManager: SettingsManager,
        onSettingsChange: () => void,
        onClose: () => void
    ) {
        this.settingsManager = settingsManager;
        this.onSettingsChange = onSettingsChange;
        this.onClose = onClose;

        // Overlay for black background
        this.overlay = document.createElement('div');
        this.overlay.className = 'settings-overlay';
        document.body.appendChild(this.overlay);

        this.panel = document.createElement('div');
        this.panel.className = 'settings-panel';
        this.overlay.appendChild(this.panel);

        // Header with Title and Close Button
        const header = document.createElement('div');
        header.className = 'settings-header';

        const mainTitle = document.createElement('h2');
        mainTitle.innerText = 'SETTINGS';
        header.appendChild(mainTitle);

        this.closeBtn = document.createElement('button');
        this.closeBtn.className = 'settings-close-btn';
        this.closeBtn.innerHTML = '×';
        this.closeBtn.onclick = () => this.onClose();
        header.appendChild(this.closeBtn);

        this.panel.appendChild(header);

        this.fpsInfo = document.createElement('div');
        this.fpsInfo.className = 'settings-fps';
        this.fpsInfo.style.color = '#00ff00';
        this.panel.appendChild(this.fpsInfo);

        this.info = document.createElement('div');
        this.info.className = 'settings-info';

        this.createControls();
        this.panel.appendChild(this.info);

        this.injectStyles();
    }

    private injectStyles() {
        const style = document.createElement('style');
        style.textContent = `
            .settings-overlay {
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: rgba(0, 0, 0, 0.4);
                backdrop-filter: blur(5px);
                z-index: 3000;
                display: flex;
                flex-direction: column;
                justify-content: center;
                align-items: center; /* Center horizontally */
                opacity: 0;
                pointer-events: none;
                transition: opacity 0.3s ease;
            }

            .settings-overlay.active {
                opacity: 1;
                pointer-events: auto;
            }

            .settings-panel {
                background: #000000;
                border: none;
                border-radius: 0;
                padding: 30px;
                width: 400px;
                max-height: 90vh;
                overflow-y: auto;
                font-family: 'Jura', system-ui, sans-serif;
                color: #e0e0e0;
                transform: translateX(-100%); /* Slide from left like PauseUI */
                transition: transform 0.6s cubic-bezier(0.16, 1, 0.3, 1);
                box-shadow: 0 10px 40px rgba(0,0,0,0.5);
                border-right: 4px solid #ffd700; /* Gold to match Settings button */
            }

            .settings-overlay.active .settings-panel {
                transform: translateX(0);
            }

            .settings-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 20px;
                border-bottom: 1px solid rgba(255, 255, 255, 0.1);
                padding-bottom: 10px;
            }

            .settings-header h2 {
                margin: 0;
                font-size: 24px;
                letter-spacing: 2px;
                font-weight: 700;
                color: #fff;
            }

            .settings-close-btn {
                background: transparent;
                border: none;
                color: #888;
                font-size: 28px;
                line-height: 1;
                cursor: pointer;
                padding: 0;
                transition: color 0.2s;
            }

            .settings-close-btn:hover {
                color: #fff;
            }

            .settings-fps {
                font-family: 'Menlo', monospace;
                font-size: 12px;
                text-align: right;
                margin-bottom: 10px;
            }

            .settings-section-title {
                margin: 20px 0 10px 0;
                font-size: 11px;
                font-weight: 600;
                text-transform: uppercase;
                letter-spacing: 1.2px;
                color: #888;
                border-bottom: 1px solid rgba(255, 255, 255, 0.05);
                padding-bottom: 4px;
            }

            .control-group {
                margin-bottom: 12px;
            }

            /* Reusing slider styles from before or ensuring they work here */
            .control-header {
                display: flex;
                justify-content: space-between;
                font-size: 13px;
                color: #ccc;
                margin-bottom: 4px;
            }

            .value-display {
                font-family: 'Menlo', monospace;
                font-size: 11px;
                color: #0088ff;
                background: rgba(0, 136, 255, 0.1);
                padding: 2px 6px;
                border-radius: 4px;
            }
            
            input[type="range"] {
                width: 100%;
                accent-color: #0088ff;
                cursor: pointer;
            }
        `;
        document.head.appendChild(style);
    }

    public updateInfo(text: string) {
        this.info.innerText = text;
    }

    public show() {
        this.overlay.classList.add('active');
    }

    public hide() {
        this.overlay.classList.remove('active');
    }

    public updateFPS(fps: number) {
        this.fpsInfo.innerText = `FPS: ${Math.round(fps)}`;
    }

    private createControls() {
        const createSection = (titleText: string) => {
            const title = document.createElement('div');
            title.className = 'settings-section-title';
            title.innerText = titleText;
            this.panel.appendChild(title);
        };

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

        createSection('Camera');
        createControl('FOV', 'fov', 30, 120, 1);
        createControl('Dist Up', 'distanceUp', 1, 30);
        createControl('Dist Back', 'distanceBack', 1, 30);
        createControl('Lerp Speed', 'lerpSpeed', 0.1, 20);
        createControl('Horizon Offset', 'horizonOffset', -5, 5, 0.1);


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

        createSection('Bloom');
        createBloomControl('Strength', 'strength', 0, 3, 0.01);
        createBloomControl('Radius', 'radius', 0, 1, 0.01);
        createBloomControl('Threshold', 'threshold', 0, 2, 0.02);


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

        createSection('Audio');
        createAudioControl('Food Radius', 'foodSoundRadius', 0, 2, 0.1);
        createAudioControl('Volume', 'volume', 0, 3, 0.01);
    }

    public dispose() {
        if (this.overlay.parentNode) {
            this.overlay.parentNode.removeChild(this.overlay);
        }
    }
}
