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
}

export class GameHUD {
    private container!: HTMLElement;
    private playersContainer!: HTMLElement;

    constructor() {
        this.createUI();
    }

    private createUI() {
        this.container = document.createElement('div');
        this.container.className = 'hud-panel';

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

            // Цветной индикатор
            const colorDot = document.createElement('span');
            colorDot.className = 'hud-player-color';
            colorDot.style.backgroundColor = player.color || '#ffffff';

            // Имя игрока
            const nameEl = document.createElement('span');
            nameEl.className = 'hud-player-name';
            nameEl.textContent = player.name;

            // Статистика
            const statsEl = document.createElement('span');
            statsEl.className = 'hud-player-stats';
            statsEl.textContent = `score:${player.score} length:${player.length} speed:${player.speed}`;

            row.appendChild(colorDot);
            row.appendChild(nameEl);
            row.appendChild(statsEl);
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
        const btn = document.querySelector('.hud-pause-btn');
        if (btn) btn.remove();
    }

    public addPauseButton(callback: () => void) {
        const btn = document.createElement('button');
        btn.className = 'hud-pause-btn';
        btn.innerHTML = '||';
        btn.onclick = (e) => {
            e.stopPropagation(); // Prevent focus stealing issues if any
            callback();
        };

        document.body.appendChild(btn);

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
        const btn = document.querySelector('.hud-pause-btn') as HTMLElement;
        if (btn) {
            btn.style.display = visible ? 'flex' : 'none';
        }
    }
}
