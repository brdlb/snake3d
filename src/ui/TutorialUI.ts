export class TutorialUI {
  private readonly container: HTMLDivElement;
  private readonly message: HTMLParagraphElement;
  private readonly action: HTMLButtonElement;
  private onConfirm: (() => void) | null = null;

  public constructor() {
    this.container = document.createElement('div');
    this.container.className = 'tutorial-overlay active';
    this.container.innerHTML = '<div class="tutorial-card"><h2>TUTORIAL</h2><p></p><div class="tutorial-hint"></div><button type="button">CONTINUE</button></div>';
    this.message = this.container.querySelector('p')!;
    this.action = this.container.querySelector('button')!;
    this.action.addEventListener('click', () => this.onConfirm?.());
    document.body.appendChild(this.container);
  }

  public show(message: string, hint = '', onConfirm: (() => void) | null = null): void {
    this.message.textContent = message;
    this.container.querySelector('.tutorial-hint')!.textContent = hint;
    this.onConfirm = onConfirm;
    this.action.hidden = onConfirm === null;
    this.container.classList.add('active');
  }

  public hide(): void { this.container.classList.remove('active'); }
  public dispose(): void { this.container.remove(); }
}
