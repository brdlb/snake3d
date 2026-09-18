import * as THREE from 'three';

export type TutorialPhase =
  | 'extension_intro'
  | 'turn_gate'
  | 'acceleration_intro'
  | 'slowdown_intro'
  | 'roll_gate'
  | 'expanding_world'
  | 'standard_game';

export type TutorialCollectibleEffect = 'growth' | 'acceleration' | 'slowdown' | 'roll';

export interface TutorialCollectible {
  position: THREE.Vector3;
  effect: TutorialCollectibleEffect;
}

export interface TutorialLayout {
  spawn: THREE.Vector3;
  direction: THREE.Vector3;
  up: THREE.Vector3;
  requiredTurn: 'left' | 'right';
  collectibles: TutorialCollectible[];
}

/** Pure layout/state helper. Gameplay and rendering stay in Game. */
export class TutorialSession {
  public phase: TutorialPhase = 'extension_intro';
  private readonly layout: TutorialLayout;

  public constructor(
    spawn: THREE.Vector3,
    direction: THREE.Vector3,
    up: THREE.Vector3,
    random: () => number = Math.random,
  ) {
    const forward = direction.clone().normalize();
    const side = new THREE.Vector3().crossVectors(up, forward).normalize();
    const left = forward.clone().applyAxisAngle(up, Math.PI / 2);
    const requiredTurn = left.distanceToSquared(side) < 0.1 ? 'left' : 'right';
    const growth = spawn.clone().addScaledVector(forward, 5);
    const turnTarget = growth.clone().addScaledVector(forward, 3).addScaledVector(side, 2);
    const effects: TutorialCollectibleEffect[] = ['acceleration', 'slowdown', 'roll'];
    const effect = effects[Math.floor(random() * effects.length)];
    this.layout = {
      spawn: spawn.clone(),
      direction: forward,
      up: up.clone().normalize(),
      requiredTurn,
      collectibles: [
        { position: growth, effect: 'growth' },
        { position: turnTarget, effect: 'growth' },
        { position: spawn.clone().addScaledVector(up, 2).addScaledVector(forward, 2), effect: 'acceleration' },
        { position: spawn.clone().addScaledVector(up, 2).addScaledVector(forward, 4), effect: 'slowdown' },
        { position: spawn.clone().addScaledVector(up, 3).addScaledVector(forward, 2), effect },
      ],
    };
  }

  public getLayout(): TutorialLayout {
    return {
      ...this.layout,
      spawn: this.layout.spawn.clone(),
      direction: this.layout.direction.clone(),
      up: this.layout.up.clone(),
      requiredTurn: this.layout.requiredTurn,
      collectibles: this.layout.collectibles.map((item) => ({ ...item, position: item.position.clone() })),
    };
  }

  public collect(effect: TutorialCollectibleEffect): TutorialPhase {
    if (this.phase === 'extension_intro' && effect === 'growth') this.phase = 'turn_gate';
    else if (this.phase === 'turn_gate' && effect === 'growth') this.phase = 'acceleration_intro';
    else if (this.phase === 'acceleration_intro' && effect === 'acceleration') this.phase = 'slowdown_intro';
    else if (this.phase === 'slowdown_intro' && effect === 'slowdown') this.phase = 'roll_gate';
    return this.phase;
  }

  public confirm(): TutorialPhase {
    if (this.phase === 'extension_intro') this.phase = 'turn_gate';
    return this.phase;
  }

  public acceptRoll(): TutorialPhase {
    if (this.phase === 'roll_gate') this.phase = 'expanding_world';
    return this.phase;
  }

  public completeExpansion(): TutorialPhase {
    this.phase = 'standard_game';
    return this.phase;
  }
}
