import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { BloomConfig } from '../core/SettingsManager';

export class PostProcessManager {
    private composer: EffectComposer;
    private bloomPass: UnrealBloomPass;

    constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, config: BloomConfig) {
        this.composer = new EffectComposer(renderer);

        const renderPass = new RenderPass(scene, camera);
        this.composer.addPass(renderPass);

        this.bloomPass = new UnrealBloomPass(
            new THREE.Vector2(window.innerWidth, window.innerHeight),
            config.strength,
            config.radius,
            config.threshold
        );
        this.composer.addPass(this.bloomPass);

        const outputPass = new OutputPass();
        this.composer.addPass(outputPass);
    }

    public updateBloomConfig(config: BloomConfig) {
        this.bloomPass.strength = config.strength;
        this.bloomPass.radius = config.radius;
        this.bloomPass.threshold = config.threshold;
    }

    public setSize(width: number, height: number) {
        this.composer.setSize(width, height);
    }

    public render() {
        this.composer.render();
    }
}
