#!/usr/bin/env node

/**
 * Build script для сервера
 * Компилирует TypeScript и копирует файлы в правильную структуру
 */

import { execSync } from 'child_process';
import { existsSync, mkdirSync, cpSync, rmSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const serverDir = join(__dirname, 'server');
const distDir = join(serverDir, 'dist');

console.log('🔨 Building server...');

// Очистка старой сборки
if (existsSync(distDir)) {
    console.log('🧹 Cleaning old build...');
    rmSync(distDir, { recursive: true, force: true });
}

// Компиляция TypeScript
console.log('📦 Compiling TypeScript...');
try {
    execSync('tsc -p server/tsconfig.json', { stdio: 'inherit' });
} catch (error) {
    console.error('❌ TypeScript compilation failed');
    process.exit(1);
}

// Проверка что файлы созданы
if (!existsSync(join(distDir, 'index.js'))) {
    console.error('❌ Build failed: index.js not found in', distDir);
    process.exit(1);
}

console.log('✅ Server build complete!');
console.log('📁 Output:', distDir);
