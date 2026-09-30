import * as THREE from 'three';
import { WallMaterial } from './WallMaterial';
import { PORTAL_APERTURE } from '../../shared/roomCoordinates';

export class SceneManager {
    public renderer: THREE.WebGLRenderer;
    public scene: THREE.Scene;
    public camera: THREE.PerspectiveCamera;
    public audioListener: THREE.AudioListener | null = null;

    private ambientLight: THREE.AmbientLight;
    private directionalLight: THREE.DirectionalLight;
    private wallMesh: THREE.Group | undefined;
    private previousWallMeshes = new Set<THREE.Group>();
    private portalGates: THREE.Object3D[] = [];
    private portalLabelTexture: THREE.CanvasTexture | undefined;

    constructor(fov: number) {
        // Renderer
        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.shadowMap.enabled = true;
        document.querySelector('#app')!.appendChild(this.renderer.domElement);

        // Scene
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x101010);

        // Camera
        this.camera = new THREE.PerspectiveCamera(
            fov,
            window.innerWidth / window.innerHeight,
            0.01,
            10000
        );
        this.camera.position.set(0, 10, 10);

        // Audio Listener is created lazily via initAudioListener()
        // to comply with iOS Safari audio restrictions

        // Lighting
        this.ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
        this.scene.add(this.ambientLight);

        this.directionalLight = new THREE.DirectionalLight(0xffffff, 1);
        this.directionalLight.position.set(45, 55, 45); // Positioned for world center around (25,25,25)
        this.directionalLight.castShadow = true;
        this.directionalLight.shadow.mapSize.width = 2048;
        this.directionalLight.shadow.mapSize.height = 2048;
        this.directionalLight.shadow.camera.near = 0.1;
        this.directionalLight.shadow.camera.far = 150;
        this.directionalLight.shadow.camera.left = -60;
        this.directionalLight.shadow.camera.right = 60;
        this.directionalLight.shadow.camera.top = 60;
        this.directionalLight.shadow.camera.bottom = -60;
        this.scene.add(this.directionalLight);

