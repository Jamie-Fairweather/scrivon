import path from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
    plugins: [react()],
    resolve: {
        alias: {
            '@': path.resolve(__dirname, '.'),
        },
    },
    test: {
        coverage: {
            provider: 'v8',
            reporter: ['text', 'html', 'lcov'],
            exclude: ['vitest/**', '**/*.test.ts', '**/*.test.tsx', 'lib/examples/craft-samples.ts'],
            thresholds: {
                statements: 100,
                branches: 100,
                functions: 100,
                lines: 100,
            },
        },
        projects: [
            {
                extends: true,
                test: {
                    name: 'unit',
                    include: ['lib/**/*.test.ts', 'hooks/**/*.test.ts', 'components/**/*.test.ts'],
                    environment: 'node',
                },
            },
            {
                extends: true,
                test: {
                    name: 'components',
                    include: ['components/**/*.test.tsx', 'lib/**/*.test.tsx'],
                    environment: 'happy-dom',
                    setupFiles: ['./vitest.setup.ts'],
                },
            },
        ],
    },
})
