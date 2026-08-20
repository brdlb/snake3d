import { networkManager } from './NetworkManager';

/** Small, unobtrusive indicator of whether the game can use the online API. */
export class NetworkStatusUI {
    private container: HTMLElement;
    private statusDot: HTMLElement;

    constructor() {
        this.container = document.createElement('div');
        this.container.id = 'network-status';
        this.container.innerHTML = `
            <span class="status-dot" aria-hidden="true"></span>
        `;

        this.applyStyles();

        this.statusDot = this.container.querySelector('.status-dot')!;

        document.body.appendChild(this.container);

        this.setupEventListeners();
        this.updateConnectionStatus(networkManager.isConnected());
    }

    private applyStyles(): void {
        const style = document.createElement('style');
        style.textContent = `
            #network-status {
                position: fixed;
                top: 10px;
                right: 10px;
                display: flex;
                align-items: center;
                justify-content: center;
                width: 20px;
                height: 20px;
                background: rgba(12, 18, 28, 0.72);
                border: 1px solid rgba(255, 255, 255, 0.12);
                border-radius: 50%;
                z-index: 10000;
                backdrop-filter: blur(10px);
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
        this.container.title = isOnline ? 'Online' : 'Offline';
        this.container.setAttribute('aria-label', isOnline ? 'Online' : 'Offline');
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
