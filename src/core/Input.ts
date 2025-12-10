type KeyAction = 'left' | 'right' | 'rollLeft' | 'rollRight' | 'boost';

export class InputManager {
    private keys: Map<string, boolean> = new Map();
    private bindings: Record<string, KeyAction> = {
        'KeyA': 'left',
        'KeyD': 'right',
        'KeyQ': 'rollLeft',
        'KeyE': 'rollRight',
        'Space': 'boost'
    };

    private actionCallbacks: Map<KeyAction, Set<() => void>> = new Map();

    private touchStartX: number = 0;
    private touchStartY: number = 0;

    // Mouse Input
    public isLeftMouseDown: boolean = false;
    public mouseDeltaX: number = 0;
    public mouseDeltaY: number = 0;
    private lastMouseX: number = 0;
    private lastMouseY: number = 0;

    private boundOnKeyDown = this.onKeyDown.bind(this);
    private boundOnKeyUp = this.onKeyUp.bind(this);
    private boundOnTouchStart = this.onTouchStart.bind(this);
    private boundOnTouchEnd = this.onTouchEnd.bind(this);
    private boundOnMouseDown = this.onMouseDown.bind(this);
    private boundOnMouseUp = this.onMouseUp.bind(this);
    private boundOnMouseMove = this.onMouseMove.bind(this);

    constructor() {
        this.setupListeners();
    }

    private setupListeners(): void {
        window.addEventListener('keydown', this.boundOnKeyDown);
        window.addEventListener('keyup', this.boundOnKeyUp);

        window.addEventListener('mousedown', this.boundOnMouseDown);
        window.addEventListener('mouseup', this.boundOnMouseUp);
        window.addEventListener('mousemove', this.boundOnMouseMove);

        // Touch events
        window.addEventListener('touchstart', this.boundOnTouchStart, { passive: false });
        window.addEventListener('touchend', this.boundOnTouchEnd, { passive: false });
    }

    private onKeyDown(event: KeyboardEvent): void {
        this.keys.set(event.code, true);

        const action = this.bindings[event.code];
        if (action) {
            this.triggerAction(action);
        }
    }

    private onKeyUp(event: KeyboardEvent): void {
        this.keys.set(event.code, false);
    }

    private onMouseDown(event: MouseEvent): void {
        if (event.button === 0) { // Left Button
            this.isLeftMouseDown = true;
            this.lastMouseX = event.clientX;
            this.lastMouseY = event.clientY;
            this.mouseDeltaX = 0;
            this.mouseDeltaY = 0;
        }
    }

    private onMouseUp(event: MouseEvent): void {
        if (event.button === 0) {
            this.isLeftMouseDown = false;
            this.mouseDeltaX = 0;
            this.mouseDeltaY = 0;
        }
    }

    private onMouseMove(event: MouseEvent): void {
        if (this.isLeftMouseDown) {
            this.mouseDeltaX = event.clientX - this.lastMouseX;
            this.mouseDeltaY = event.clientY - this.lastMouseY;
            this.lastMouseX = event.clientX;
            this.lastMouseY = event.clientY;
        }
    }

    public getAndResetMouseDelta(): { x: number, y: number } {
        const delta = { x: this.mouseDeltaX, y: this.mouseDeltaY };
        this.mouseDeltaX = 0;
        this.mouseDeltaY = 0;
        return delta;
    }

    private onTouchStart(event: TouchEvent): void {
        if (event.touches.length > 0) {
            this.touchStartX = event.touches[0].clientX;
            this.touchStartY = event.touches[0].clientY;
        }
    }

    private onTouchEnd(event: TouchEvent): void {
        if (event.changedTouches.length > 0) {
            const touchEndX = event.changedTouches[0].clientX;
            const touchEndY = event.changedTouches[0].clientY;

            this.handleSwipe(this.touchStartX, this.touchStartY, touchEndX, touchEndY);
        }
    }

    private handleSwipe(startX: number, startY: number, endX: number, endY: number): void {
        const dx = endX - startX;
        const dy = endY - startY;
        const absDx = Math.abs(dx);
        const absDy = Math.abs(dy);
        const threshold = 30; // Min swipe distance

        if (Math.max(absDx, absDy) < threshold) return;

        if (absDx > absDy) {
            // Horizontal: Turn
            if (dx > 0) {
                this.triggerAction('right');
            } else {
                this.triggerAction('left');
            }
        } else {
            // Vertical: Roll
            const isLeftSide = startX < window.innerWidth / 2;

            if (isLeftSide) {
                // Left Side
                if (dy < 0) {
                    // Up -> Clockwise (Roll Right)
                    this.triggerAction('rollRight');
                } else {
                    // Down -> Counter-Clockwise (Roll Left)
                    this.triggerAction('rollLeft');
                }
            } else {
                // Right Side
                if (dy < 0) {
                    // Up -> Counter-Clockwise (Roll Left)
                    this.triggerAction('rollLeft');
                } else {
                    // Down -> Clockwise (Roll Right)
                    this.triggerAction('rollRight');
                }
            }
        }
    }

    public isActionPressed(action: KeyAction): boolean {
        // Find if any key bound to this action is pressed
        for (const [code, boundAction] of Object.entries(this.bindings)) {
            if (boundAction === action && this.keys.get(code)) {
                return true;
            }
        }
        return false;
    }

    public on(action: KeyAction, callback: () => void): void {
        if (!this.actionCallbacks.has(action)) {
            this.actionCallbacks.set(action, new Set());
        }
        this.actionCallbacks.get(action)!.add(callback);
    }

    public off(action: KeyAction, callback: () => void): void {
        const callbacks = this.actionCallbacks.get(action);
        if (callbacks) {
            callbacks.delete(callback);
        }
    }

    private triggerAction(action: KeyAction): void {
        const callbacks = this.actionCallbacks.get(action);
        if (callbacks) {
            callbacks.forEach(cb => cb());
        }
    }

    public destroy(): void {
        window.removeEventListener('keydown', this.boundOnKeyDown);
        window.removeEventListener('keyup', this.boundOnKeyUp);
        window.removeEventListener('touchstart', this.boundOnTouchStart);
        window.removeEventListener('touchend', this.boundOnTouchEnd);
        window.removeEventListener('mousedown', this.boundOnMouseDown);
        window.removeEventListener('mouseup', this.boundOnMouseUp);
        window.removeEventListener('mousemove', this.boundOnMouseMove);
        this.actionCallbacks.clear();
        this.keys.clear();
    }
}
