import './style.css';
import { Game } from './core/Game';
import { networkManager, NetworkStatusUI } from './network';

// Initialize the game when the DOM is ready
window.addEventListener('DOMContentLoaded', async () => {
    // Initialize network connection
    const statusUI = new NetworkStatusUI();

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
