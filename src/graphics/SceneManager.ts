import * as THREE from 'three';
import { WallMaterial } from './WallMaterial';

export class SceneManager {
    public renderer: THREE.WebGLRenderer;
    public scene: THREE.Scene;
    public camera: THREE.PerspectiveCamera;
    public audioListener: THREE.AudioListener | null = null;

    private ambientLight: THREE.AmbientLight;
    private directionalLight: THREE.DirectionalLight;
    private wallMesh: THREE.Mesh | undefined;

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
        // Add 1 to size so walls visually contain segments at positions 0 and size
        const wallSize = size + 1;
        const boundaryGeo = new THREE.BoxGeometry(wallSize, wallSize, wallSize);
        this.wallMesh = new THREE.Mesh(boundaryGeo, WallMaterial);
        // Position so that the playable area spans from 0 to size
        this.wallMesh.position.set(size / 2, size / 2, size / 2);
        this.scene.add(this.wallMesh);
    }

    public onWindowResize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }

    public dispose() {
        window.removeEventListener('resize', this.onWindowResize.bind(this));
        this.renderer.dispose();
        if (this.wallMesh) this.wallMesh.geometry.dispose();
    }
}
