/**
 * WelcomeScreen - Welcome screen for mobile devices
 * Required for audio initialization via user click
 */
export class WelcomeScreen {
    private container: HTMLDivElement;
    private onStart: () => void;

    constructor(onStart: () => void) {
        this.onStart = onStart;
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

        // Subtitle
        const subtitle = document.createElement('p');
        subtitle.className = 'welcome-subtitle';
        subtitle.textContent = 'Classic snake in three-dimensional space';
        content.appendChild(subtitle);

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
        startButton.className = 'start-btn';
        startButton.innerHTML = `
            <span class="start-btn-text">START</span>
            <span class="start-btn-icon">▶</span>
        `;
        startButton.addEventListener('click', () => this.handleStart());
        content.appendChild(startButton);

        container.appendChild(content);

        return container;
    }

    private handleStart(): void {
        this.container.classList.remove('active');
        this.container.classList.add('hiding');

        // Wait for animation to complete
        setTimeout(() => {
            this.onStart();
            this.container.remove();
        }, 600);
    }

    public dispose(): void {
        if (this.container && this.container.parentNode) {
            this.container.remove();
        }
    }
}
