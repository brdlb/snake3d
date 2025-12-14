
/**
 * Interface for Game Statistics displayed in Pause Menu
 */
export interface GameStats {
    time: number;       // In seconds
    distance: number;   // Total units traveled
    avgSpeed: number;   // Average SPM
    foodCount: {
        green: number;
        blue: number;
        pink: number;
        total: number;
    }
}

export class PauseUI {
    private container!: HTMLElement;
    private resumeBtn!: HTMLButtonElement;
    private settingsBtn!: HTMLButtonElement;

    // Stats Elements
    private timeEl!: HTMLElement;
    private distanceEl!: HTMLElement;
    private speedEl!: HTMLElement;
    private foodGreenEl!: HTMLElement;
    private foodBlueEl!: HTMLElement;
    private foodPinkEl!: HTMLElement;

    private onResume: () => void;
    private onSettings: () => void;

    constructor(onResume: () => void, onSettings: () => void) {
        this.onResume = onResume;
        this.onSettings = onSettings;
        this.createUI();
    }

    private createUI() {
        this.container = document.createElement('div');
        this.container.className = 'pause-screen';

        // 1. Title Panel
        const titlePanel = document.createElement('div');
        titlePanel.className = 'pause-panel title-panel';
        const title = document.createElement('h1');
        title.className = 'pause-title';
        title.textContent = 'PAUSE';
        titlePanel.appendChild(title);

        // 2. Stats Panel
        const statsPanel = document.createElement('div');
        statsPanel.className = 'pause-panel stats-panel';

        const statsInner = document.createElement('div');
        statsInner.className = 'stats-inner';

        this.timeEl = this.createStatRow(statsInner, 'TIME');
        this.distanceEl = this.createStatRow(statsInner, 'DIST');
        this.speedEl = this.createStatRow(statsInner, 'AVG SPD');

        const foodRow = document.createElement('div');
        foodRow.className = 'stat-row food-row';
        const foodLabel = document.createElement('span');
        foodLabel.className = 'stat-label';
        foodLabel.textContent = 'FOOD';

        const foodValues = document.createElement('div');
        foodValues.className = 'food-values';

        this.foodGreenEl = this.createFoodValue(foodValues, '#4ade80');
        this.foodBlueEl = this.createFoodValue(foodValues, '#60a5fa');
        this.foodPinkEl = this.createFoodValue(foodValues, '#f472b6');

        foodRow.appendChild(foodLabel);
        foodRow.appendChild(foodValues);
        statsInner.appendChild(foodRow);

        statsPanel.appendChild(statsInner);

        // 3. Settings Panel (Button)
        this.settingsBtn = document.createElement('button');
        this.settingsBtn.className = 'pause-panel menu-btn settings-btn';
        this.settingsBtn.textContent = 'SETTINGS';
        this.settingsBtn.onclick = () => this.onSettings();

        // 4. Resume Panel (Button)
        this.resumeBtn = document.createElement('button');
        this.resumeBtn.className = 'pause-panel menu-btn resume-btn';
        this.resumeBtn.textContent = 'RESUME';
        this.resumeBtn.onclick = () => this.onResume();

        this.container.appendChild(titlePanel);
        this.container.appendChild(statsPanel);
        this.container.appendChild(this.settingsBtn);
        this.container.appendChild(this.resumeBtn);

        document.body.appendChild(this.container);

        // Inject styles
        this.injectStyles();
    }

    private createStatRow(parent: HTMLElement, label: string): HTMLElement {
        const row = document.createElement('div');
        row.className = 'stat-row';

        const labelEl = document.createElement('span');
        labelEl.className = 'stat-label';
        labelEl.textContent = label;

        const valueEl = document.createElement('span');
        valueEl.className = 'stat-value';
        valueEl.textContent = '0';

        row.appendChild(labelEl);
        row.appendChild(valueEl);
        parent.appendChild(row);

        return valueEl;
    }

    private createFoodValue(parent: HTMLElement, color: string): HTMLElement {
        const span = document.createElement('span');
        span.className = 'food-val';
        span.style.color = color;
        span.textContent = '0';
        parent.appendChild(span);
        return span;
    }

