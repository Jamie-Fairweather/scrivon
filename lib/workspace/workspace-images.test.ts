import { beforeEach, describe, expect, it, vi } from 'vitest'

const invoke = vi.hoisted(() => vi.fn())
const isTauri = vi.hoisted(() => vi.fn(() => true))

vi.mock('@tauri-apps/api/core', () => ({ invoke }))
vi.mock('@/lib/tauri/platform', () => ({ isTauri }))

const { cachedWorkspaceImage, forgetWorkspaceImages, readWorkspaceImage, resolveDocumentImage, subscribeWorkspaceImages, workspaceImageVersion } =
    await import('./workspace-images')

const ROOT = 'C:\\notes'
const DOC = 'C:\\notes\\guides\\setup.md'
const inFolder = { documentPath: DOC, workspaceRoot: ROOT }

describe('resolveDocumentImage', () => {
    it('finds an image next to the document, below it and above it', () => {
        expect(resolveDocumentImage('diagram.png', inFolder)).toEqual({ kind: 'file', path: 'C:\\notes\\guides\\diagram.png' })
        expect(resolveDocumentImage('./img/a.png', inFolder)).toEqual({ kind: 'file', path: 'C:\\notes\\guides\\img\\a.png' })
        expect(resolveDocumentImage('../img/a.png', inFolder)).toEqual({ kind: 'file', path: 'C:\\notes\\img\\a.png' })
    })

    it('reads a path the Markdown parser percent-encoded, without its ?query or #fragment', () => {
        expect(resolveDocumentImage('my%20chart%C3%A9.png?v=2#x', inFolder)).toEqual({ kind: 'file', path: 'C:\\notes\\guides\\my charté.png' })
        expect(resolveDocumentImage('img%5Ca.png', inFolder)).toEqual({ kind: 'file', path: 'C:\\notes\\guides\\img\\a.png' })
    })

    it('takes absolute Windows paths, with either slash, and `/` paths from the open folder', () => {
        expect(resolveDocumentImage('C:%5Cnotes%5Cpics%5Ccat.jpg', inFolder)).toEqual({ kind: 'file', path: 'C:\\notes\\pics\\cat.jpg' })
        expect(resolveDocumentImage('c:/Notes/pics/cat.jpg', inFolder)).toEqual({ kind: 'file', path: 'c:\\Notes\\pics\\cat.jpg' })
        expect(resolveDocumentImage('/pics/cat.jpg', inFolder)).toEqual({ kind: 'file', path: 'C:\\notes\\pics\\cat.jpg' })
    })

    it('never names a file outside the open folder for reading', () => {
        const outside = { kind: 'blocked', reason: 'Only images inside the open folder are shown.' }
        expect(resolveDocumentImage('../../secret.png', inFolder)).toEqual(outside)
        expect(resolveDocumentImage('D:/photos/me.jpg', inFolder)).toEqual(outside)
        expect(resolveDocumentImage('C:/notes-old/a.png', inFolder)).toEqual(outside)
        expect(resolveDocumentImage('a.png', { documentPath: DOC, workspaceRoot: null })).toEqual(outside)
    })

    it('says why a document that isn’t on disk, or a network path, shows no picture', () => {
        expect(resolveDocumentImage('a.png', { documentPath: null, workspaceRoot: ROOT })).toEqual({
            kind: 'blocked',
            reason: 'Save the document in the open folder to show its images.',
        })
        expect(resolveDocumentImage('\\\\server\\share\\a.png', inFolder)).toEqual({
            kind: 'blocked',
            reason: 'Images on other computers aren’t shown.',
        })
        for (const url of ['ftp://example.com/a.png', 'mailto:me@example.com']) {
            expect(resolveDocumentImage(url, inFolder)).toEqual({ kind: 'blocked', reason: 'This kind of image address isn’t supported.' })
        }
        expect(resolveDocumentImage('', inFolder)).toEqual({ kind: 'blocked', reason: 'The image has no address.' })
    })

    it('leaves web addresses and inline pictures as they are', () => {
        for (const url of ['https://example.com/a.png', 'data:image/png;base64,AAAA', 'blob:http://tauri.localhost/1']) {
            expect(resolveDocumentImage(url, inFolder)).toEqual({ kind: 'url', url })
        }
    })
})

