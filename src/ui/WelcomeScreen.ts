/**
 * WelcomeScreen - Welcome screen for mobile devices
 * Required for audio initialization via user click
 */
import { networkManager } from '../network/NetworkManager';

export class WelcomeScreen {
    private container: HTMLDivElement;
    private onStart: (mode: 'player' | 'spectator') => void | Promise<void>;
    private readonly invitedRoomSeed: number | null;

    constructor(onStart: (mode: 'player' | 'spectator') => void | Promise<void>) {
        this.onStart = onStart;
        const room = new URLSearchParams(window.location.search).get('room');
        this.invitedRoomSeed = room !== null && /^\d+$/.test(room) && Number.isSafeInteger(Number(room)) ? Number(room) : null;
        this.container = this.createUI();
        document.body.appendChild(this.container);
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

        // High Score
        const user = networkManager.getUser();
        if (user && (user.highScore || 0) > 0) {
            const scoreDisplay = document.createElement('div');
            scoreDisplay.className = 'welcome-high-score';
            scoreDisplay.innerHTML = `
                <span class="label">YOUR RECORD:</span>
                <span class="value">${user.highScore}</span>
            `;
            content.appendChild(scoreDisplay);
        }

        // Controls section
        const controlsSection = document.createElement('div');
        controlsSection.className = 'welcome-controls';

        const controlsTitle = document.createElement('h2');
        controlsTitle.className = 'controls-title';
        controlsTitle.textContent = 'Controls';
        controlsSection.appendChild(controlsTitle);

        const controlsList = document.createElement('div');
        controlsList.className = 'controls-list';

        // Desktop controls
        const desktopControls = document.createElement('div');
        desktopControls.className = 'controls-group';
        desktopControls.innerHTML = `
            <div class="controls-group-title">Desktop</div>
            <div class="control-item">
                <span class="control-key">A / D</span>
                <span class="control-desc">Turn left / right</span>
            </div>
            <div class="control-item">
                <span class="control-key">Q / E</span>
                <span class="control-desc">Roll left / right</span>
            </div>
            <div class="control-item">
                <span class="control-key">SPACE</span>
                <span class="control-desc">Speed boost</span>
            </div>
        `;
        controlsList.appendChild(desktopControls);

        // Mobile controls
        const mobileControls = document.createElement('div');
        mobileControls.className = 'controls-group';
        mobileControls.innerHTML = `
            <div class="controls-group-title">Mobile</div>
            <div class="control-item">
                <span class="control-key">Swipe</span>
                <span class="control-desc">Horizontal — turn</span>
            </div>
            <div class="control-item">
                <span class="control-key">Swipe</span>
                <span class="control-desc">Vertical — roll</span>
            </div>
        `;
        controlsList.appendChild(mobileControls);

        controlsSection.appendChild(controlsList);
        content.appendChild(controlsSection);

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

        // Start button
        const startButton = document.createElement('button');
        startButton.type = 'button';
        startButton.className = 'start-btn';
        startButton.innerHTML = `
            <span class="start-btn-text">START</span>
            <span class="start-btn-icon">▶</span>
        `;
        startButton.addEventListener('click', (event) => {
            event.preventDefault();
            void this.handleStart('player');
        });
        content.appendChild(startButton);

        container.appendChild(content);

        return container;
    }

    private async handleStart(mode: 'player' | 'spectator'): Promise<void> {
        this.container.classList.remove('active');
        this.container.classList.add('hiding');

        // Wait for animation to complete
        await new Promise<void>(resolve => setTimeout(resolve, 600));
        try {
            await this.onStart(mode);
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
