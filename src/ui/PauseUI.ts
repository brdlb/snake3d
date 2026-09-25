
/**
 * Interface for Game Statistics displayed in Pause Menu
 */
export interface GameStats {
    score: number;      // Current score
    length: number;     // Current snake length
    time: number;       // In seconds
    distance: number;   // Total units traveled
    avgSpeed: number;   // Average SPM
    maxSpeed?: number;  // Max SPM (optional)
    foodCount: {
        green: number;
        blue: number;
        pink: number;
        total: number;
    }
}

export interface PauseSnake {
    id: string;
    name: string;
    kind: 'self' | 'player' | 'phantom';
    appearance: SnakeAppearance;
    stats: Partial<GameStats> & Pick<GameStats, 'score' | 'length' | 'avgSpeed'>;
}

export class PauseUI {
    private container!: HTMLElement;
    private resumeBtn!: HTMLButtonElement;
    private settingsBtn!: HTMLButtonElement;
    private orientationLockInput?: HTMLInputElement;

    // Stats Elements
    private scoreEl!: HTMLElement;
    private lengthEl!: HTMLElement;
    private timeEl!: HTMLElement;
    private distanceEl!: HTMLElement;
    private speedEl!: HTMLElement;
    private foodGreenEl!: HTMLElement;
    private foodBlueEl!: HTMLElement;
    private foodPinkEl!: HTMLElement;
    private roomEl!: HTMLButtonElement;
    private selectedSnakeNameEl!: HTMLElement;
    private selectedSnakeMetaEl!: HTMLElement;
    private appearancePanel!: HTMLElement;
    private roomSeed: number | null = null;
    private previewAppearance: SnakeAppearance;

    private onResume: () => void;
    private onSettings: () => void;
    private onLeaderboard: () => void;
    private onOrientationLockChange?: (locked: boolean) => void;
    private appearance: SnakeAppearance;
    private onAppearanceChange: (appearance: SnakeAppearance) => void;
    private patternCanvas!: HTMLCanvasElement;
    private seedInput!: HTMLInputElement;
    private backgroundInput!: HTMLInputElement;
    private patternInput!: HTMLInputElement;

