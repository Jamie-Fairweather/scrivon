// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DragDropEvent } from '@tauri-apps/api/webview'

type DropListener = (event: { payload: DragDropEvent }) => void | Promise<void>

const webview = vi.hoisted(() => ({
    listener: null as DropListener | null,
    unlisten: vi.fn(),
}))
let inTauri = true

vi.mock('@tauri-apps/api/webview', () => ({
    getCurrentWebview: () => ({
        onDragDropEvent: async (listener: DropListener) => {
            webview.listener = listener
            return webview.unlisten
        },
    }),
}))
vi.mock('@/lib/tauri/platform', () => ({ isTauri: () => inTauri }))

const { listenForFileDrops, registerFileDropTarget } = await import('./file-drop')

/** What Windows sends when files are dropped `at` (physical pixels) on the window. */
async function drop(paths: string[], at = { x: 0, y: 0 }) {
    await webview.listener?.({ payload: { type: 'drop', paths, position: { x: at.x, y: at.y } as never } })
}

let hit: Element | null = null
const stops: Array<() => void> = []

beforeEach(() => {
    inTauri = true
    webview.listener = null
    document.body.innerHTML = '<main id="layout"><section id="editor"><p id="text"></p></section></main>'
    hit = document.getElementById('text')
    document.elementFromPoint = vi.fn(() => hit)
})

afterEach(() => {
    stops.splice(0).forEach((stop) => stop())
})

describe('file drops', () => {
    it('go to the drop target under them, which says which files it leaves for the window', async () => {
        const onRest = vi.fn()
        const editor = vi.fn(({ paths }: { paths: readonly string[] }) => paths.filter((p) => !p.endsWith('.png')))
        stops.push(registerFileDropTarget(document.getElementById('editor')!, editor))
        stops.push(await listenForFileDrops(onRest))

        await drop(['D:\\cat.png', 'D:\\notes.md'])

        expect(editor).toHaveBeenCalledWith(expect.objectContaining({ paths: ['D:\\cat.png', 'D:\\notes.md'] }))
        expect(onRest).toHaveBeenCalledWith(expect.objectContaining({ paths: ['D:\\notes.md'] }))
    })

    it('say where they landed in page pixels, on a scaled screen too', async () => {
        const editor = vi.fn(() => [])
        stops.push(registerFileDropTarget(document.getElementById('editor')!, editor))
        stops.push(await listenForFileDrops(vi.fn()))
        vi.stubGlobal('devicePixelRatio', 1.5)

        await drop(['D:\\cat.png'], { x: 300, y: 150 })

        vi.unstubAllGlobals()
        expect(document.elementFromPoint).toHaveBeenCalledWith(200, 100)
        expect(editor).toHaveBeenCalledWith({ paths: ['D:\\cat.png'], x: 200, y: 100 })
    })

    it('all go to the window when no target is under them, or every file was taken', async () => {
        const onRest = vi.fn()
        stops.push(registerFileDropTarget(document.getElementById('editor')!, () => []))
        stops.push(await listenForFileDrops(onRest))

        hit = document.getElementById('layout')
        await drop(['D:\\a.md'])
        expect(onRest).toHaveBeenCalledWith(expect.objectContaining({ paths: ['D:\\a.md'] }))

        onRest.mockClear()
        hit = document.getElementById('text')
        await drop(['D:\\a.md'])
        expect(onRest).not.toHaveBeenCalled()
    })

    it('pass from an inner target to the one around it', async () => {
        const order: string[] = []
        stops.push(
            registerFileDropTarget(document.getElementById('editor')!, ({ paths }) => {
                order.push(`editor:${paths.join()}`)
                return paths.slice(1)
            })
        )
        stops.push(
            registerFileDropTarget(document.getElementById('layout')!, ({ paths }) => {
                order.push(`layout:${paths.join()}`)
                return paths
            })
        )
        stops.push(await listenForFileDrops(vi.fn()))

        await drop(['a', 'b'])

        expect(order).toEqual(['editor:a,b', 'layout:b'])
    })

    it('wait for a target to finish before passing on what it left', async () => {
        const onRest = vi.fn()
        let finish: (rest: string[]) => void = () => {}
        stops.push(registerFileDropTarget(document.getElementById('editor')!, () => new Promise((resolve) => (finish = resolve))))
        stops.push(await listenForFileDrops(onRest))

        const dropped = drop(['D:\\cat.png', 'D:\\notes.md'])
        await Promise.resolve()
        expect(onRest).not.toHaveBeenCalled()

        finish(['D:\\notes.md'])
        await dropped
        expect(onRest).toHaveBeenCalledWith(expect.objectContaining({ paths: ['D:\\notes.md'] }))
    })

    it('stop reaching a target once it is taken away', async () => {
        const onRest = vi.fn()
        const editor = vi.fn(() => [])
        registerFileDropTarget(document.getElementById('editor')!, editor)()
        stops.push(await listenForFileDrops(onRest))

        await drop(['D:\\cat.png'])

        expect(editor).not.toHaveBeenCalled()
        expect(onRest).toHaveBeenCalled()
    })

    it('tell a target where files being dragged are over it, and when they leave it or are dropped', async () => {
        const onHover = vi.fn()
        stops.push(registerFileDropTarget(document.getElementById('editor')!, () => [], onHover))
        stops.push(await listenForFileDrops(vi.fn()))
        vi.stubGlobal('devicePixelRatio', 2)
        const send = (payload: DragDropEvent) => webview.listener?.({ payload })

        await send({ type: 'enter', paths: ['D:\\a.md'], position: { x: 20, y: 40 } as never })
        expect(onHover).toHaveBeenLastCalledWith({ x: 10, y: 20 })
        await send({ type: 'over', position: { x: 40, y: 40 } as never })
        expect(onHover).toHaveBeenLastCalledWith({ x: 20, y: 20 })

        hit = document.getElementById('layout')
        await send({ type: 'over', position: { x: 0, y: 0 } as never })
        expect(onHover).toHaveBeenLastCalledWith(null)

        hit = document.getElementById('text')
        await send({ type: 'over', position: { x: 0, y: 0 } as never })
        await send({ type: 'leave' })
        expect(onHover).toHaveBeenLastCalledWith(null)

        await send({ type: 'over', position: { x: 0, y: 0 } as never })
        await drop(['D:\\a.md'])
        expect(onHover).toHaveBeenLastCalledWith(null)
        vi.unstubAllGlobals()
    })

    it('ignore files only dragged over the window', async () => {
        const onRest = vi.fn()
        stops.push(await listenForFileDrops(onRest))

        webview.listener?.({ payload: { type: 'enter', paths: ['D:\\a.md'], position: { x: 0, y: 0 } as never } })
        webview.listener?.({ payload: { type: 'over', position: { x: 0, y: 0 } as never } })
        webview.listener?.({ payload: { type: 'leave' } })
        await drop([])

        expect(onRest).not.toHaveBeenCalled()
    })

    it('are only listened for in the desktop app, and stop when asked', async () => {
        inTauri = false
        const stop = await listenForFileDrops(vi.fn())
        expect(webview.listener).toBeNull()
        stop()

        inTauri = true
        ;(await listenForFileDrops(vi.fn()))()
        expect(webview.unlisten).toHaveBeenCalled()
    })
})
