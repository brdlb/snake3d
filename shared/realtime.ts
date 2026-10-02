import type { Axis, Food, SimPlayer } from './simulation';
import type { SnakeAppearance } from './appearance';
import type { AdventureState, RoomDefinition } from './adventure';

export type SnakeState = {
  segments: Axis[];
  direction: Axis;
  up: Axis;
  score: number;
  speed: number;
  growth?: number;
  adventure?: AdventureState;
};

export type DirectionInput = {
  type: 'direction';
  seq: number;
  step: number;
  head: Axis;
  segments: Axis[];
  direction: Axis;
  up: Axis;
};

export type StateInput = SnakeState & {
  type: 'state';
  seq: number;
  step: number;
  reason: 'food' | 'speed' | 'reconnect' | 'spawn' | 'spectator-sync';
  eatenFood?: Axis;
};

export type PauseInput = SnakeState & {
  type: 'pause';
  seq: number;
  step: number;
  paused: boolean;
};

export type DeathInput = SnakeState & {
  type: 'death';
  submissionId: string;
  seq: number;
  step: number;
  reason: string;
};

export type RoomSnapshot = {
  seed: number;
  tick: number;
  serverTime: number;
  food: Food[];
  players: SimPlayer[];
  definition?: RoomDefinition;
};

export type PlayerDirectionChanged = Omit<DirectionInput, 'type'> & {
  entityId: string;
  speed: number;
  serverTime: number;
};

export type PlayerStateChanged = SnakeState & {
  entityId: string;
  seq: number;
  step: number;
  reason: StateInput['reason'];
  eatenFood?: Axis;
  serverTime: number;
};

export type PlayerPauseChanged = Omit<PauseInput, 'type'> & {
  entityId: string;
  serverTime: number;
};

export type PlayerDied = {
  player: SimPlayer;
  position: Axis;
  reason: string;
  serverTime: number;
};

export type RealtimeClientMessage =
  | { v: 3; type: 'adventure.step'; payload: { action: SnakeState & { step: number } } }
  | { v: 2; type: 'ping' | 'room.resync' }
  | { v: 2; type: 'player.appearance'; payload: { appearance: SnakeAppearance } }
  | { v: 2; type: 'player.directionChanged'; payload: { action: DirectionInput } }
  | { v: 2; type: 'player.pauseChanged'; payload: { action: PauseInput } }
  | { v: 2; type: 'player.state'; payload: { action: StateInput } }
  | { v: 2; type: 'player.died'; payload: { action: DeathInput } };

export type RealtimeServerMessage =
  | { v: 3; type: 'adventure.state'; payload: { entityId: string; step: number; state: SnakeState } }
  | { v: 2; type: 'pong' }
  | { v: 2; type: 'room.state'; payload: RoomSnapshot }
  | { v: 2; type: 'room.syncRequested'; payload: { requestId: string } }
  | { v: 2; type: 'player.directionChanged'; payload: PlayerDirectionChanged }
  | { v: 2; type: 'player.pauseChanged'; payload: PlayerPauseChanged }
  | { v: 2; type: 'player.state'; payload: PlayerStateChanged }
  | { v: 2; type: 'player.appearance'; payload: { entityId: string; appearance: SnakeAppearance } }
  | { v: 2; type: 'player.died'; payload: PlayerDied }
  | { v: 2; type: 'room.left'; payload: { entityId: string; userId: string } }
  | { v: 2; type: 'player.joined'; payload: unknown }
  | { v: 2; type: 'food.changed'; payload: unknown }
  | { v: 2; type: 'game.saved'; payload: unknown }
  | { v: 2; type: 'game.saveStarted'; payload: { submissionId: string; stage: string } }
  | { v: 2; type: 'game.saveFailed'; payload: { submissionId: string; code: string; retryable: boolean } }
  | { v: 2; type: 'error'; payload: { code: string } }
  | { v: 2; type: 'presence.updated'; payload: { count: number } };

export function isRealtimeServerMessage(value: unknown): value is RealtimeServerMessage {
  if (!value || typeof value !== 'object') return false;
  const message = value as { v?: unknown; type?: unknown };
  return (message.v === 2 || message.v === 3) && typeof message.type === 'string';
}
