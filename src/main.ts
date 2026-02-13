import './style.css';
import { Game } from './core/Game';
import { networkManager } from './network';

// Register service worker if supported
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then((registration) => {
        console.log('ServiceWorker registration successful with scope: ', registration.scope);
      })
      .catch((error) => {
        console.log('ServiceWorker registration failed: ', error);
      });
  });
}

// Initialize the game when the DOM is ready
window.addEventListener('DOMContentLoaded', async () => {
    try {
        const authResult = await networkManager.connect();
        console.log(
            `[Main] Connected as ${authResult.user.username}`,
            authResult.isNew ? '(new player)' : '(returning player)'
        );
    } catch (error) {
        console.warn('[Main] Failed to connect to server, running offline:', error);
    }

    // Start the game regardless of network status
    new Game();
});
