import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const repoRoot = resolve(__dirname, '..')

type Security = { csp: unknown; dangerousDisableAssetCspModification?: unknown }

function security(): Security {
    const config = JSON.parse(readFileSync(join(repoRoot, 'src-tauri', 'tauri.conf.json'), 'utf8')) as { app: { security: Security } }
    return config.app.security
}

/** The sources of one directive of the main window's Content Security Policy. */
function sources(directive: string): string[] {
    const csp = security().csp as Record<string, string | string[]>
    const value = csp[directive] ?? []
    return (Array.isArray(value) ? value : value.split(/\s+/)).filter(Boolean)
}

function appSourceFiles(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const path = join(dir, entry.name)
        if (entry.isDirectory()) return appSourceFiles(path)
        return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : []
    })
}

describe("the main window's Content Security Policy", () => {
    it('is turned on, so a script slipped into a document cannot run or load code from anywhere', () => {
        expect(security().csp).toEqual(expect.any(Object))
        expect(sources('default-src')).toEqual(["'self'"])
        expect(sources('object-src')).toEqual(["'none'"])
        expect(sources('base-uri')).toEqual(["'self'"])
        expect(sources('form-action')).toEqual(["'none'"])
    })

    it('runs only the app’s own scripts, plus the WebAssembly Shiki highlights code with', () => {
        const script = sources('script-src')
        expect(script).toEqual(expect.arrayContaining(["'self'", "'wasm-unsafe-eval'"]))
        expect(script).not.toContain("'unsafe-inline'")
        expect(script).not.toContain("'unsafe-eval'")
        // Tauri adds the hashes of the page's own inline scripts (the theme script, Next's data) to script-src.
        expect(security().dangerousDisableAssetCspModification).not.toBe(true)
        expect(security().dangerousDisableAssetCspModification).not.toContain('script-src')
    })

    it('lets Monaco and diagrams add their own styles', () => {
        expect(sources('style-src')).toEqual(expect.arrayContaining(["'self'", "'unsafe-inline'"]))
        // Hashes added by Tauri would make the browser ignore 'unsafe-inline'.
        expect(security().dangerousDisableAssetCspModification).toEqual(['style-src'])
    })

    it('allows the editor and diagram workers, the bundled fonts and exported pictures', () => {
        expect(sources('worker-src')).toContain("'self'")
        expect(sources('font-src')).toContain("'self'")
        // PNG export draws the diagram from a blob: URL; documents can hold data: images.
        expect(sources('img-src')).toEqual(expect.arrayContaining(["'self'", 'data:', 'blob:']))
    })

    it('lets the page talk to the app and to every web address the app fetches', () => {
        const connect = sources('connect-src')
        expect(connect).toEqual(expect.arrayContaining(["'self'", 'ipc:', 'http://ipc.localhost']))

        const fetched = new Set<string>()
        for (const file of ['app', 'components', 'hooks', 'lib'].flatMap((dir) => appSourceFiles(join(repoRoot, dir)))) {
            for (const [, origin] of readFileSync(file, 'utf8').matchAll(/fetch\(\s*[`'"](https?:\/\/[^/`'"$]+)/g)) fetched.add(origin!)
        }
        expect([...fetched]).toContain('https://api.github.com')
        for (const origin of fetched) expect(connect).toContain(origin)
    })
})