        window.addEventListener('resize', this.onWindowResize.bind(this));
    }

    /**
     * Initialize AudioListener - MUST be called from a user gesture event handler
     * to work properly on iOS Safari
     */
    public initAudioListener(): THREE.AudioListener {
        if (!this.audioListener) {
            this.audioListener = new THREE.AudioListener();
            this.camera.add(this.audioListener);
            console.log('AudioListener created');
        }
        return this.audioListener;
    }

    public setupWalls(size: number) {
        if (this.wallMesh) this.scene.remove(this.wallMesh);
        const wallSize = size + 1;
        const aperture = PORTAL_APERTURE;
        const strip = (wallSize - aperture) / 2;
        const center = (wallSize + aperture) / 4;
        this.wallMesh = new THREE.Group();
        this.portalGates = [];
        const labelCanvas = document.createElement('canvas');
        labelCanvas.width = 1536;
        labelCanvas.height = 256;
        const context = labelCanvas.getContext('2d');
        const labelTexture = new THREE.CanvasTexture(labelCanvas);
        const drawLabel = () => {
            if (!context) return;
            context.clearRect(0, 0, labelCanvas.width, labelCanvas.height);
            context.fillStyle = '#ffffff';
            const fontSize = Math.min(48, Math.max(28, window.innerWidth * 0.045));
            const scale = 3;
            context.font = `300 ${fontSize * scale}px Jura, sans-serif`;
            context.textBaseline = 'middle';
            const spacing = fontSize * scale * 0.2;
            let x = 24;
            for (const character of 'LENGTH 100') {
                context.fillText(character, x, labelCanvas.height / 2);
                x += context.measureText(character).width + spacing;
            }
            labelTexture.needsUpdate = true;
        };
        this.portalLabelTexture = labelTexture;
        drawLabel();
        void document.fonts?.ready.then(drawLabel);
        const faces: Array<[THREE.Vector3, THREE.Euler]> = [
            [new THREE.Vector3(0, 0, wallSize / 2), new THREE.Euler()],
            [new THREE.Vector3(0, 0, -wallSize / 2), new THREE.Euler(0, Math.PI, 0)],
            [new THREE.Vector3(wallSize / 2, 0, 0), new THREE.Euler(0, Math.PI / 2, 0)],
            [new THREE.Vector3(-wallSize / 2, 0, 0), new THREE.Euler(0, -Math.PI / 2, 0)],
            [new THREE.Vector3(0, wallSize / 2, 0), new THREE.Euler(-Math.PI / 2, 0, 0)],
            [new THREE.Vector3(0, -wallSize / 2, 0), new THREE.Euler(Math.PI / 2, 0, 0)],
        ];
        for (const [position, rotation] of faces) {
            const face = new THREE.Group();
            face.position.copy(position);
            face.rotation.copy(rotation);
            const addStrip = (width: number, height: number, x: number, y: number) => {
                const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), WallMaterial);
                mesh.position.set(x, y, 0);
                face.add(mesh);
            };
            addStrip(wallSize, strip, 0, center);
            addStrip(wallSize, strip, 0, -center);
            addStrip(strip, aperture, center, 0);
            addStrip(strip, aperture, -center, 0);
            const gate = new THREE.Mesh(
                new THREE.PlaneGeometry(aperture, aperture),
                new THREE.MeshBasicMaterial({ color: 0x24c9ec, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false }),
            );
            face.add(gate);
            this.portalGates.push(gate);
            const labelWidth = aperture;
            const labelHeight = 0.5;
            const labelEdge = aperture / 2 + labelHeight / 2;
            const labelGeometry = new THREE.PlaneGeometry(labelWidth, labelHeight);
            const labelMaterial = new THREE.MeshBasicMaterial({ map: this.portalLabelTexture, transparent: true, depthWrite: false, toneMapped: false });
            // Put one label along every edge of the opening, on both sides of the wall.
            for (const side of [1, -1]) {
                const labelSide = new THREE.Group();
                labelSide.position.z = side * 0.04;
                if (side < 0) labelSide.rotation.y = Math.PI;
                for (const [x, y, angle] of [
                    [-aperture / 2 + labelWidth / 2, labelEdge, 0],
                    [aperture / 2 - labelWidth / 2, -labelEdge, Math.PI],
                    [-labelEdge, -aperture / 2 + labelWidth / 2, Math.PI / 2],
                    [labelEdge, aperture / 2 - labelWidth / 2, -Math.PI / 2],
                ]) {
                    const label = new THREE.Mesh(labelGeometry, labelMaterial);
                    label.position.set(x, y, 0);
                    label.rotation.z = angle;
                    labelSide.add(label);
                }
                face.add(labelSide);
            }
            this.wallMesh.add(face);
        }
        this.wallMesh.position.set(size / 2, size / 2, size / 2);
        this.scene.add(this.wallMesh);
    }

    public setPortalOpen(open: boolean): void {
        for (const gate of this.portalGates) gate.visible = !open;
    }

    public shiftPreviousRooms(offset: THREE.Vector3): void {
        for (const room of this.previousWallMeshes) room.position.sub(offset);
    }

    public showPreviousRoom(offset: THREE.Vector3): THREE.Group | null {
        if (!this.wallMesh) return null;
        const previous = this.wallMesh.clone(true);
        previous.position.copy(this.wallMesh.position).sub(offset);
        this.previousWallMeshes.add(previous);
        this.scene.add(previous);
        return previous;
    }

    public removePreviousRoom(room: THREE.Group): void {
        this.scene.remove(room);
        this.previousWallMeshes.delete(room);
    }

    public clearPreviousRooms(): void {
        for (const room of this.previousWallMeshes) this.scene.remove(room);
        this.previousWallMeshes.clear();
    }

    public setWallsVisible(visible: boolean): void {
        if (this.wallMesh) this.wallMesh.visible = visible;
    }

    public onWindowResize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }

    public dispose() {
        window.removeEventListener('resize', this.onWindowResize.bind(this));
        this.renderer.dispose();
        this.clearPreviousRooms();
        if (this.wallMesh) {
            this.wallMesh.traverse((object) => {
                if (object instanceof THREE.Mesh) {
                    object.geometry.dispose();
                    if (object.material !== WallMaterial) object.material.dispose();
                }
            });
        }
        this.portalLabelTexture?.dispose();
    }
}
