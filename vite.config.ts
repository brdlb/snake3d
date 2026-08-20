import { defineConfig } from 'vite';
import { readdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';

async function removeWavFiles(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });

    await Promise.all(entries.map(async (entry) => {
        const entryPath = resolve(directory, entry.name);

        if (entry.isDirectory()) {
            await removeWavFiles(entryPath);
        } else if (entry.name.toLowerCase().endsWith('.wav')) {
            await rm(entryPath);
        }
    }));
}

export default defineConfig({
    base: './', // Relative paths for easier deployment
    plugins: [{
        name: 'exclude-wav-assets',
        apply: 'build',
        async closeBundle() {
            await removeWavFiles(resolve(process.cwd(), 'dist'));
        },
    }],
    build: {
        outDir: 'dist',
        assetsDir: 'assets',
    },
});
