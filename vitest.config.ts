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
            // Measure all app source, not just the files some test happens to import.
            include: ['app/**/*.{ts,tsx}', 'components/**/*.{ts,tsx}', 'hooks/**/*.{ts,tsx}', 'lib/**/*.{ts,tsx}'],
            exclude: [
                'vitest/**',
                '**/*.test.ts',
                '**/*.test.tsx',
                '**/*.d.ts',
                'components/ui/**',
                'lib/examples/craft-samples.ts',
                'lib/examples/markdown-showcase.ts',
                'lib/legal/third-party-licenses.ts',
            ],
            // Floor just under the real numbers; raise it as tests are added.
            thresholds: {
                statements: 40,
                branches: 49,
                functions: 33,
                lines: 39,
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
