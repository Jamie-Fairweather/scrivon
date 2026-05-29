import { defineConfig, globalIgnores } from 'eslint/config'
import nextVitals from 'eslint-config-next/core-web-vitals'
import nextTs from 'eslint-config-next/typescript'

const eslintConfig = defineConfig([
    ...nextVitals,
    ...nextTs,
    {
        settings: {
            react: { version: '19' },
        },
    },
    globalIgnores([
        '.next/**',
        'out/**',
        'build/**',
        'next-env.d.ts',
        'node_modules/**',
        'src-tauri/target/**',
        'src-tauri/gen/**',
        'lib/examples/craft-samples.ts',
        'lib/examples/markdown-showcase.ts',
        'lib/legal/third-party-licenses.ts',
    ]),
])

export default eslintConfig
