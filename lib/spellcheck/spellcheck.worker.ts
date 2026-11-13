/** Checks spelling off the UI thread. Started by lib/spellcheck/spellcheck-client.ts. */
// The packages only export a Node loader, so their files are imported by path. next.config.mjs
// bundles .aff and .dic files as text.
import enGbAff from '../../node_modules/dictionary-en-gb/index.aff'
import enGbDic from '../../node_modules/dictionary-en-gb/index.dic'
import enUsAff from '../../node_modules/dictionary-en/index.aff'
import enUsDic from '../../node_modules/dictionary-en/index.dic'
import type { SpellcheckLanguage } from '@/lib/spellcheck/languages'
import {
    createSpellcheckWorkerCore,
    type DictionaryFiles,
    type SpellcheckRequest,
    type SpellcheckResponse,
} from '@/lib/spellcheck/spellcheck-worker-core'

type WorkerScope = {
    addEventListener(type: 'message', listener: (event: MessageEvent<SpellcheckRequest>) => void): void
    postMessage(message: SpellcheckResponse): void
}

const DICTIONARIES: Record<SpellcheckLanguage, DictionaryFiles> = {
    'en-US': { aff: enUsAff, dic: enUsDic },
    'en-GB': { aff: enGbAff, dic: enGbDic },
}

const scope = globalThis as unknown as WorkerScope
const core = createSpellcheckWorkerCore((language) => DICTIONARIES[language])

scope.addEventListener('message', (event) => {
    void core.handle(event.data).then((response) => scope.postMessage(response))
})
