/**
 * WelcomeScreen - Welcome screen for mobile devices
 * Required for audio initialization via user click
 */
import { networkManager } from '../network/NetworkManager';
import type { RoomSummary } from '../types/replay';

export class WelcomeScreen {
    private container: HTMLDivElement;
    private onStart: (mode: 'player' | 'spectator', roomSeed?: number) => void | Promise<void>;
    private readonly invitedRoomSeed: number | null;

    constructor(onStart: (mode: 'player' | 'spectator', roomSeed?: number) => void | Promise<void>) {
        this.onStart = onStart;
        const room = new URLSearchParams(window.location.search).get('room');
        this.invitedRoomSeed = room !== null && /^\d+$/.test(room) && Number.isSafeInteger(Number(room)) ? Number(room) : null;
        this.container = this.createUI();
        document.body.appendChild(this.container);
        if (this.invitedRoomSeed === null) void this.loadRooms();
    }

    private createUI(): HTMLDivElement {
        const container = document.createElement('div');
        container.className = 'welcome-screen active';
        container.id = 'welcome-screen';

        // Background overlay
        const overlay = document.createElement('div');
        overlay.className = 'welcome-overlay';
        container.appendChild(overlay);

        // Content wrapper
        const content = document.createElement('div');
        content.className = 'welcome-content';

        // Logo / Title
        const title = document.createElement('h1');
        title.className = 'welcome-title';
        title.textContent = 'SNAKE 3D';
        content.appendChild(title);

        if (this.invitedRoomSeed !== null) {
            const message = document.createElement('p');
            message.className = 'welcome-room-invitation';
            message.textContent = `You are about to appear in room number ${this.invitedRoomSeed}.`;
            content.appendChild(message);

            const actions = document.createElement('div');
            actions.className = 'welcome-room-actions';
            for (const [mode, label] of [
                ['player', 'PLAY AS PLAYER'],
                ['spectator', 'WATCH AS SPECTATOR'],
            ] as const) {
                const button = document.createElement('button');
                // An invite can be embedded in a form by a host page.  Do not let
                // the browser treat this action as a form submission/navigation.
                button.type = 'button';
                button.className = 'start-btn welcome-room-action';
                button.textContent = label;
                button.addEventListener('click', (event) => {
                    event.preventDefault();
                    void this.handleStart(mode);
                });
                actions.appendChild(button);
            }
            content.appendChild(actions);
            container.appendChild(content);
            return container;
        }

        const roomsSection = document.createElement('section');
        roomsSection.className = 'welcome-rooms';
        roomsSection.innerHTML = `
            <div class="rooms-heading">
                <h2 class="rooms-title">SELECT ROOM</h2>
                <button type="button" class="room-create">+ NEW ROOM</button>
            </div>
            <div class="rooms-columns" aria-hidden="true">
                <span>ROOM</span>
                <span>GAMES</span>
                <span>BEST BY RESPAWN SLOT</span>
            </div>
            <div class="rooms-list" aria-live="polite">
                <div class="rooms-message">LOADING ROOMS…</div>
            </div>
        `;
        roomsSection.querySelector<HTMLButtonElement>('.room-create')
            ?.addEventListener('click', () => void this.createRoom());
        content.appendChild(roomsSection);

        // Headphones recommendation
        const headphonesSection = document.createElement('div');
        headphonesSection.className = 'headphones-section';
        headphonesSection.innerHTML = `
            <div class="headphones-icon">🎧</div>
            <div class="headphones-text">
                <strong>Headphones recommended</strong>
                <span>Game uses spatial audio</span>
            </div>
        `;
        content.appendChild(headphonesSection);

        container.appendChild(content);

        return container;
    }

    private async loadRooms(): Promise<void> {
        const list = this.container.querySelector<HTMLDivElement>('.rooms-list');
        if (!list) return;
        try {
            const rooms = await networkManager.requestRooms();
            list.replaceChildren();
            if (rooms.length === 0) {
                const message = document.createElement('div');
                message.className = 'rooms-message';
                message.textContent = 'NO ROOMS YET';
                list.appendChild(message);
                return;
            }
            rooms.forEach((room) => list.appendChild(this.createRoomButton(room)));
        } catch (error) {
            console.warn('[Welcome] Unable to load rooms:', error);
            list.replaceChildren(this.createFallbackButton('START OFFLINE'));
        }
    }

