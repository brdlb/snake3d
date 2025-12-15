
import { networkManager } from '../network/NetworkManager';

export interface LeaderboardEntry {
    playerName: string;
    score: number;
    seed: number;
    date: number;
    replayId: string;
}

export class LeaderboardUI {
    private container: HTMLElement;
    private backdrop: HTMLElement;
    private content: HTMLElement;
    private tableBody: HTMLElement;
    private closeBtn: HTMLElement;
    private isVisible: boolean = false;


    constructor(private readonly currentPlayerName: string) {
        // Create container structure
        this.container = document.createElement('div');
        this.container.className = 'leaderboard-screen';

        this.backdrop = document.createElement('div');
        this.backdrop.className = 'leaderboard-backdrop';
        this.container.appendChild(this.backdrop);

        this.content = document.createElement('div');
        this.content.className = 'leaderboard-content';
        this.container.appendChild(this.content);

        // Header
        const header = document.createElement('div');
        header.className = 'leaderboard-header';

        const title = document.createElement('h2');
        title.className = 'leaderboard-title';
        title.textContent = 'TOP PHANTOMS';
        header.appendChild(title);

        this.closeBtn = document.createElement('button');
        this.closeBtn.className = 'leaderboard-close';
        this.closeBtn.innerHTML = '&times;';
        this.closeBtn.onclick = () => this.hide();
        header.appendChild(this.closeBtn);

        this.content.appendChild(header);

        // Table Header
        const tableHeader = document.createElement('div');
        tableHeader.className = 'leaderboard-row header';
        tableHeader.innerHTML = `
            <div class="col-rank">#</div>
            <div class="col-name">PLAYER</div>
            <div class="col-score">SCORE</div>
            <div class="col-seed">ROOM</div>
            <div class="col-date">DATE</div>
        `;
        this.content.appendChild(tableHeader);

        // Table Body
        this.tableBody = document.createElement('div');
        this.tableBody.className = 'leaderboard-list';
        this.content.appendChild(this.tableBody);

        document.body.appendChild(this.container);

        // Network listeners
        networkManager.on('leaderboard:data', (data: LeaderboardEntry[]) => {
            this.renderData(data);
        });

        networkManager.on('leaderboard:error', () => {
            this.tableBody.innerHTML = '<div class="leaderboard-message helper-text">Failed to load data</div>';
        });

        // Close on backdrop click
        this.backdrop.onclick = () => this.hide();
    }

    public show(): void {
        this.isVisible = true;
        this.container.classList.add('active');
        this.tableBody.innerHTML = '<div class="leaderboard-message helper-text">Loading...</div>';
        this.tableBody.innerHTML = '<div class="leaderboard-message helper-text">Loading...</div>';
        networkManager.requestLeaderboard();
    }

    public hide(): void {
        this.isVisible = false;
        this.container.classList.remove('active');
    }

    private renderData(data: LeaderboardEntry[]): void {
        this.tableBody.innerHTML = '';

        if (data.length === 0) {
            this.tableBody.innerHTML = '<div class="leaderboard-message helper-text">No records yet</div>';
            return;
        }

        data.forEach((entry, index) => {
            const row = document.createElement('div');
            row.className = 'leaderboard-row';

            if (entry.playerName === this.currentPlayerName) {
                row.classList.add('current-user');
            }

            const date = new Date(entry.date).toLocaleDateString([], {
                month: 'short', day: 'numeric'
            });

            row.innerHTML = `
                <div class="col-rank">${index + 1}</div>
                <div class="col-name" title="${entry.playerName}">${entry.playerName}</div>
                <div class="col-score">${entry.score}</div>
                <div class="col-seed">${entry.seed}</div>
                <div class="col-date">${date}</div>
            `;
            this.tableBody.appendChild(row);
        });
    }

    public toggle(): void {
        if (this.isVisible) {
            this.hide();
        } else {
            this.show();
        }
    }

    public dispose(): void {
        this.container.remove();
    }
}