describe('readWorkspaceImage', () => {
    beforeEach(() => {
        invoke.mockReset()
        isTauri.mockReturnValue(true)
    })

    it('asks the app for an image in the open folder once, then keeps it', async () => {
        invoke.mockResolvedValue('data:image/png;base64,AAAA')
        const path = 'C:\\notes\\keep.png'

        await expect(readWorkspaceImage(path, ROOT)).resolves.toBe('data:image/png;base64,AAAA')
        expect(invoke).toHaveBeenCalledWith('read_workspace_image', { root: ROOT, path })
        expect(cachedWorkspaceImage(path)).toBe('data:image/png;base64,AAAA')
        // The same file however it is spelled.
        await expect(readWorkspaceImage('c:/NOTES/keep.png', ROOT)).resolves.toBe('data:image/png;base64,AAAA')
        expect(cachedWorkspaceImage('C:/notes/KEEP.png')).toBe('data:image/png;base64,AAAA')
        expect(invoke).toHaveBeenCalledTimes(1)
    })

    it('tries a failed image again next time, with the app’s reason', async () => {
        invoke.mockRejectedValueOnce('Image not found.').mockResolvedValueOnce('data:image/png;base64,BBBB')
        const path = 'C:\\notes\\later.png'

        await expect(readWorkspaceImage(path, ROOT)).rejects.toThrow('Image not found.')
        expect(cachedWorkspaceImage(path)).toBeUndefined()
        await expect(readWorkspaceImage(path, ROOT)).resolves.toBe('data:image/png;base64,BBBB')
    })

    it('says images need the desktop app', async () => {
        isTauri.mockReturnValue(false)
        await expect(readWorkspaceImage('C:\\notes\\web.png', ROOT)).rejects.toThrow('Images from the folder only show in the desktop app.')
        expect(invoke).not.toHaveBeenCalled()
    })

    it('reads an image again once it changes on disk, and tells whoever shows it', async () => {
        invoke.mockResolvedValueOnce('data:image/png;base64,OLD').mockResolvedValueOnce('data:image/png;base64,NEW')
        const path = 'C:\\notes\\changes.png'
        const listener = vi.fn()
        const stop = subscribeWorkspaceImages(listener)
        await readWorkspaceImage(path, ROOT)
        const version = workspaceImageVersion(path)

        forgetWorkspaceImages(['C:\\notes\\other.md'])
        expect(listener).not.toHaveBeenCalled()
        expect(workspaceImageVersion(path)).toBe(version)

        forgetWorkspaceImages(['c:\\NOTES\\changes.png'])
        expect(listener).toHaveBeenCalledTimes(1)
        expect(workspaceImageVersion(path)).toBe(version + 1)
        expect(cachedWorkspaceImage(path)).toBeUndefined()
        await expect(readWorkspaceImage(path, ROOT)).resolves.toBe('data:image/png;base64,NEW')

        stop()
        forgetWorkspaceImages([path])
        expect(listener).toHaveBeenCalledTimes(1)
    })

    it('forgets every image inside a folder that changed, and ones that failed to load', async () => {
        invoke.mockResolvedValueOnce('data:image/png;base64,A').mockRejectedValueOnce('Image not found.')
        const shown = 'C:\\notes\\moved\\a.png'
        const missing = 'C:\\notes\\moved\\deep\\b.png'
        await readWorkspaceImage(shown, ROOT)
        await readWorkspaceImage(missing, ROOT).catch(() => undefined)
        const before = [workspaceImageVersion(shown), workspaceImageVersion(missing)]

        forgetWorkspaceImages(['C:\\notes\\moved'])

        expect([workspaceImageVersion(shown), workspaceImageVersion(missing)]).toEqual(before.map((v) => v + 1))
        expect(cachedWorkspaceImage(shown)).toBeUndefined()
    })

    it('keeps the images used most recently when they take too much memory', async () => {
        const big = (letter: string) => `data:image/png;base64,${letter.repeat(24_000_000)}`
        invoke.mockImplementation(async (_command: string, { path }: { path: string }) => big(path.at(-5)!))
        await readWorkspaceImage('C:\\notes\\a.png', ROOT)
        await readWorkspaceImage('C:\\notes\\b.png', ROOT)
        // Used again, so it is now the newest.
        await readWorkspaceImage('C:\\notes\\a.png', ROOT)
        await readWorkspaceImage('C:\\notes\\c.png', ROOT)

        expect(cachedWorkspaceImage('C:\\notes\\a.png')).toBeDefined()
        expect(cachedWorkspaceImage('C:\\notes\\b.png')).toBeUndefined()
        expect(cachedWorkspaceImage('C:\\notes\\c.png')).toBeDefined()
    })
})
