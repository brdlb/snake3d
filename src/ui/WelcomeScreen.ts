import { networkManager } from '../network/NetworkManager';

export class WelcomeScreen {
    private container: HTMLDivElement;
    private entering = false;
    private statsRefresh: number | null = null;
    private readonly invitedRoomSeed: number | null;

    constructor(
        private readonly onStart: (mode: 'player', roomSeed?: number) => void | Promise<void>,
        private readonly onLeaderboard: () => void,
        private readonly onSettings: () => void,
    ) {
        const room = new URLSearchParams(window.location.search).get('room');
        this.invitedRoomSeed = room !== null && /^\d+$/.test(room) && Number.isSafeInteger(Number(room)) ? Number(room) : null;
        this.container = this.createUI();
        document.body.appendChild(this.container);
        void this.loadStats();
        this.statsRefresh = window.setInterval(() => void this.loadStats(), 15000);
    }

    private createUI(): HTMLDivElement {
        const container = document.createElement('div');
        container.className = 'welcome-screen active';
        container.id = 'welcome-screen';
        const overlay = document.createElement('div');
        overlay.className = 'welcome-overlay';
        container.appendChild(overlay);
        const content = document.createElement('div');
        content.className = 'welcome-content frame-corners';
        const title = document.createElement('h1');
        title.className = 'welcome-title';
        title.textContent = 'SNAKE_';
        content.appendChild(title);
        const actions = document.createElement('div');
        actions.className = 'welcome-actions';
        for (const [label, action] of [
            ['ENTER', () => void this.handleEnter()],
            ['LEADERBOARD', this.onLeaderboard],
            ['SETTINGS', this.onSettings],
        ] as const) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'start-btn';
            button.textContent = label;
            button.addEventListener('click', action);
            actions.appendChild(button);
        }
        content.appendChild(actions);
        const stats = document.createElement('p');
        stats.className = 'welcome-stats';
        stats.setAttribute('aria-live', 'polite');
        stats.textContent = 'ROOMS —  ·  PLAYERS ONLINE —';
        content.appendChild(stats);
        container.appendChild(content);
        return container;
    }

    private async loadStats(): Promise<void> {
        if (!networkManager.isConnected()) return;
        try {
            const { rooms, playersOnline } = await networkManager.requestRoomStats();
            const stats = this.container.querySelector<HTMLElement>('.welcome-stats');
            if (stats) stats.textContent = `ROOMS ${rooms}  ·  PLAYERS ONLINE ${playersOnline}`;
        } catch (error) {
            console.warn('[Welcome] Unable to load room stats:', error);
        }
    }

    private async handleEnter(): Promise<void> {
        if (this.entering) return;
        this.entering = true;
        const enter = this.container.querySelector<HTMLButtonElement>('.welcome-actions button');
        if (enter) enter.disabled = true;
        try {
            const seed = this.invitedRoomSeed ?? (networkManager.isConnected()
                ? (await networkManager.requestEnterRoom()).seed
                : undefined);
            this.container.classList.remove('active');
            this.container.classList.add('hiding');
            await new Promise<void>((resolve) => setTimeout(resolve, 600));
            await this.onStart('player', seed);
            if (this.statsRefresh !== null) window.clearInterval(this.statsRefresh);
            this.container.remove();
        } catch (error) {
            console.error('[Welcome] Unable to enter the room:', error);
            this.container.classList.remove('hiding');
            this.container.classList.add('active');
            let message = this.container.querySelector<HTMLParagraphElement>('.welcome-start-error');
            if (!message) {
                message = document.createElement('p');
                message.className = 'welcome-start-error';
                this.container.querySelector('.welcome-content')?.appendChild(message);
            }
            message.textContent = 'UNABLE TO ENTER. PLEASE TRY AGAIN.';
            this.entering = false;
            if (enter) enter.disabled = false;
        }
    }

    public hide(): void {
        this.container.classList.remove('active');
    }

    public show(): void {
        this.container.classList.add('active');
    }

    public dispose(): void {
        if (this.statsRefresh !== null) window.clearInterval(this.statsRefresh);
        this.container.remove();
    }
}
