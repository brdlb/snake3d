/** Deterministic, renderer-free rules used by both the browser and the Room DO. */
export type Axis = { x: number; y: number; z: number };
export type FoodKind = 'green' | 'blue' | 'pink';
export type Food = Axis & { kind: FoodKind };
export type SimPlayer = { id: string; entityId: string; name: string; segments: Axis[]; direction: Axis; up: Axis; score: number; speed: number; growth: number; alive: boolean; phantom?: boolean; color: string; nextStepAt: number; instanceId?: string; disconnectedAt?: number; lastInputSeq?: number; lastStateSeq?: number };
export type SimulationState = { seed: number; tick: number; food: Food[]; players: Record<string, SimPlayer>; trajectories?: Record<string, Axis[]> };
export type DeathReason = 'bounds' | 'body' | 'head-to-head';
export type FoodChange = { removed: Food; added: Food; entityId?: string; score?: number; speed?: number; growth?: number; length?: number };
export type SimulationDelta = { changed: SimPlayer[]; food: FoodChange[]; deaths: Array<{ player: SimPlayer; position: Axis; reason: DeathReason }>; tick: number };
export const WORLD_SIZE = 50, FOOD_COUNT = 200, BASE_SPEED = 300;
const directions: Axis[] = [{x:1,y:0,z:0},{x:-1,y:0,z:0},{x:0,y:1,z:0},{x:0,y:-1,z:0},{x:0,y:0,z:1},{x:0,y:0,z:-1}];
const spawnPoints: Array<{position:Axis;direction:Axis}> = [
 {position:{x:5,y:5,z:5},direction:{x:0,y:0,z:1}},
 {position:{x:45,y:5,z:5},direction:{x:-1,y:0,z:0}},
 {position:{x:5,y:5,z:45},direction:{x:1,y:0,z:0}},
 {position:{x:45,y:5,z:45},direction:{x:0,y:0,z:-1}},
];
const key = (v: Axis) => `${v.x},${v.y},${v.z}`;
const same = (a: Axis,b: Axis) => a.x===b.x&&a.y===b.y&&a.z===b.z;
const add = (a: Axis,b: Axis):Axis => ({x:a.x+b.x,y:a.y+b.y,z:a.z+b.z});
const inBounds = (p: Axis) => p.x>=0&&p.x<=WORLD_SIZE&&p.y>=0&&p.y<=WORLD_SIZE&&p.z>=0&&p.z<=WORLD_SIZE;
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const rng = (seed: number) => () => { let t=seed+=0x6D2B79F5; t=Math.imul(t^(t>>>15),t|1); t^=t+Math.imul(t^(t>>>7),t|61); return ((t^(t>>>14))>>>0)/4294967296; };
export function foodEffect(kind: FoodKind) { return kind==='green'?{score:5,growth:3,speed:50}:kind==='blue'?{score:15,growth:5,speed:10}:{score:3,growth:3,speed:-10}; }
export function createSimulation(seed: number): SimulationState { const random=rng(seed), food:Food[]=[]; while(food.length<FOOD_COUNT){const p={x:Math.floor(random()*51),y:Math.floor(random()*51),z:Math.floor(random()*51)};if(!food.some(f=>same(f,p)))food.push({...p,kind:random()<.5?'blue':random()<.8?'green':'pink'});} return {seed,tick:0,food,players:{}}; }
export function safeSpawn(state: SimulationState, _random = rng(state.seed + state.tick + Object.keys(state.players).length), requestedIndex?: number): { position:Axis; direction:Axis } {
  void _random;
  const blocked=new Set(Object.values(state.players).flatMap(p=>p.segments).map(key));
  const start = Number.isInteger(requestedIndex) ? ((requestedIndex! % spawnPoints.length) + spawnPoints.length) % spawnPoints.length : 0;
  for(let offset=0;offset<spawnPoints.length;offset++){const spawn=spawnPoints[(start+offset)%spawnPoints.length];const tail={x:spawn.position.x-spawn.direction.x*2,y:spawn.position.y-spawn.direction.y*2,z:spawn.position.z-spawn.direction.z*2};if(inBounds(tail)&&!blocked.has(key(spawn.position))&&!blocked.has(key(tail)))return {position:{...spawn.position},direction:{...spawn.direction}};}
  return {position:{...spawnPoints[start].position},direction:{...spawnPoints[start].direction}};
}
export function addPlayer(state:SimulationState, id:string, name:string, now:number, options:Partial<Pick<SimPlayer,'entityId'|'phantom'|'score'|'color'|'segments'|'direction'|'up'|'instanceId'>> & {spawnIndex?:number;startPosition?:Axis}={}) { const spawn=safeSpawn(state, undefined, options.spawnIndex);const direction=options.direction??spawn.direction, up=options.up??{x:0,y:1,z:0}, head=options.startPosition??options.segments?.[0]??spawn.position, entityId=options.entityId??`${id}:${now}:${Object.keys(state.players).length}`;state.players[entityId]={id,entityId,name,segments:options.segments??[head,add(head,{x:-direction.x,y:-direction.y,z:-direction.z}),add(head,{x:-2*direction.x,y:-2*direction.y,z:-2*direction.z})],direction,up,score:options.score??0,speed:BASE_SPEED,growth:0,alive:true,phantom:options.phantom,color:options.color??(options.phantom?'#7dd3fc':'#ffffff'),nextStepAt:now+200,instanceId:options.instanceId};return state.players[entityId]; }
export function validOrientation(direction: unknown, up: unknown): direction is Axis { if(!direction||!up||typeof direction!=='object'||typeof up!=='object')return false;const d=direction as Axis,u=up as Axis;const dLength=d.x**2+d.y**2+d.z**2,uLength=u.x**2+u.y**2+u.z**2;return directions.some(v=>same(v,d))&&directions.some(v=>same(v,u))&&Math.abs(dLength-1)<1e-9&&Math.abs(uLength-1)<1e-9&&Math.abs(d.x*u.x+d.y*u.y+d.z*u.z)<1e-9; }
export function validInput(current:Axis, next:unknown, _currentUp?:Axis, nextUp?:unknown): next is Axis { if(!next||typeof next!=='object')return false;const v=next as Axis;return directions.some(d=>same(d,v))&&!(v.x===-current.x&&v.y===-current.y&&v.z===-current.z)&&(nextUp===undefined||validOrientation(v,nextUp)); }
function respawn(state:SimulationState,index:number): FoodChange { const removed=clone(state.food[index]), random=rng(state.seed+state.tick*7919+index), occupied=new Set(Object.values(state.players).flatMap(p=>p.segments).map(key));for(let i=0;i<4096;i++){const p={x:Math.floor(random()*51),y:Math.floor(random()*51),z:Math.floor(random()*51)};if(!occupied.has(key(p))&&!state.food.some((f,n)=>n!==index&&same(f,p))){state.food[index]={...p,kind:random()<.5?'blue':random()<.8?'green':'pink'};return {removed,added:clone(state.food[index])};}} return {removed,added:clone(state.food[index])}; }

