/** Runs Find in Workspace's regular expressions off the UI thread. Started by regex-match-client.ts. */
import type { RegexMatchRequest, RegexMatchResponse } from '@/components/studio/command-palette/regex-match-client'
import { compileTextQuery, matchText, type CompiledTextQuery } from '@/components/studio/command-palette/text-matcher'

type WorkerScope = {
    addEventListener(type: 'message', listener: (event: MessageEvent<RegexMatchRequest>) => void): void
    postMessage(message: RegexMatchResponse): void
}

const scope = globalThis as unknown as WorkerScope

// A search sends the same pattern with every file, so the last one compiled is kept.
let lastKey: string | null = null
let lastCompiled: CompiledTextQuery | null = null

function compile(request: RegexMatchRequest): CompiledTextQuery {
    const key = JSON.stringify([request.query, request.options])
    if (key !== lastKey || !lastCompiled) {
        lastKey = key
        lastCompiled = compileTextQuery(request.query, request.options)
    }
    return lastCompiled
}

scope.addEventListener('message', (event) => {
    const request = event.data
    const compiled = compile(request)
    if (!compiled.ok) {
        scope.postMessage({ type: 'regex-invalid', id: request.id, error: compiled.error })
        return
    }
    const { matches, longLinesSkipped } = matchText(request.text, compiled.matcher, request.maxHits ?? undefined)
    scope.postMessage({ type: 'regex-matched', id: request.id, matches, longLinesSkipped })
})

// Last, so it's only sent once all the code above has loaded. A worker that fails to load sends no
// error the page can see, so the client waits for this before it posts a file.
scope.postMessage({ type: 'ready' })
