export class GameOverUI {
    private container!: HTMLElement;
    private restartBtn!: HTMLButtonElement;
    private onRestart: () => void;

    constructor(onRestart: () => void) {
        this.onRestart = onRestart;
        this.createUI();
    }

    private createUI() {
        this.container = document.createElement('div');
        this.container.className = 'game-over-screen';

        const title = document.createElement('h1');
        title.className = 'game-over-title';
        title.textContent = 'GAME OVER';

        this.restartBtn = document.createElement('button');
        this.restartBtn.className = 'restart-btn';
        this.restartBtn.textContent = 'RESTART';

        this.restartBtn.addEventListener('click', () => {
            if (this.container.classList.contains('active')) {
                this.onRestart();
            }
        });

        this.container.appendChild(title);
        this.container.appendChild(this.restartBtn);

        // Wrapper for the sliding effect (Title)
        const titlePanel = document.createElement('div');
        titlePanel.className = 'game-over-panel';
        titlePanel.appendChild(title);

        this.container.appendChild(titlePanel);
        this.container.appendChild(this.restartBtn);

        document.body.appendChild(this.container);
    }

    public show() {
        this.container.classList.add('active');
    }

    public hide() {
        this.container.classList.remove('active');
    }

    public dispose() {
        this.restartBtn.removeEventListener('click', this.onRestart);
        this.container.remove();
    }
}
