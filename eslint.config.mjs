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
    {
        // Reading the browser's clipboard makes WebView2 ask the user for clipboard access (#208).
        ignores: ['lib/tauri/clipboard.ts'],
        rules: {
            'no-restricted-properties': [
                'error',
                {
                    object: 'navigator',
                    property: 'clipboard',
                    message: 'Use lib/tauri/clipboard.ts, which goes through Tauri, so WebView2 never asks for clipboard access.',
                },
            ],
            'no-restricted-syntax': [
                'error',
                {
                    selector: "MemberExpression[object.property.name='navigator'][property.name='clipboard']",
                    message: 'Use lib/tauri/clipboard.ts, which goes through Tauri, so WebView2 never asks for clipboard access.',
                },
            ],
        },
    },
    globalIgnores([
        '.next/**',
        'out/**',
        'build/**',
        'coverage/**',
        'next-env.d.ts',
        'node_modules/**',
        'src-tauri/target/**',
        'src-tauri/gen/**',
        'lib/examples/craft-samples.ts',
        'lib/examples/markdown-showcase.ts',
        'lib/legal/third-party-licenses.ts',
        '.agents/**',
    ]),
])

export default eslintConfig
