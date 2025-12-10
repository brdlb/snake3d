export class GameHUD {
    private container!: HTMLElement;
    private scoreEl!: HTMLElement;
    private lengthEl!: HTMLElement;
    private speedEl!: HTMLElement;

    constructor() {
        this.createUI();
    }

    private createUI() {
        this.container = document.createElement('div');
        this.container.className = 'hud-panel';

        this.scoreEl = this.createStatItem('Score', '0');
        this.lengthEl = this.createStatItem('Length', '3');
        this.speedEl = this.createStatItem('Speed', '0');

        document.body.appendChild(this.container);
    }

    private createStatItem(label: string, initialValue: string): HTMLElement {
        const item = document.createElement('div');
        item.className = 'hud-item';

        const labelEl = document.createElement('span');
        labelEl.className = 'hud-label';
        labelEl.textContent = label;

        const valueEl = document.createElement('span');
        valueEl.className = 'hud-value';
        valueEl.textContent = initialValue;

        item.appendChild(labelEl);
        item.appendChild(valueEl);
        this.container.appendChild(item);

        return valueEl;
    }

    public update(score: number, length: number, speed: number) {
        this.scoreEl.textContent = score.toString();
        this.lengthEl.textContent = length.toString();
        this.speedEl.textContent = speed.toString();
    }

    public dispose() {
        this.container.remove();
    }
}
