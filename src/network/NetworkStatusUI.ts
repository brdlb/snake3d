import { networkManager } from './NetworkManager';

/**
 * UI для отображения информации о текущей комнате
 */
export class NetworkStatusUI {
    private container: HTMLElement;
    private seedText: HTMLElement;
    private statusDot: HTMLElement;

    constructor() {
        this.container = document.createElement('div');
        this.container.id = 'network-status';
        this.container.innerHTML = `
            <div class="room-info">
                <span class="status-dot"></span>
                <span class="seed-label">Room:</span>
                <span class="seed-text">---</span>
            </div>
        `;

        this.applyStyles();

        this.statusDot = this.container.querySelector('.status-dot')!;
        this.seedText = this.container.querySelector('.seed-text')!;

        document.body.appendChild(this.container);

        this.setupEventListeners();
    }

    private applyStyles(): void {
        const style = document.createElement('style');
        style.textContent = `
            #network-status {
                position: fixed;
                top: 10px;
                right: 10px;
                background: rgba(30, 30, 30, 0.85);
                border: 1px solid rgba(255, 255, 255, 0.1);
                border-radius: 8px;
                padding: 8px 14px;
                font-family: 'Consolas', 'Monaco', monospace;
                font-size: 13px;
                color: #fff;
                z-index: 10000;
                backdrop-filter: blur(10px);
            }

            .room-info {
                display: flex;
                align-items: center;
                gap: 8px;
            }

            .status-dot {
                width: 8px;
                height: 8px;
                border-radius: 50%;
                background: #666;
                transition: background 0.3s ease;
            }

            .status-dot.online {
                background: #10b981;
            }

            .status-dot.offline {
                background: #ef4444;
            }

            .seed-label {
                color: #888;
            }

            .seed-text {
                color: #88ffff;
                font-weight: bold;
                letter-spacing: 1px;
            }
        `;
        document.head.appendChild(style);
    }

    private setupEventListeners(): void {
        networkManager.on('connectionStateChange', (state: string) => {
            this.updateConnectionStatus(state === 'authenticated');
        });
    }

    private updateConnectionStatus(isOnline: boolean): void {
        this.statusDot.className = 'status-dot ' + (isOnline ? 'online' : 'offline');
    }

    /**
     * Обновить отображаемый seed комнаты
     */
    public setSeed(seed: number): void {
        this.seedText.textContent = seed.toString();
    }

    public hide(): void {
        this.container.style.display = 'none';
    }

    public show(): void {
        this.container.style.display = 'block';
    }

    public destroy(): void {
        this.container.remove();
    }
}
