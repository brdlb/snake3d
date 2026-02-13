// Тестовый файл для демонстрации использования OfflineDataManager
import { OfflineDataManager } from '../OfflineDataManager';
import { networkManager } from '../../network/NetworkManager';

// Пример использования OfflineDataManager
async function example() {
  const offlineManager = new OfflineDataManager();
  
  // Пример сохранения настроек пользователя
  await offlineManager.saveGameData('settings', {
    settings: {
      musicVolume: 0.7,
      sfxVolume: 0.8,
      graphicsQuality: 'high',
      controls: {
        up: 'ArrowUp',
        down: 'ArrowDown',
        left: 'ArrowLeft',
        right: 'ArrowRight'
      }
    }
  });
  
  // Пример сохранения рекордов
  await offlineManager.saveGameData('highScore', {
    highScore: 15000,
    highScoreSeed: 12345,
    highScoreReplayId: 'replay_abc123',
    highScoreDate: new Date().toISOString()
  });
  
  // Пример сохранения прогресса
  await offlineManager.saveGameData('progress', {
    progress: {
      levelsCompleted: 15,
      achievements: ['first_win', 'ten_games_played'],
      totalTimePlayed: 3600 // в секундах
    }
  });
  
  // Получение данных
  const settings = await offlineManager.getGameData('settings');
  console.log('Загруженные настройки:', settings);
  
  // Настройка синхронизации при подключении к интернету
  offlineManager.setupOnlineHandler(networkManager);
}

// Вызов примера
example().catch(console.error);