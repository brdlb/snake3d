import { generateSnakePattern, type SnakeAppearance } from '../../shared/appearance';

/**
 * Информация об игроке для отображения в HUD
 */
export interface PlayerInfo {
    name: string;
    score: number;
    length: number;
    speed: number;
    isPlayer?: boolean; // true для текущего игрока
    color?: string;     // цвет игрока (hex)
    appearance?: SnakeAppearance;
    isPhantom?: boolean;
    isDead?: boolean;   // жив или мертв
}

export class GameHUD {
    private container!: HTMLElement;
    private playersContainer!: HTMLElement;

    constructor() {
        this.createUI();
    }

    private createUI() {
        this.container = document.createElement('div');
        this.container.className = 'hud-panel frame-cross-tl';

        this.playersContainer = document.createElement('div');
        this.playersContainer.className = 'hud-players';

        this.container.appendChild(this.playersContainer);
        document.body.appendChild(this.container);
    }

    /**
     * Обновить HUD с данными обо всех игроках
     * @param players - массив информации о всех игроках (включая текущего)
     */
    public updatePlayers(players: PlayerInfo[]) {
        this.playersContainer.innerHTML = '';

        for (const player of players) {
            const row = document.createElement('div');
            row.className = 'hud-player-row';
            if (player.isPlayer) {
                row.classList.add('hud-player-current');
            }
            if (player.isDead) {
                row.classList.add('hud-player-dead');
            }

            const preview = document.createElement('canvas');
            preview.className = 'hud-player-pattern';
            preview.width = 70;
            preview.height = 70;
            preview.setAttribute('aria-hidden', 'true');
            if (player.appearance) {
                const context = preview.getContext('2d');
                if (context) {
                    const pattern = generateSnakePattern(player.appearance.patternSeed);
                    const cell = preview.width / pattern.length;
                    pattern.forEach((patternRow, y) => patternRow.forEach((filled, x) => {
                        context.fillStyle = filled ? player.appearance!.patternColor : player.appearance!.backgroundColor;
                        context.fillRect(x * cell, y * cell, cell, cell);
                    }));
                }
            }
            row.appendChild(preview);

            const details = document.createElement('div');
            details.className = 'hud-player-details';

            // Header: status + name
            const header = document.createElement('div');
            header.className = 'hud-player-header';

            const statusDot = document.createElement('span');
            statusDot.className = 'hud-player-status';

            statusDot.classList.add(player.isPhantom ? 'hud-player-status-phantom' : 'hud-player-status-online');

            const nameEl = document.createElement('span');
            nameEl.className = 'hud-player-name';
            nameEl.textContent = player.name;

            header.appendChild(statusDot);
            header.appendChild(nameEl);
            details.appendChild(header);

            // Stats Row: Score, Length, Speed
            const statsRow = document.createElement('div');
            statsRow.className = 'hud-player-stats-row';

            const createStat = (label: string, value: string | number) => {
                const statEl = document.createElement('div');
                statEl.className = 'hud-stat';

                const labelEl = document.createElement('span');
                labelEl.className = 'hud-stat-label';
                labelEl.textContent = label;

                const valueEl = document.createElement('span');
                valueEl.className = 'hud-stat-value';
                valueEl.textContent = value.toString();

                statEl.appendChild(labelEl);
                statEl.appendChild(valueEl);
                return statEl;
            };

            statsRow.appendChild(createStat('SCORE', player.score));
            statsRow.appendChild(createStat('LEN', player.length));
            statsRow.appendChild(createStat('SPD', Math.round(player.speed)));

            details.appendChild(statsRow);
            row.appendChild(details);
            this.playersContainer.appendChild(row);
        }
    }

    /**
     * Обратная совместимость - обновление только для текущего игрока
     */
    public update(score: number, length: number, speed: number) {
        this.updatePlayers([{
            name: 'You',
            score,
            length,
            speed,
            isPlayer: true,
            color: '#ffffff'
        }]);
    }

    public dispose() {
        this.container.remove();
        document.querySelector('.hud-pause-control')?.remove();
    }

    public addPauseButton(callback: () => void) {
        const control = document.createElement('div');
        control.className = 'hud-pause-control';
        const version = document.createElement('span');
        version.className = 'hud-version';
        control.appendChild(version);
        void this.loadVersion(version);

        const btn = document.createElement('button');
        btn.className = 'hud-pause-btn';
        btn.innerHTML = '||';
        btn.onclick = (e) => {
            e.stopPropagation(); // Prevent focus stealing issues if any
            callback();
        };

        control.appendChild(btn);
        document.body.appendChild(control);

        const style = document.createElement('style');
        style.textContent = `
            .hud-pause-btn {
                position: fixed;
                top: 20px;
                right: 20px;
                width: 44px;
                height: 44px;
                background: #000000;
                border: none;
                border-radius: 0;
                color: #fff;
                font-family: 'Consolas', monospace;
                font-weight: bold;
                font-size: 18px;
                cursor: pointer;
                z-index: 9999;
                display: flex;
                align-items: center;
                justify-content: center;
                transition: all 0.2s ease;
                box-shadow: 0 4px 12px rgba(0,0,0,0.2);
            }

            .hud-pause-btn:hover {
                background: #1a1a1a;
                transform: translateY(-2px);
                box-shadow: 0 6px 16px rgba(0,0,0,0.3);
            }

            .hud-pause-btn:active {
                background: #0f0f0f;
                transform: translateY(0);
            }
        `;
        document.head.appendChild(style);
    }
    public togglePauseButton(visible: boolean) {
        const control = document.querySelector('.hud-pause-control') as HTMLElement;
        if (control) {
            control.style.display = visible ? 'flex' : 'none';
        }
    }

    private async loadVersion(element: HTMLElement) {
        try {
            const response = await fetch('/api/v1/version', { cache: 'no-store' });
            if (!response.ok) return;
            const data: unknown = await response.json();
            if (typeof data === 'object' && data !== null && 'id' in data && typeof data.id === 'string') {
                element.textContent = `VERSION ID: ${data.id.toUpperCase()}`;
            }
        } catch {
            // The version is available only when served by the Cloudflare Worker.
        }
    }

    public setVisibility(visible: boolean) {
        this.container.style.display = visible ? 'block' : 'none';
    }
}