    private injectStyles() {
        const style = document.createElement('style');
        style.textContent = `
            /* Container reusing some game-over-screen logic but customized */
            .pause-screen {
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                z-index: 2000;
                pointer-events: none;
                background: rgba(0, 0, 0, 0.4);
                backdrop-filter: blur(5px);
                opacity: 0;
                transition: opacity 0.3s ease;
                display: flex;
                flex-direction: column;
                align-items: flex-start;
                justify-content: center;
                gap: 20px;
            }

            .pause-screen.active {
                pointer-events: auto;
                opacity: 1;
            }

            /* Generic Panel Style */
            .pause-panel {
                background: #000000;
                padding: 20px 60px 20px 60px;
                display: flex;
                align-items: center;
                transform: translateX(-100%);
                transition: transform 0.6s cubic-bezier(0.16, 1, 0.3, 1);
                border-right: 4px solid #fff;
                color: #fff;
            }

            .pause-screen.active .pause-panel {
                transform: translateX(0);
            }

            /* Title Panel specific */
            .title-panel {
                padding: 20px 80px;
                border-right-color: #fff;
                /* No delay */
            }

            .pause-title {
                font-family: 'Jura', sans-serif;
                font-size: 5rem;
                font-weight: 900;
                margin: 0;
                letter-spacing: 4px;
                text-transform: uppercase;
                line-height: 1;
            }

            /* Stats Panel specific */
            .stats-panel {
                padding: 20px 60px;
                transition-delay: 0.1s;
                border-right-color: #999;
                min-width: 300px;
            }

            .stats-inner {
                display: flex;
                flex-direction: column;
                gap: 8px;
                width: 100%;
            }

            .stat-row {
                display: flex;
                justify-content: space-between;
                font-family: 'Jura', sans-serif;
                font-size: 1.2rem;
                font-weight: 700;
                letter-spacing: 1px;
            }

            .stat-label {
                color: #888;
            }

            .stat-value {
                color: #fff;
            }

            .food-values {
                display: flex;
                gap: 12px;
            }
            
            .food-val {
                font-weight: bold;
            }

            /* Buttons */
            .menu-btn {
                font-family: 'Jura', sans-serif;
                font-size: 1.5rem;
                font-weight: 700;
                text-transform: uppercase;
                letter-spacing: 2px;
                cursor: pointer;
                outline: none;
                border: none;
                border-right: 4px solid;
                color: #fff;
                transition: transform 0.6s cubic-bezier(0.16, 1, 0.3, 1), 
                            background 0.2s, color 0.2s, padding-left 0.2s;
            }

            .menu-btn:hover {
                background: #1a1a1a;
                padding-left: 70px; /* Slide content slightly right on hover */
            }

            .settings-btn {
                transition-delay: 0.2s;
                border-right-color: #ffd700; /* Gold */
                padding: 30px 60px;
            }
            .settings-btn:hover {
                color: #ffd700;
            }

            .resume-btn {
                transition-delay: 0.3s;
                border-right-color: #4ade80; /* Green */
                padding: 30px 60px;
            }
            .resume-btn:hover {
                color: #4ade80;
            }


            /* Responsive Adjustments */
            @media (max-width: 600px) {
                .pause-title {
                    font-size: 3rem;
                }
                .pause-panel {
                    padding: 15px 30px;
                }
                .menu-btn {
                    font-size: 1rem;
                    padding: 20px 30px;
                }
            }
        `;
        document.head.appendChild(style);
    }

    public updateStats(stats: GameStats) {
        this.timeEl.textContent = this.formatTime(stats.time);
        this.distanceEl.textContent = Math.round(stats.distance).toString();
        this.speedEl.textContent = Math.round(stats.avgSpeed).toString();

        this.foodGreenEl.textContent = stats.foodCount.green.toString();
        this.foodBlueEl.textContent = stats.foodCount.blue.toString();
        this.foodPinkEl.textContent = stats.foodCount.pink.toString();
    }

    private formatTime(seconds: number): string {
        const m = Math.floor(seconds / 60);
        const s = Math.floor(seconds % 60);
        return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }

    public show() {
        this.container.classList.add('active');
        this.container.style.display = 'flex';
    }

    public hide() {
        this.container.classList.remove('active');
        // Wait for transitions to finish before setting display none?
        // Actually, CSS opacity transition handles fade out, transform handles slide out.
        // If we set display:none immediately, animation is cut.
        setTimeout(() => {
            if (!this.container.classList.contains('active')) {
                this.container.style.display = 'none';
            }
        }, 600); // 0.6s match the CSS transition duration
    }

    public dispose() {
        this.container.remove();
    }
}
