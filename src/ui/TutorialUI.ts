import { generateSnakePattern, randomizeSnakeColors, type SnakeAppearance } from '../../shared/appearance';

export class TutorialUI {
  private readonly container: HTMLDivElement;
  private readonly message: HTMLParagraphElement;
  private readonly action: HTMLButtonElement;
  private readonly editor: HTMLDivElement;
  private onConfirm: (() => void) | null = null;

  public constructor() {
    this.container = document.createElement('div');
    this.container.className = 'tutorial-overlay active';
    this.container.innerHTML = '<div class="tutorial-card"><p></p><div class="tutorial-editor" hidden></div><div class="tutorial-hint"></div><button type="button">CONTINUE</button><button class="tutorial-skip" type="button" hidden>SKIP TUTORIAL</button></div>';
    this.message = this.container.querySelector('p')!;
    this.editor = this.container.querySelector('.tutorial-editor')!;
    this.action = this.container.querySelector('button:not(.tutorial-skip)')!;
    this.action.addEventListener('click', () => this.onConfirm?.());
    document.body.appendChild(this.container);
  }

  public show(message: string, hint = '', onConfirm: (() => void) | null = null): void {
    this.container.classList.remove('introduction');
    this.editor.hidden = true;
    this.action.textContent = 'CONTINUE';
    this.message.textContent = message.toUpperCase();
    this.container.querySelector('.tutorial-hint')!.textContent = hint.toUpperCase();
    this.onConfirm = onConfirm;
    this.action.hidden = onConfirm === null;
    (this.container.querySelector('.tutorial-skip') as HTMLButtonElement).hidden = true;
    this.container.classList.add('active');
  }

  public showIntroduction(appearance: SnakeAppearance, onChange: (appearance: SnakeAppearance) => void, onConfirm: () => void, onSkip: () => void): void {
    this.show('Hello! First, choose your pattern.', '', onConfirm);
    this.container.classList.add('introduction');
    this.editor.replaceChildren();
    this.editor.hidden = false;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 112;
    canvas.className = 'pattern-preview';
    canvas.setAttribute('aria-label', 'Your snake pattern preview');
    const seed = document.createElement('input');
    seed.type = 'number';
    seed.min = '0';
    seed.max = '4294967295';
    seed.value = String(appearance.patternSeed);
    const random = document.createElement('button');
    random.type = 'button';
    random.textContent = 'RANDOM';
    const background = document.createElement('input');
    background.type = 'color';
    background.value = appearance.backgroundColor;
    const ornament = document.createElement('input');
    ornament.type = 'color';
    ornament.value = appearance.patternColor;
    const label = (title: string, input: HTMLElement) => {
      const element = document.createElement('label');
      const text = document.createElement('span');
      text.textContent = title;
      element.append(text, input);
      return element;
    };
    const commit = () => {
      const parsed = Number(seed.value);
      appearance = {
        patternSeed: Number.isInteger(parsed) && parsed >= 0 ? parsed >>> 0 : 0,
        backgroundColor: background.value,
        patternColor: ornament.value,
      };
      seed.value = String(appearance.patternSeed);
      draw();
      onChange(appearance);
    };
    const draw = () => {
      const context = canvas.getContext('2d');
      if (!context) return;
      const pattern = generateSnakePattern(appearance.patternSeed);
      const cell = canvas.width / pattern.length;
      pattern.forEach((row, y) => row.forEach((filled, x) => {
        context.fillStyle = filled ? appearance.patternColor : appearance.backgroundColor;
        context.fillRect(x * cell, y * cell, cell + 0.5, cell + 0.5);
      }));
    };
    seed.addEventListener('change', commit);
    random.addEventListener('click', () => {
      seed.value = String(crypto.getRandomValues(new Uint32Array(1))[0]);
      const colors = randomizeSnakeColors();
      background.value = colors.backgroundColor;
      ornament.value = colors.patternColor;
      commit();
    });
    background.addEventListener('input', commit);
    ornament.addEventListener('input', commit);
    this.editor.append(canvas, label('SEED', seed), random, label('BACKGROUND', background), label('ORNAMENT', ornament));
    draw();
    this.action.textContent = 'I\'M HAPPY';
    const skip = this.container.querySelector('.tutorial-skip') as HTMLButtonElement;
    skip.hidden = false;
    skip.onclick = onSkip;
  }

  public hide(): void { this.container.classList.remove('active'); }
  public dispose(): void { this.container.remove(); }
}
