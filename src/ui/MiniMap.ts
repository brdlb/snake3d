import * as THREE from 'three';

const MAP_SIZE = 204;
const PADDING = 12;

export class MiniMap {
  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;
  private readonly cameraRight = new THREE.Vector3();
  private readonly cameraForward = new THREE.Vector3();
  private readonly normal = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly top = new THREE.Vector3();
  private readonly relative = new THREE.Vector3();
  private readonly center = new THREE.Vector3();

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'mini-map';
    this.canvas.width = MAP_SIZE * 2;
    this.canvas.height = MAP_SIZE * 2;
    this.canvas.setAttribute('aria-label', 'Map of the current level');
    this.context = this.canvas.getContext('2d')!;
    this.context.scale(2, 2);
    document.body.appendChild(this.canvas);
  }

  setVisible(visible: boolean): void {
    this.canvas.style.display = visible ? 'block' : 'none';
  }

  draw(
    camera: THREE.Camera,
    head: THREE.Vector3,
    direction: THREE.Quaternion,
    size: number,
    food: readonly THREE.Vector3[],
    foodColors: readonly THREE.Color[],
    snakes: ReadonlyArray<{ segments: readonly THREE.Vector3[]; color: string }>,
  ): void {
    const ctx = this.context;
    ctx.clearRect(0, 0, MAP_SIZE, MAP_SIZE);

    // Pick the grid axis most closely aligned with the camera's up direction.
    // Only the one-cell layer containing the head is shown.
    camera.getWorldDirection(this.cameraForward);
    this.normal.copy(camera.up).normalize();
    const ax = Math.abs(this.normal.x);
    const ay = Math.abs(this.normal.y);
    const az = Math.abs(this.normal.z);
    if (ax >= ay && ax >= az) this.normal.set(Math.sign(this.normal.x), 0, 0);
    else if (ay >= az) this.normal.set(0, Math.sign(this.normal.y), 0);
    else this.normal.set(0, 0, Math.sign(this.normal.z));

    this.cameraRight.crossVectors(this.cameraForward, camera.up).normalize();
    this.right.copy(this.cameraRight).addScaledVector(this.normal, -this.cameraRight.dot(this.normal));
    if (this.right.lengthSq() < 0.001) {
      this.right.crossVectors(this.cameraForward, this.normal);
    }
    this.right.normalize();
    this.top.crossVectors(this.normal, this.right).normalize();
    this.center.set(size / 2, size / 2, size / 2);

    // A rotating square needs diagonal clearance to keep every world edge visible.
    const scale = (MAP_SIZE - PADDING * 2) / ((size + 1) * Math.SQRT2);
    const project = (position: THREE.Vector3): [number, number] => {
      this.relative.copy(position).sub(this.center);
      return [MAP_SIZE / 2 + this.relative.dot(this.right) * scale,
        MAP_SIZE / 2 - this.relative.dot(this.top) * scale];
    };
    const inLayer = (position: THREE.Vector3) => Math.abs(position.dot(this.normal) - head.dot(this.normal)) < 0.5;

    ctx.fillStyle = 'rgba(8, 15, 24, 0.55)';
    ctx.fillRect(0, 0, MAP_SIZE, MAP_SIZE);

    // The outline is the intersection of the world cube with the current layer.
    // Project the actual slice corners, so the outline remains tied to world axes.
    const axis = this.normal.x !== 0 ? 'x' : this.normal.y !== 0 ? 'y' : 'z';
    const axes = (['x', 'y', 'z'] as const).filter((name) => name !== axis);
    const boundary = [[0, 0], [size, 0], [size, size], [0, size]];
    ctx.beginPath();
    boundary.forEach(([a, b], index) => {
      const point = head.clone();
      point[axes[0]] = a;
      point[axes[1]] = b;
      const [px, py] = project(point);
      if (index === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.closePath();
    ctx.fillStyle = 'rgba(35, 58, 68, 0.25)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(180, 218, 230, 0.55)';
    ctx.lineWidth = 1;
    ctx.stroke();

    for (let i = 0; i < food.length; i++) {
      if (!inLayer(food[i])) continue;
      const [px, py] = project(food[i]);
      ctx.fillStyle = `#${foodColors[i]?.getHexString() ?? 'ffffff'}`;
      ctx.globalAlpha = 0.85;
      ctx.fillRect(px - 2, py - 2, 4, 4);
    }

    for (const snake of snakes) {
      ctx.fillStyle = snake.color;
      ctx.globalAlpha = 0.75;
      for (const segment of snake.segments) {
        if (!inLayer(segment)) continue;
        const [px, py] = project(segment);
        ctx.fillRect(px - 2, py - 2, 4, 4);
      }
    }
    ctx.globalAlpha = 1;

    const [hx, hy] = project(head);
    const forward = this.cameraForward.set(0, 0, -1).applyQuaternion(direction);
    const dx = forward.dot(this.right);
    const dy = -forward.dot(this.top);
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#071017';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    if (Math.abs(dx) + Math.abs(dy) < 0.1) {
      ctx.arc(hx, hy, 4, 0, Math.PI * 2);
    } else {
      ctx.moveTo(hx + dx * 7, hy + dy * 7);
      ctx.lineTo(hx - dx * 4 - dy * 4, hy - dy * 4 + dx * 4);
      ctx.lineTo(hx - dx * 4 + dy * 4, hy - dy * 4 - dx * 4);
      ctx.closePath();
    }
    ctx.fill();
    ctx.stroke();
  }

  dispose(): void {
    this.canvas.remove();
  }
}
