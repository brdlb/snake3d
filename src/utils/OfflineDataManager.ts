import { NetworkManager, UserData } from '../network/NetworkManager';

interface GameData {
  userId?: string;
  settings?: any;
  scores?: Array<any>;
  progress?: any;
  [key: string]: any;
}

interface PendingSyncOperation {
  id: string;
  operation: 'save' | 'update' | 'delete';
  storeName: string;
  data: any;
  timestamp: number;
}

export class OfflineDataManager {
  private dbName = 'Snake3DGameDB';
  private version = 1;
  private db: IDBDatabase | null = null;
  
  // Имя хранилища данных
  private readonly STORES = {
    GAME_DATA: 'game_data',
    PENDING_SYNC: 'pending_sync_operations'
  };
  
  constructor() {
    this.initDB();
  }
  
  /**
   * Инициализация IndexedDB базы данных
   */
  private async initDB(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.version);
      
      request.onerror = () => {
        console.error('Ошибка при открытии IndexedDB:', request.error);
        reject(request.error);
      };
      
      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };
      
      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        
        // Создание хранилища для игровых данных
        if (!db.objectStoreNames.contains(this.STORES.GAME_DATA)) {
          db.createObjectStore(this.STORES.GAME_DATA, { keyPath: 'id' });
        }
        
        // Создание хранилища для операций синхронизации
        if (!db.objectStoreNames.contains(this.STORES.PENDING_SYNC)) {
          const syncStore = db.createObjectStore(this.STORES.PENDING_SYNC, { keyPath: 'id' });
          // Индекс для сортировки по времени
          syncStore.createIndex('timestamp', 'timestamp', { unique: false });
        }
      };
    });
  }
  
  /**
   * Сохранение данных игры в IndexedDB
   */
  async saveGameData(key: string, data: GameData): Promise<void> {
    if (!this.db) {
      throw new Error('База данных не инициализирована');
    }
    
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.STORES.GAME_DATA], 'readwrite');
      const store = transaction.objectStore(this.STORES.GAME_DATA);
      
      const request = store.put({ id: key, ...data });
      
      request.onsuccess = () => {
        // Если есть подключение к сети, добавляем в очередь синхронизации
        if (navigator.onLine) {
          this.addToSyncQueue(key, 'save', data);
        }
        resolve();
      };
      
      request.onerror = () => {
        reject(request.error);
      };
    });
  }
  
  /**
   * Получение данных игры из IndexedDB
   */
  async getGameData(key: string): Promise<GameData | null> {
    if (!this.db) {
      throw new Error('База данных не инициализирована');
    }
    
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.STORES.GAME_DATA], 'readonly');
      const store = transaction.objectStore(this.STORES.GAME_DATA);
      
      const request = store.get(key);
      
      request.onsuccess = () => {
        resolve(request.result ? { ...request.result } : null);
      };
      
      request.onerror = () => {
        reject(request.error);
      };
    });
  }
  
  /**
   * Удаление данных игры из IndexedDB
   */
  async deleteGameData(key: string): Promise<void> {
    if (!this.db) {
      throw new Error('База данных не инициализирована');
    }
    
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.STORES.GAME_DATA], 'readwrite');
      const store = transaction.objectStore(this.STORES.GAME_DATA);
      
      const request = store.delete(key);
      
      request.onsuccess = () => {
        if (navigator.onLine) {
          this.addToSyncQueue(key, 'delete', null);
        }
        resolve();
      };
      
      request.onerror = () => {
        reject(request.error);
      };
    });
  }
  
  /**
   * Добавление операции в очередь синхронизации
   */
  private async addToSyncQueue(id: string, operation: 'save' | 'update' | 'delete', data: any): Promise<void> {
    if (!this.db) {
      throw new Error('База данных не инициализирована');
    }
    
    const syncOperation: PendingSyncOperation = {
      id,
      operation,
      storeName: this.STORES.GAME_DATA,
      data,
      timestamp: Date.now()
    };
    
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.STORES.PENDING_SYNC], 'readwrite');
      const store = transaction.objectStore(this.STORES.PENDING_SYNC);
      
      const request = store.add(syncOperation);
      
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }
  
  /**
   * Получение всех операций синхронизации из очереди
   */
  private async getPendingSyncOperations(): Promise<PendingSyncOperation[]> {
    if (!this.db) {
      throw new Error('База данных не инициализирована');
    }
    
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.STORES.PENDING_SYNC], 'readonly');
      const store = transaction.objectStore(this.STORES.PENDING_SYNC);
      
      const request = store.getAll();
      
      request.onsuccess = () => {
        // Сортировка по времени (старые операции первыми)
        const operations = request.result.sort((a, b) => a.timestamp - b.timestamp);
        resolve(operations);
      };
      
      request.onerror = () => {
        reject(request.error);
      };
    });
  }
  
  /**
   * Удаление операции из очереди синхронизации
   */
  private async removeSyncOperation(id: string): Promise<void> {
    if (!this.db) {
      throw new Error('База данных не инициализирована');
    }
    
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.STORES.PENDING_SYNC], 'readwrite');
      const store = transaction.objectStore(this.STORES.PENDING_SYNC);
      
      const request = store.delete(id);
      
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }
  
  /**
   * Синхронизация данных с сервером при восстановлении соединения
   */
  async syncWithServer(networkManager: NetworkManager): Promise<void> {
    try {
      const operations = await this.getPendingSyncOperations();
      
      for (const operation of operations) {
        try {
          // Выполнение операции на сервере
          switch (operation.operation) {
            case 'save':
            case 'update':
              // Обновляем данные пользователя на сервере
              await this.updateUserDataOnServer(networkManager, operation.id, operation.data);
              break;
              
            case 'delete':
              // Для удаления просто удаляем из очереди, т.к. данные уже удалены локально
              // или помечаем как удаленные на сервере если есть такая возможность
              break;
          }
          
          // Удаляем успешную операцию из очереди
          await this.removeSyncOperation(operation.id);
        } catch (error) {
          console.error(`Ошибка при синхронизации операции ${operation.id}:`, error);
          // Не удаляем операцию из очереди при ошибке
        }
      }
    } catch (error) {
      console.error('Ошибка при синхронизации с сервером:', error);
    }
  }
  
  /**
   * Обновление пользовательских данных на сервере
   */
  private async updateUserDataOnServer(networkManager: NetworkManager, key: string, data: any): Promise<void> {
    // Формируем обновления для сервера
    const updates: Partial<UserData> = {};
    
    // В зависимости от типа данных, формируем соответствующие обновления
    if (key === 'settings' && data.settings) {
      updates.settings = data.settings;
    } else if (key === 'highScore' && data.highScore !== undefined) {
      updates.highScore = data.highScore;
      if (data.highScoreSeed !== undefined) updates.highScoreSeed = data.highScoreSeed;
      if (data.highScoreReplayId !== undefined) updates.highScoreReplayId = data.highScoreReplayId;
      if (data.highScoreDate !== undefined) updates.highScoreDate = data.highScoreDate;
    } else if (key === 'progress' && data.progress) {
      // Обновляем другие поля прогресса
      Object.assign(updates, data.progress);
    } else {
      // Если это общие данные пользователя, добавляем их напрямую
      Object.assign(updates, data);
    }
    
    // Отправляем обновления на сервер
    networkManager.updateUser(updates);
  }
  
  /**
   * Обработка события восстановления подключения к сети
   */
  setupOnlineHandler(networkManager: NetworkManager): void {
    window.addEventListener('online', async () => {
      console.log('Соединение с сетью восстановлено. Начинаю синхронизацию...');
      await this.syncWithServer(networkManager);
    });
  }
  
  /**
   * Очистка всех данных в IndexedDB
   */
  async clearAllData(): Promise<void> {
    if (!this.db) {
      throw new Error('База данных не инициализирована');
    }
    
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(
        [this.STORES.GAME_DATA, this.STORES.PENDING_SYNC],
        'readwrite'
      );
      
      const gameStore = transaction.objectStore(this.STORES.GAME_DATA);
      const syncStore = transaction.objectStore(this.STORES.PENDING_SYNC);
      
      const gameReq = gameStore.clear();
      const syncReq = syncStore.clear();
      
      gameReq.onsuccess = syncReq.onsuccess = () => {
        if (transaction.error) {
          reject(transaction.error);
        } else {
          resolve();
        }
      };
      
      gameReq.onerror = syncReq.onerror = () => {
        reject(gameReq.error || syncReq.error);
      };
    });
  }
}