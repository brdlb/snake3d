import type { SimPlayer } from '../../shared/simulation';
import type { PlayerDirectionChanged } from '../../shared/realtime';
import * as THREE from 'three';
import type { ReplayData } from '../types/replay';

export type LiveOpponentMotion = {
  alive: boolean;
  speed: number;
  segments: THREE.Vector3[];
  direction: THREE.Quaternion;
  directionVector: THREE.Vector3;
  up: THREE.Vector3;
  elapsed: number;
  serverTick: number;
  replay?: ReplayData;
  replayIndex: number;
};

export function advanceLiveOpponent(
  opponent: LiveOpponentMotion,
  seconds: number,
  orientation: (direction: THREE.Vector3, up: THREE.Vector3) => THREE.Quaternion,
): void {
  if (!opponent.alive || !opponent.segments.length) return;
  opponent.elapsed += seconds;
  const interval = 60 / Math.max(60, opponent.speed);
  while (opponent.elapsed >= interval) {
    opponent.elapsed -= interval;
    const nextTurn = opponent.replay?.trajectoryLog[opponent.replayIndex];
    if (
      nextTurn &&
      opponent.segments[0].x === nextTurn.position.x &&
      opponent.segments[0].y === nextTurn.position.y &&
      opponent.segments[0].z === nextTurn.position.z
    ) {
      opponent.directionVector
        .set(nextTurn.direction.x, nextTurn.direction.y, nextTurn.direction.z)
        .normalize();
      opponent.direction.copy(orientation(opponent.directionVector, opponent.up));
      opponent.replayIndex++;
    }
    const tail = opponent.segments.pop()!;
    opponent.segments.unshift(tail.copy(opponent.segments[0]).add(opponent.directionVector));
    opponent.serverTick++;
  }
}

export function applyLiveDirectionState(
  opponent: LiveOpponentMotion & { serverTime: number },
  change: PlayerDirectionChanged,
  orientation: (direction: THREE.Vector3, up: THREE.Vector3) => THREE.Quaternion,
): void {
  opponent.segments = change.segments.map(
    (position) => new THREE.Vector3(position.x, position.y, position.z),
  );
  opponent.directionVector
    .set(change.direction.x, change.direction.y, change.direction.z)
    .normalize();
  opponent.up.set(change.up.x, change.up.y, change.up.z).normalize();
  opponent.direction.copy(orientation(opponent.directionVector, opponent.up));
  opponent.speed = Math.max(60, change.speed);
  opponent.elapsed = 0;
  opponent.serverTick = change.step;
  opponent.serverTime = change.serverTime;
}

export function findLocalPlayer(
  players: SimPlayer[],
  localEntityId: string | null,
  userId?: string,
): SimPlayer | undefined {
  return (
    (localEntityId
      ? players.find((player) => player.entityId === localEntityId && player.id === userId)
      : undefined) ?? players.find((player) => player.id === userId && player.phantom !== true)
  );
}

export function isLiveOpponent(
  player: SimPlayer,
  localEntityId: string | null,
  userId?: string,
): boolean {
  return (
    Boolean(player.entityId) &&
    player.entityId !== localEntityId &&
    player.id !== userId &&
    player.phantom !== true
  );
}