    constructor(
        onResume: () => void,
        onSettings: () => void,
        onLeaderboard: () => void,
        onOrientationLockChange?: (locked: boolean) => void,
        appearance: SnakeAppearance = { patternSeed: 1847, backgroundColor: '#000000', patternColor: '#ffffff' },
        onAppearanceChange: (appearance: SnakeAppearance) => void = () => {},
    ) {
        this.onResume = onResume;
        this.onSettings = onSettings;
        this.onLeaderboard = onLeaderboard;
        this.onOrientationLockChange = onOrientationLockChange;
        this.appearance = { ...appearance };
        this.previewAppearance = { ...appearance };
        this.onAppearanceChange = onAppearanceChange;
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

        this.roomEl = document.createElement('button');
        this.roomEl.type = 'button';
        this.roomEl.className = 'pause-room';
        this.roomEl.textContent = 'You exist in room 0';
        this.roomEl.title = 'Copy invitation link';
        this.roomEl.onclick = () => void this.copyRoomLink();
        titlePanel.appendChild(this.roomEl);

        const appearancePanel = document.createElement('section');
        appearancePanel.className = 'pause-panel appearance-panel';
        this.appearancePanel = appearancePanel;
        const appearanceTitle = document.createElement('span');
        appearanceTitle.className = 'appearance-title';
        appearanceTitle.textContent = 'SNAKE STYLE';
        const identity = document.createElement('div');
        identity.className = 'appearance-identity';
        this.selectedSnakeNameEl = document.createElement('strong');
        this.selectedSnakeNameEl.textContent = 'YOU';
        this.selectedSnakeMetaEl = document.createElement('span');
        this.selectedSnakeMetaEl.textContent = 'A / D · SELECT SNAKE';
        identity.append(this.selectedSnakeNameEl, this.selectedSnakeMetaEl);
        this.patternCanvas = document.createElement('canvas');
        this.patternCanvas.width = 112;
        this.patternCanvas.height = 112;
        this.patternCanvas.className = 'pattern-preview';
        this.patternCanvas.setAttribute('aria-label', 'Selected snake ornament preview');
        const controls = document.createElement('div');
        controls.className = 'appearance-controls';
        const seedRow = document.createElement('label');
        seedRow.className = 'appearance-seed';
        const seedLabel = document.createElement('span');
        seedLabel.textContent = 'SEED';
        this.seedInput = document.createElement('input');
        this.seedInput.type = 'number';
        this.seedInput.min = '0';
        this.seedInput.max = '4294967295';
        this.seedInput.value = String(this.appearance.patternSeed);
        const randomButton = document.createElement('button');
        randomButton.type = 'button';
        randomButton.textContent = 'RANDOM';
        randomButton.onclick = () => {
            this.seedInput.value = String(crypto.getRandomValues(new Uint32Array(1))[0]);
            const colors = randomizeSnakeColors();
            this.backgroundInput.value = colors.backgroundColor;
            this.patternInput.value = colors.patternColor;
            this.commitAppearance();
        };
        seedRow.append(seedLabel, this.seedInput, randomButton);
        const colors = document.createElement('div');
        colors.className = 'appearance-colors';
        this.backgroundInput = this.createColorInput('COLOR A', this.appearance.backgroundColor);
        this.patternInput = this.createColorInput('COLOR B', this.appearance.patternColor);
        colors.append(this.backgroundInput.parentElement!, this.patternInput.parentElement!);
        controls.append(seedRow, colors);
        appearancePanel.append(appearanceTitle, identity, this.patternCanvas, controls);

        // 2. Stats Panel
        const statsPanel = document.createElement('div');
        statsPanel.className = 'pause-panel stats-panel';

        const statsInner = document.createElement('div');
        statsInner.className = 'stats-inner';

        this.scoreEl = this.createStatRow(statsInner, 'SCORE');
        this.lengthEl = this.createStatRow(statsInner, 'LENGTH');
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
        this.container.appendChild(appearancePanel);
        this.container.appendChild(statsPanel);
        this.container.appendChild(this.settingsBtn);
        this.seedInput.onchange = () => this.commitAppearance();
        this.drawPattern();

        if (this.isMobileDevice()) {
            const orientationPanel = document.createElement('label');
            orientationPanel.className = 'pause-panel orientation-lock-panel';

            const orientationText = document.createElement('span');
            orientationText.textContent = 'LOCK ROTATION';

            this.orientationLockInput = document.createElement('input');
            this.orientationLockInput.type = 'checkbox';
            this.orientationLockInput.setAttribute('aria-label', 'Lock screen rotation');
            this.orientationLockInput.onchange = () =>
                this.onOrientationLockChange?.(this.orientationLockInput!.checked);

            orientationPanel.append(orientationText, this.orientationLockInput);
            this.container.appendChild(orientationPanel);
        }

        // Leaderboard Button
        const leadersBtn = document.createElement('button');
        leadersBtn.className = 'pause-panel menu-btn leaders-btn';
        leadersBtn.textContent = 'LEADERS';
        leadersBtn.onclick = () => this.onLeaderboard();
        this.container.appendChild(leadersBtn);

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
                opacity: 0;
                transition: opacity 0.3s ease;
                display: flex;
                flex-direction: column;
                align-items: flex-start;
                justify-content: center;
                gap: 20px;
                overflow-y: auto;
                box-sizing: border-box;
                padding: 18px 0;
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
                flex-direction: column;
                align-items: flex-start;
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

            .pause-room {
                font-family: 'Jura', sans-serif;
                font-size: 1rem;
                font-weight: 700;
                letter-spacing: 1px;
                margin: 12px 0 0;
                color: #aaa;
                background: none;
                border: 0;
                padding: 0;
                cursor: pointer;
                text-align: left;
            }
            .pause-room:focus-visible, .pause-room:hover {
                color: #fff;
                text-decoration: underline;
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

            .appearance-panel {
                gap: 20px;
                padding: 18px 60px;
                border-right-color: #f472b6;
                transition-delay: 0.23s;
                font-family: 'Jura', sans-serif;
            }
            .appearance-title { font-weight: 800; letter-spacing: 2px; writing-mode: vertical-rl; transform: rotate(180deg); }
            .appearance-identity { display: flex; flex-direction: column; gap: 5px; min-width: 125px; }
            .appearance-identity strong { font-size: 1.1rem; letter-spacing: 1px; overflow-wrap: anywhere; }
            .appearance-identity span { color: #888; font-size: .68rem; font-weight: 700; letter-spacing: 1px; }
            .pattern-preview { width: 92px; height: 92px; image-rendering: pixelated; border: 2px solid #444; background: #111; }
            .appearance-controls { display: flex; flex-direction: column; gap: 12px; }
            .appearance-seed, .appearance-colors label { display: flex; align-items: center; gap: 9px; color: #888; font-size: .78rem; font-weight: 700; letter-spacing: 1px; }
            .appearance-seed input { width: 112px; }
            .appearance-seed input, .appearance-seed button { color: #fff; background: #111; border: 1px solid #555; padding: 7px; font-family: inherit; }
            .appearance-seed button { cursor: pointer; }
            .appearance-seed button:hover { border-color: #f472b6; color: #f472b6; }
            .appearance-colors { display: flex; gap: 18px; }
            .appearance-colors label { flex-direction: column; align-items: flex-start; }
            .appearance-colors input { width: 52px; height: 28px; padding: 0; border: 1px solid #555; background: #111; cursor: pointer; }
            .appearance-panel.readonly .appearance-controls { display: none; }

            .resume-btn {
                transition-delay: 0.3s;
                border-right-color: #4ade80; /* Green */
                padding: 30px 60px;
            }
            .resume-btn:hover {
                color: #4ade80;
            }

            .leaders-btn {
                transition-delay: 0.25s;
                border-right-color: #0088ff; /* Blue */
                padding: 30px 60px;
            }

            .orientation-lock-panel {
                justify-content: space-between;
                gap: 32px;
                min-width: 300px;
                padding: 18px 60px;
                border-right-color: #a78bfa;
                font-family: 'Jura', sans-serif;
                font-size: 1.1rem;
                font-weight: 700;
                letter-spacing: 1px;
            }

            .orientation-lock-panel input {
                width: 22px;
                height: 22px;
                accent-color: #a78bfa;
                cursor: pointer;
            }
            .leaders-btn:hover {
                color: #0088ff;
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
                .orientation-lock-panel {
                    min-width: 0;
                    padding: 15px 30px;
                    font-size: 0.85rem;
                }
                .appearance-panel { padding: 12px 30px; gap: 10px; }
                .appearance-title { display: none; }
                .pattern-preview { width: 70px; height: 70px; }
                .appearance-colors { gap: 8px; }
            }
            @media (max-height: 850px) {
                .pause-screen { justify-content: flex-start; gap: 10px; }
                .title-panel { padding-top: 12px; padding-bottom: 12px; }
                .pause-title { font-size: 3rem; }
                .stats-panel { padding-top: 12px; padding-bottom: 12px; }
                .menu-btn { padding-top: 18px; padding-bottom: 18px; }
                .pattern-preview { width: 70px; height: 70px; }
            }
        `;
        document.head.appendChild(style);
    }

    public updateStats(stats: Partial<GameStats>) {
        this.scoreEl.textContent = this.formatNumber(stats.score);
        this.lengthEl.textContent = this.formatNumber(stats.length);
        this.timeEl.textContent = stats.time === undefined ? '—' : this.formatTime(stats.time);
        this.distanceEl.textContent = stats.distance === undefined ? '—' : this.formatNumber(Math.round(stats.distance));
        this.speedEl.textContent = this.formatNumber(stats.avgSpeed);

        this.foodGreenEl.textContent = this.formatNumber(stats.foodCount?.green);
        this.foodBlueEl.textContent = this.formatNumber(stats.foodCount?.blue);
        this.foodPinkEl.textContent = this.formatNumber(stats.foodCount?.pink);
    }

    public setSelectedSnake(snake: PauseSnake, index: number, total: number) {
        const isSelf = snake.kind === 'self';
        this.selectedSnakeNameEl.textContent = isSelf ? `YOU · ${snake.name}` : snake.name;
        this.selectedSnakeMetaEl.textContent = `${isSelf ? 'YOUR SNAKE' : snake.kind.toUpperCase()} · ${index + 1}/${total} · A / D`;
        this.appearancePanel.classList.toggle('readonly', !isSelf);
        this.previewAppearance = { ...snake.appearance };
        if (isSelf) {
            this.seedInput.value = String(this.appearance.patternSeed);
            this.backgroundInput.value = this.appearance.backgroundColor;
            this.patternInput.value = this.appearance.patternColor;
        }
        this.drawPattern();
        this.updateStats(snake.stats);
    }

    private createColorInput(labelText: string, value: string): HTMLInputElement {
        const label = document.createElement('label');
        const text = document.createElement('span');
        text.textContent = labelText;
        const input = document.createElement('input');
        input.type = 'color';
        input.value = value;
        input.oninput = () => this.commitAppearance();
        label.append(text, input);
        return input;
    }

    private commitAppearance() {
        const parsedSeed = Number(this.seedInput.value);
        this.appearance = {
            patternSeed: Number.isInteger(parsedSeed) && parsedSeed >= 0 ? parsedSeed >>> 0 : 0,
            backgroundColor: this.backgroundInput.value,
            patternColor: this.patternInput.value,
        };
        this.previewAppearance = { ...this.appearance };
        this.seedInput.value = String(this.appearance.patternSeed);
        this.drawPattern();
        this.onAppearanceChange({ ...this.appearance });
    }

    private drawPattern() {
        const context = this.patternCanvas.getContext('2d');
        if (!context) return;
        const pattern = generateSnakePattern(this.previewAppearance.patternSeed);
        const cell = this.patternCanvas.width / pattern.length;
        pattern.forEach((row, y) => row.forEach((filled, x) => {
            context.fillStyle = filled ? this.previewAppearance.patternColor : this.previewAppearance.backgroundColor;
            context.fillRect(x * cell, y * cell, cell + 0.5, cell + 0.5);
        }));
    }

    public setAppearance(appearance: SnakeAppearance) {
        this.appearance = { ...appearance };
        this.previewAppearance = { ...appearance };
        this.seedInput.value = String(appearance.patternSeed);
        this.backgroundInput.value = appearance.backgroundColor;
        this.patternInput.value = appearance.patternColor;
        this.drawPattern();
    }

    public updateRoom(seed: number) {
        this.roomSeed = seed;
        this.roomEl.textContent = `You exist in room ${seed}`;
    }

    public setOrientationLocked(locked: boolean) {
        if (this.orientationLockInput) this.orientationLockInput.checked = locked;
    }

    private isMobileDevice(): boolean {
        return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) ||
            (navigator.maxTouchPoints > 1 && window.matchMedia('(pointer: coarse)').matches);
    }

    private async copyRoomLink() {
        if (this.roomSeed === null) return;
        const url = new URL(window.location.href);
        url.search = `?room=${this.roomSeed}`;
        try {
            await navigator.clipboard.writeText(url.toString());
            this.roomEl.textContent = 'Invitation link copied';
        } catch {
            this.roomEl.textContent = 'Could not copy invitation link';
        }
        window.setTimeout(() => { if (this.roomSeed !== null) this.roomEl.textContent = `You exist in room ${this.roomSeed}`; }, 1800);
    }

    private formatTime(seconds: number): string {
        const m = Math.floor(seconds / 60);
        const s = Math.floor(seconds % 60);
        return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }

    private formatNumber(value: number | undefined): string {
        return value === undefined ? '—' : Math.round(value).toString();
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
import { generateSnakePattern, randomizeSnakeColors, type SnakeAppearance } from '../../shared/appearance';
