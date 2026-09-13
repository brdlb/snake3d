import type { SimPlayer } from '../../shared/simulation';

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