/** Executes one simultaneous server tick. Tails that leave during this tick are not blockers. */
export function stepSimulationDelta(state:SimulationState, at:number, allowDeaths=true): SimulationDelta | null {
 const due=Object.values(state.players).filter(p=>p.alive&&p.nextStepAt===at); if(!due.length)return null;
 const heads=new Map(due.map(p=>[p.id,add(p.segments[0],p.direction)]));
 const foodAt=new Map(due.map(p=>[p.id,state.food.findIndex(f=>same(f,heads.get(p.id)!))]));
 const freed=new Set(due.filter(p=>p.growth===0&&foodAt.get(p.id)===-1).map(p=>key(p.segments[p.segments.length-1])));
 const occupied=new Set(Object.values(state.players).flatMap(p=>p.segments).map(key)); for(const cell of freed)occupied.delete(cell);
 const headCounts=new Map<string,number>(); for(const head of heads.values())headCounts.set(key(head),(headCounts.get(key(head))??0)+1);
 const changed:SimPlayer[]=[], food:FoodChange[]=[], deaths:SimulationDelta['deaths']=[];
 for(const player of due){const head=heads.get(player.id)!; let reason:DeathReason|undefined;
   if(!inBounds(head))reason='bounds'; else if((headCounts.get(key(head))??0)>1)reason='head-to-head'; else if(occupied.has(key(head)))reason='body';
    if(reason&&allowDeaths){player.alive=false; player.nextStepAt=at; changed.push(clone(player)); deaths.push({player:clone(player),position:clone(head),reason}); continue;}
    const foodIndex=foodAt.get(player.id)!; if(foodIndex>=0){const effect=foodEffect(state.food[foodIndex].kind);player.score+=effect.score;player.growth+=effect.growth;player.speed=Math.max(60,player.speed+effect.speed);const replacement=respawn(state,foodIndex);food.push({...replacement,entityId:player.entityId,score:player.score,speed:player.speed,growth:effect.growth,length:player.segments.length+(player.growth>0?1:0)});}
   const keepTail=player.growth>0; if(keepTail)player.growth--; const tail=player.segments[player.segments.length-1]; player.segments=[clone(head),...player.segments.slice(0,keepTail?player.segments.length:player.segments.length-1)]; if(keepTail)player.segments.push(clone(tail)); player.nextStepAt=at+60000/player.speed; changed.push(clone(player));
 }
  state.tick++; return {changed,food,deaths,tick:state.tick};
}

/** Builds the simulation to server time, preserving atomicity for equal nextStepAt values. */
export function advanceSimulation(state:SimulationState, now:number, allowDeaths=true): SimulationDelta[] { const deltas:SimulationDelta[]=[]; for(;;){const due=Object.values(state.players).filter(p=>p.alive&&p.nextStepAt<=now);if(!due.length)break;const at=Math.min(...due.map(p=>p.nextStepAt));const delta=stepSimulationDelta(state,at,allowDeaths);if(delta)deltas.push(delta);} return deltas; }
export function stepSimulation(state:SimulationState, now:number) { return advanceSimulation(state,now).length>0; }
export function chooseLowestPhantom(players: SimPlayer[]) { return players.filter(p=>p.phantom).sort((a,b)=>a.score-b.score||a.id.localeCompare(b.id))[0]; }
