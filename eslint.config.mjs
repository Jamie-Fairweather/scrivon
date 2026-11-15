import { defineConfig, globalIgnores } from 'eslint/config'
import nextVitals from 'eslint-config-next/core-web-vitals'
import nextTs from 'eslint-config-next/typescript'

const USE_CLIPBOARD_MODULE = 'Use lib/tauri/clipboard.ts, which goes through Tauri, so WebView2 never asks for clipboard access.'
const CLIPBOARD_PLUGIN = '@tauri-apps/plugin-clipboard-manager'

const eslintConfig = defineConfig([
    ...nextVitals,
    ...nextTs,
    {
        settings: {
            react: { version: '19' },
        },
    },
    {
        // Reading the browser's clipboard makes WebView2 ask the user for clipboard access (#208). And the
        // clipboard grants in src-tauri/capabilities/clipboard.json are what lib/tauri/clipboard.ts imports.
        ignores: ['lib/tauri/clipboard.ts'],
        rules: {
            // navigator.clipboard, navigator['clipboard'], navigator?.clipboard, const { clipboard } = navigator
            'no-restricted-properties': ['error', { object: 'navigator', property: 'clipboard', message: USE_CLIPBOARD_MODULE }],
            'no-restricted-syntax': [
                'error',
                // window.navigator.clipboard and window.navigator['clipboard'] (globalThis. and self. too)
                {
                    selector: "MemberExpression[object.property.name='navigator']:matches([property.name='clipboard'], [property.value='clipboard'])",
                    message: USE_CLIPBOARD_MODULE,
                },
                // const { clipboard } = window.navigator
                {
                    selector: "VariableDeclarator[init.property.name='navigator'] > ObjectPattern > Property[key.name='clipboard']",
                    message: USE_CLIPBOARD_MODULE,
                },
                // await import('@tauri-apps/plugin-clipboard-manager')
                { selector: `ImportExpression[source.value='${CLIPBOARD_PLUGIN}']`, message: USE_CLIPBOARD_MODULE },
            ],
            'no-restricted-imports': ['error', { paths: [{ name: CLIPBOARD_PLUGIN, message: USE_CLIPBOARD_MODULE }] }],
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
