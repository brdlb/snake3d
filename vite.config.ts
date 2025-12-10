import { defineConfig } from 'vite';

export default defineConfig({
    base: './', // Relative paths for easier deployment
    build: {
        outDir: 'dist',
        assetsDir: 'assets',
    },
});
