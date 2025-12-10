export class Loop {
    private isRunning: boolean = false;
    private animationId: number = 0;
    private lastTime: number = 0;
    private callbacks: Set<(delta: number) => void> = new Set();

    constructor() { }

    public start(): void {
        if (this.isRunning) return;

        this.isRunning = true;
        this.lastTime = performance.now();
        this.animate(this.lastTime);
    }

    public stop(): void {
        this.isRunning = false;
        cancelAnimationFrame(this.animationId);
    }

    public add(callback: (delta: number) => void): void {
        this.callbacks.add(callback);
    }

    public remove(callback: (delta: number) => void): void {
        this.callbacks.delete(callback);
    }

    private animate(currentTime: number): void {
        if (!this.isRunning) return;

        this.animationId = requestAnimationFrame(this.animate.bind(this));

        const delta = (currentTime - this.lastTime) / 1000;
        this.lastTime = currentTime;

        // Prevent huge deltas if frame drops (cap at 0.1s)
        const safeDelta = Math.min(delta, 0.1);

        this.callbacks.forEach(callback => callback(safeDelta));
    }
}
