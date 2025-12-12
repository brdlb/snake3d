import { networkManager, UserData, AuthResult } from './NetworkManager';

/**
 * UI для отображения статуса подключения к серверу
 */
export class NetworkStatusUI {
    private container: HTMLElement;
    private statusDot: HTMLElement;
    private statusText: HTMLElement;
    private userInfo: HTMLElement;

    constructor() {
        this.container = document.createElement('div');
        this.container.id = 'network-status';
        this.container.innerHTML = `
            <div class="network-status-inner">
                <span class="status-dot"></span>
                <span class="status-text">Connecting...</span>
            </div>
            <div class="user-info"></div>
        `;

        this.applyStyles();

        this.statusDot = this.container.querySelector('.status-dot')!;
        this.statusText = this.container.querySelector('.status-text')!;
        this.userInfo = this.container.querySelector('.user-info')!;

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
                background: rgba(30, 30, 30, 0.9);
                border: 1px solid rgba(255, 255, 255, 0.1);
                border-radius: 8px;
                padding: 8px 12px;
                font-family: 'Segoe UI', sans-serif;
                font-size: 12px;
                color: #fff;
                z-index: 10000;
                backdrop-filter: blur(10px);
                min-width: 120px;
            }

            .network-status-inner {
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

            .status-dot.connecting {
                background: #f59e0b;
                animation: pulse 1s infinite;
            }

            .status-dot.connected {
                background: #10b981;
            }

            .status-dot.disconnected {
                background: #ef4444;
            }

            .user-info {
                margin-top: 6px;
                padding-top: 6px;
                border-top: 1px solid rgba(255, 255, 255, 0.1);
                font-size: 11px;
                color: #aaa;
                display: none;
            }

            .user-info.visible {
                display: block;
            }

            @keyframes pulse {
                0%, 100% { opacity: 1; }
                50% { opacity: 0.5; }
            }
        `;
        document.head.appendChild(style);
    }

    private setupEventListeners(): void {
        networkManager.on('connectionStateChange', (state: string) => {
            this.updateStatus(state);
        });

        networkManager.on('authenticated', (result: AuthResult) => {
            this.showUserInfo(result.user, result.isNew);
        });

        networkManager.on('userDataUpdated', (user: UserData) => {
            this.updateUserInfo(user);
        });
    }

    private updateStatus(state: string): void {
        this.statusDot.className = 'status-dot ' + state;

        const statusMap: Record<string, string> = {
            disconnected: 'Disconnected',
            connecting: 'Connecting...',
            connected: 'Connected',
            authenticated: 'Online',
        };

        this.statusText.textContent = statusMap[state] || state;
    }

    private showUserInfo(user: UserData, isNew: boolean): void {
        this.userInfo.classList.add('visible');
        this.userInfo.innerHTML = `
            <div>👤 ${user.username}</div>
            ${isNew ? '<div style="color: #10b981;">✨ New player!</div>' : ''}
        `;
    }

    private updateUserInfo(user: UserData): void {
        this.userInfo.innerHTML = `
            <div>👤 ${user.username}</div>
            <div>🏆 Best: ${user.highScore}</div>
            <div>🎮 Games: ${user.gamesPlayed}</div>
        `;
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
