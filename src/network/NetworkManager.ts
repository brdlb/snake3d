import type { RoomData } from '../types/replay';
export type RoomAction = 'initial' | 'resume' | 'restart' | 'next' | 'join' | 'spectate';

export interface UserData { id?: string; username: string; createdAt: string; lastSeen: string; highScore: number; highScoreSeed?: number; highScoreReplayId?: string; highScoreDate?: string; gamesPlayed: number; totalScore: number; elo: number; settings: { musicVolume: number; sfxVolume: number } }
export interface AuthResult { user: UserData; isNew: boolean }
type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'authenticated' | 'offline';
type EventCallback = (...args: any[]) => void;

/** HTTP owns durable data; the room WebSocket is only for live events. */
export class NetworkManager {
  private static instance: NetworkManager;
  private socket: WebSocket | null = null;
  private user: UserData | null = null;
  private state: ConnectionState = 'disconnected';
  private listeners = new Map<string, Set<EventCallback>>();
  private retries = 0;
  private heartbeat: number | null = null;
  private roomSeed: number | null = null;
  private roomIsSpectator = false;
  private roomIsRestarting = false;
  private readonly apiBase = import.meta.env.VITE_API_URL ?? (import.meta.env.PROD ? window.location.origin : 'http://localhost:8787');
  private constructor() { if (typeof window !== 'undefined') { window.addEventListener('online', () => { this.emit('networkOnline'); this.reconnectRoom(); }); window.addEventListener('offline', () => { this.state='offline'; this.emit('networkOffline'); this.emit('connectionStateChange',this.state); }); } }
  static getInstance() { return this.instance ??= new NetworkManager(); }
  private async api<T>(path:string, init:RequestInit = {}):Promise<T> { const response=await fetch(`${this.apiBase}${path}`,{...init,credentials:'include',headers:{'content-type':'application/json',...init.headers}}); if(!response.ok) throw new Error(`API ${response.status}: ${(await response.text()).slice(0,200)}`); return response.json() as Promise<T>; }
  async connect(): Promise<AuthResult> { if(typeof navigator !== 'undefined'&&!navigator.onLine){this.state='offline';throw new Error('Offline mode');} this.state='connecting';this.emit('connectionStateChange',this.state); try { let result:AuthResult; try { result=await this.api<AuthResult>('/api/v1/me'); } catch(error) { if(!(error instanceof Error)||!error.message.startsWith('API 401'))throw error; result=await this.api<AuthResult>('/api/v1/session',{method:'POST',body:'{}'}); } this.user=result.user; this.state='authenticated'; this.emit('connectionStateChange',this.state);this.emit('authenticated',result);return result; } catch(error) { this.state='disconnected';this.emit('connectionStateChange',this.state);throw error; } }
  async updateUser(updates: Partial<UserData>) { if(!updates.settings)return; const result=await this.api<{user:UserData}>('/api/v1/me/settings',{method:'PATCH',body:JSON.stringify({settings:updates.settings})}); this.user=result.user;this.emit('userDataUpdated',this.user); }
  send(event:string,data?:any) { if(event==='room:join'){void this.requestRoom(data?.action ?? 'initial',data?.contextSeed);return;} if(this.socket?.readyState===WebSocket.OPEN)this.socket.send(JSON.stringify({v:1,type:event,id:crypto.randomUUID(),payload:data})); }
  async requestRoom(action:RoomAction, contextSeed?:number):Promise<RoomData> { const room=await this.api<RoomData>('/api/v1/matches',{method:'POST',body:JSON.stringify(action==='join'||action==='spectate'?{action,seed:contextSeed}:{action,contextSeed})}); this.roomSeed=room.seed; this.roomIsSpectator=action==='spectate'; this.roomIsRestarting=action==='restart'; this.openRoomSocket(room.seed,this.roomIsSpectator,this.roomIsRestarting); return room; }
  requestLeaderboard() { void this.api<any[]>('/api/v1/leaderboard?limit=50').then(data=>this.emit('leaderboard:data',data)).catch(()=>this.emit('leaderboard:error',{message:'Failed to load leaderboard'})); }
  private openRoomSocket(seed:number, spectating=false, restarting=false) { const previous=this.socket; if(this.heartbeat!==null)window.clearInterval(this.heartbeat); this.heartbeat=null; const url=new URL(`${this.apiBase}/api/v1/rooms/${seed}/socket`);if(spectating)url.searchParams.set('spectator','1');if(restarting)url.searchParams.set('restart','1');url.protocol=url.protocol==='https:'?'wss:':'ws:'; const socket=this.socket=new WebSocket(url); previous?.close(); socket.onopen=()=>{if(this.socket!==socket)return;this.retries=0;this.roomIsRestarting=false;socket.send(JSON.stringify({v:2,type:'room.resync'}));this.heartbeat=window.setInterval(()=>socket.readyState===WebSocket.OPEN&&socket.send(JSON.stringify({v:2,type:'ping'})),15000);this.emit('roomSocketConnected');}; socket.onmessage=(event)=>{if(this.socket!==socket)return;try{const msg=JSON.parse(event.data);this.emit(msg.type,msg.payload??msg);}catch{}}; socket.onclose=()=>{if(this.socket!==socket)return;if(this.heartbeat!==null)window.clearInterval(this.heartbeat);this.heartbeat=null;this.scheduleReconnect();}; socket.onerror=()=>socket.close(); }
  sendDirection(direction:{x:number;y:number;z:number}, up:{x:number;y:number;z:number} = {x:0,y:1,z:0}) { if(this.socket?.readyState===WebSocket.OPEN)this.socket.send(JSON.stringify({v:2,type:'player.directionChanged',payload:{action:{type:'direction',direction,up}}})); }
  requestResync() { if(this.socket?.readyState===WebSocket.OPEN)this.socket.send(JSON.stringify({v:2,type:'room.resync'})); }
  private scheduleReconnect(){if(this.roomSeed===null||(typeof navigator!=='undefined'&&!navigator.onLine)||this.retries>=5)return;const delay=Math.min(1000*2**this.retries++,10000);window.setTimeout(()=>this.roomSeed!==null&&this.openRoomSocket(this.roomSeed,this.roomIsSpectator,this.roomIsRestarting),delay);}
  private reconnectRoom(){if(this.roomSeed!==null)this.openRoomSocket(this.roomSeed,this.roomIsSpectator,this.roomIsRestarting);}
  disconnect(){this.socket?.close();this.socket=null;this.state='disconnected';this.emit('connectionStateChange',this.state);}
  on(event:string,callback:EventCallback){let set=this.listeners.get(event);if(!set)this.listeners.set(event,set=new Set());set.add(callback);}
  off(event:string,callback:EventCallback){this.listeners.get(event)?.delete(callback);}
  private emit(event:string,...args:any[]){this.listeners.get(event)?.forEach(callback=>{try{callback(...args);}catch(error){console.error(`[Network] listener for ${event} failed`,error);}});}
  getConnectionState(){return this.state;} isConnected(){return this.state==='authenticated';} getUser(){return this.user;} getToken(){return null;} getSocket(){return this.socket;} isOffline(){return typeof navigator!=='undefined'&&!navigator.onLine;} clearToken(){this.user=null;}
  getOfflineUserData():UserData|null{try{const raw=localStorage.getItem('snake3d_offline_user');return raw?JSON.parse(raw):null;}catch{return null;}} saveOfflineUserData(user:UserData){localStorage.setItem('snake3d_offline_user',JSON.stringify(user));}
}
export const networkManager=NetworkManager.getInstance();