    private createRoomButton(room: RoomSummary): HTMLDivElement {
        const row = document.createElement('div');
        row.className = 'room-row';
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'room-open';
        button.setAttribute('aria-label', `Enter room ${room.seed}`);

        const seed = document.createElement('span');
        seed.className = 'room-seed';
        seed.textContent = `#${room.seed}`;

        const games = document.createElement('span');
        games.className = 'room-games';
        games.textContent = String(room.gamesPlayed);

        const scores = document.createElement('span');
        scores.className = 'room-scores';
        room.bestScores.forEach((score, index) => {
            const slot = document.createElement('span');
            slot.className = 'room-score';
            const number = document.createElement('small');
            number.textContent = String(index + 1);
            const value = document.createElement('strong');
            value.textContent = score === null ? '—' : String(score);
            slot.append(number, value);
            scores.appendChild(slot);
        });

        const arrow = document.createElement('span');
        arrow.className = 'room-enter';
        arrow.textContent = '▶';
        button.append(seed, games, scores, arrow);
        button.addEventListener('click', () => void this.handleStart('player', room.seed));

        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'room-delete';
        remove.textContent = '×';
        remove.title = `Delete room ${room.seed}`;
        remove.setAttribute('aria-label', `Delete room ${room.seed}`);
        remove.addEventListener('click', () => void this.deleteRoom(room, row));
        row.append(button, remove);
        return row;
    }

    private async createRoom(): Promise<void> {
        const button = this.container.querySelector<HTMLButtonElement>('.room-create');
        if (!button || button.disabled) return;
        button.disabled = true;
        try {
            const room = await networkManager.createRoom();
            await this.handleStart('player', room.seed);
        } catch (error) {
            console.error('[Welcome] Unable to create room:', error);
            this.showStartError('Unable to create a room. Please try again.');
            button.disabled = false;
        }
    }

    private async deleteRoom(room: RoomSummary, row: HTMLDivElement): Promise<void> {
        if (!window.confirm(`Delete room ${room.seed} and all its results?`)) return;
        const buttons = row.querySelectorAll<HTMLButtonElement>('button');
        buttons.forEach((button) => { button.disabled = true; });
        try {
            await networkManager.deleteRoom(room.seed);
            row.remove();
            const list = this.container.querySelector<HTMLDivElement>('.rooms-list');
            if (list && !list.querySelector('.room-row')) {
                const message = document.createElement('div');
                message.className = 'rooms-message';
                message.textContent = 'NO ROOMS YET';
                list.appendChild(message);
            }
        } catch (error) {
            console.error('[Welcome] Unable to delete room:', error);
            this.showStartError('Unable to delete this room. Please try again.');
            buttons.forEach((button) => { button.disabled = false; });
        }
    }

    private createFallbackButton(label: string): HTMLButtonElement {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'room-fallback';
        button.textContent = label;
        button.addEventListener('click', () => void this.handleStart('player'));
        return button;
    }

    private async handleStart(mode: 'player' | 'spectator', roomSeed?: number): Promise<void> {
        this.container.classList.remove('active');
        this.container.classList.add('hiding');

        // Wait for animation to complete
        await new Promise<void>(resolve => setTimeout(resolve, 600));
        try {
            await this.onStart(mode, roomSeed);
            this.container.remove();
        } catch (error) {
            console.error('[Welcome] Unable to enter the room', error);
            this.container.classList.remove('hiding');
            this.container.classList.add('active');
            this.showStartError('Unable to enter this room. Please try again.');
        }
    }

    private showStartError(message: string): void {
        let error = this.container.querySelector<HTMLParagraphElement>('.welcome-start-error');
        if (!error) {
            error = document.createElement('p');
            error.className = 'welcome-start-error';
            this.container.querySelector('.welcome-content')?.appendChild(error);
        }
        error.textContent = message;
    }

    public dispose(): void {
        if (this.container && this.container.parentNode) {
            this.container.remove();
        }
    }
}
