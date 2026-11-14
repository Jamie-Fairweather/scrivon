import { readFileSync } from 'node:fs'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/** A small Windows disk: file names ignore letter case, and a new file is refused where one already is. */
const disk = vi.hoisted(() => {
    const entries = new Map<string, { path: string; bytes?: Uint8Array }>()
    const key = (path: string) => path.replace(/[\\/]+/g, '\\').toLowerCase()
    const parent = (path: string) => key(path).replace(/\\[^\\]*$/, '')
    return {
        entries,
        file(path: string, bytes = new Uint8Array([1])) {
            entries.set(key(path), { path, bytes })
        },
        folder(path: string) {
            entries.set(key(path), { path })
        },
        bytes(path: string) {
            return entries.get(key(path))?.bytes
        },
        names(folder: string) {
            return [...entries.entries()].filter(([k]) => parent(k) === key(folder)).map(([, entry]) => entry.path.replace(/^.*[\\/]/, ''))
        },
        fs: {
            exists: vi.fn(async (path: string) => entries.has(key(path))),
            mkdir: vi.fn(async (path: string) => {
                if (entries.has(key(path))) throw new Error('Cannot create a file when that file already exists. (os error 183)')
                entries.set(key(path), { path })
            }),
            readDir: vi.fn(async (path: string) => {
                const folder = entries.get(key(path))
                if (!folder || folder.bytes) throw new Error('The system cannot find the path specified. (os error 3)')
                return [...entries.entries()]
                    .filter(([k]) => parent(k) === key(path))
                    .map(([, entry]) => ({
                        name: entry.path.replace(/^.*[\\/]/, ''),
                        isDirectory: !entry.bytes,
                        isFile: !!entry.bytes,
                        isSymlink: false,
                    }))
            }),
            writeFile: vi.fn(async (path: string, bytes: Uint8Array, options?: { createNew?: boolean }) => {
                if (options?.createNew && entries.has(key(path))) throw new Error('The file exists. (os error 80)')
                entries.set(key(path), { path, bytes })
            }),
            readFile: vi.fn(async (path: string) => {
                const bytes = entries.get(key(path))?.bytes
                if (!bytes) throw new Error('The system cannot find the file specified. (os error 2)')
                return bytes
            }),
            stat: vi.fn(async (path: string) => ({ isFile: true, isDirectory: false, size: entries.get(key(path))?.bytes?.length ?? 0 })),
            copyFile: vi.fn(async (from: string, to: string) => {
                entries.set(key(to), { path: to, bytes: entries.get(key(from))?.bytes })
            }),
        },
    }
})

vi.mock('@tauri-apps/plugin-fs', () => disk.fs)
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('@/lib/tauri/platform', () => ({ isTauri: () => true }))

const { ImageTooBigError, MAX_IMAGE_BYTES, addDroppedImage, isImageFile, markdownImage, pastedImageName, saveImageInAssets } =
    await import('./image-assets')

const DOC = 'C:\\notes\\guides\\setup.md'
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47])
const TWELVE_MB = 12 * 1024 * 1024

beforeEach(() => {
    disk.entries.clear()
    disk.folder('C:\\notes')
    disk.folder('C:\\notes\\guides')
    disk.file(DOC)
})

describe('markdownImage', () => {
    it('links an image in assets next to the document, named after the file', () => {
        expect(markdownImage(DOC, 'C:\\notes\\guides\\assets\\chart.png')).toBe('![chart](assets/chart.png)')
    })

    it('links an image elsewhere in the folder from the document’s folder, in any letter case', () => {
        expect(markdownImage(DOC, 'C:\\notes\\img\\logo.svg')).toBe('![logo](../img/logo.svg)')
        expect(markdownImage(DOC, 'c:\\Notes\\Guides\\shots\\a.png')).toBe('![a](shots/a.png)')
        expect(markdownImage('/home/me/notes/a.md', '/home/me/pics/b.gif')).toBe('![b](../pics/b.gif)')
    })

    it('writes a name with spaces or link characters so the link still works', () => {
        expect(markdownImage(DOC, 'C:\\notes\\guides\\assets\\My chart (v2) #1 100%.png')).toBe(
            '![My chart (v2) #1 100%](assets/My%20chart%20%28v2%29%20%231%20100%25.png)'
        )
        expect(markdownImage(DOC, 'C:\\notes\\guides\\[draft] é.png')).toBe('![\\[draft\\] é](%5Bdraft%5D%20é.png)')
    })
})

describe('pastedImageName', () => {
    it('names a pasted picture after when it was pasted, with the extension for its type', () => {
        const when = new Date(2026, 10, 3, 9, 5, 7)
        expect(pastedImageName('image/png', when)).toBe('image-20261103-090507.png')
        expect(pastedImageName('image/jpeg', when)).toBe('image-20261103-090507.jpg')
        expect(pastedImageName('IMAGE/WEBP', when)).toBe('image-20261103-090507.webp')
        expect(pastedImageName('image/gif', when)).toBe('image-20261103-090507.gif')
        expect(pastedImageName('image/svg+xml', when)).toBe('image-20261103-090507.svg')
    })

    it('has no name for a picture the preview can’t show', () => {
        expect(pastedImageName('image/bmp', new Date())).toBeNull()
        expect(pastedImageName('image/tiff', new Date())).toBeNull()
        expect(pastedImageName('text/plain', new Date())).toBeNull()
    })
})

describe('isImageFile', () => {
    it('knows the pictures the preview shows by their extension', () => {
        for (const name of ['a.png', 'B.JPG', 'c.jpeg', 'd.gif', 'e.webp', 'C:\\x\\f.svg']) expect(isImageFile(name)).toBe(true)
        for (const name of ['a.bmp', 'b.md', 'png', 'C:\\pics', 'a.png.txt']) expect(isImageFile(name)).toBe(false)
    })
})

describe('saveImageInAssets', () => {
    it('saves the image in an assets folder next to the document, making the folder', async () => {
        const path = await saveImageInAssets(DOC, 'image.png', PNG)

        expect(path).toBe('C:\\notes\\guides\\assets\\image.png')
        expect(disk.bytes(path)).toEqual(PNG)
    })

    it('never replaces an image already there, whatever its letter case', async () => {
        disk.folder('C:\\notes\\guides\\assets')
        disk.file('C:\\notes\\guides\\assets\\IMAGE.png', new Uint8Array([7]))
        disk.file('C:\\notes\\guides\\assets\\image 2.png', new Uint8Array([8]))

        const path = await saveImageInAssets(DOC, 'image.png', PNG)

        expect(path).toBe('C:\\notes\\guides\\assets\\image 3.png')
        expect(disk.bytes(path)).toEqual(PNG)
        expect(disk.bytes('C:\\notes\\guides\\assets\\IMAGE.png')).toEqual(new Uint8Array([7]))
        expect(disk.bytes('C:\\notes\\guides\\assets\\image 2.png')).toEqual(new Uint8Array([8]))
    })

    it('uses an assets folder already there under its own letter case, so the link matches it', async () => {
        disk.folder('C:\\notes\\guides\\Assets')

        const path = await saveImageInAssets(DOC, 'image.png', PNG)

        expect(path).toBe('C:\\notes\\guides\\Assets\\image.png')
        expect(markdownImage(DOC, path)).toBe('![image](Assets/image.png)')
        expect(disk.names('C:\\notes\\guides').sort()).toEqual(['Assets', 'setup.md'])
    })

    it('picks another name when another app takes the free one first, keeping its file', async () => {
        const write = disk.fs.writeFile.getMockImplementation()!
        disk.fs.writeFile.mockImplementationOnce(async (path, bytes, options) => {
            disk.file(path, new Uint8Array([9]))
            return write(path, bytes, options)
        })

        const path = await saveImageInAssets(DOC, 'image.png', PNG)

        expect(path).toBe('C:\\notes\\guides\\assets\\image 2.png')
        expect(disk.bytes(path)).toEqual(PNG)
        expect(disk.bytes('C:\\notes\\guides\\assets\\image.png')).toEqual(new Uint8Array([9]))
    })

    it('says why the image couldn’t be saved', async () => {
        disk.fs.writeFile.mockRejectedValueOnce(new Error('Access is denied. (os error 5)'))

        await expect(saveImageInAssets(DOC, 'image.png', PNG)).rejects.toThrow('Access is denied.')
        disk.file('C:\\notes\\guides\\assets.png')
        disk.file('C:\\notes\\other\\assets')
        disk.file('C:\\notes\\other\\a.md')
        await expect(saveImageInAssets('C:\\notes\\other\\a.md', 'image.png', PNG)).rejects.toThrow('cannot find the path')
    })

    it('refuses an image over 12 MB, which the preview couldn’t show, before writing anything', async () => {
        const refused = saveImageInAssets(DOC, 'image.png', new Uint8Array(TWELVE_MB + 1))
        await expect(refused).rejects.toThrow('image.png is over 12 MB, too big for the preview and exports.')
        // A notice for the user to act on, not a fault to log.
        await expect(refused).rejects.toBeInstanceOf(ImageTooBigError)
        expect(disk.names('C:\\notes\\guides')).toEqual(['setup.md'])

        expect(await saveImageInAssets(DOC, 'image.png', new Uint8Array(TWELVE_MB))).toBe('C:\\notes\\guides\\assets\\image.png')
    })
})

describe('MAX_IMAGE_BYTES', () => {
    it('is the most the preview and exports read (MAX_EXPORT_IMAGE_BYTES in src-tauri/src/pdf_export.rs)', () => {
        const rust = readFileSync(path.resolve(__dirname, '../../src-tauri/src/pdf_export.rs'), 'utf8')
        const [, megabytes] = /MAX_EXPORT_IMAGE_BYTES: usize = (\d+) \* 1024 \* 1024;/.exec(rust)!

        expect(MAX_IMAGE_BYTES).toBe(Number(megabytes) * 1024 * 1024)
    })
})

describe('addDroppedImage', () => {
    const doc = { path: DOC, workspaceRoot: 'C:\\notes' }

    it('copies an image from outside the open folder into assets, keeping its name', async () => {
        disk.file('D:\\Pictures\\cat.png', PNG)

        const path = await addDroppedImage('D:\\Pictures\\cat.png', doc)

        expect(path).toBe('C:\\notes\\guides\\assets\\cat.png')
        expect(disk.bytes(path)).toEqual(PNG)
        expect(disk.bytes('D:\\Pictures\\cat.png')).toEqual(PNG)
    })

    it('copies under the next free name rather than replace an image with the same name', async () => {
        disk.folder('C:\\notes\\guides\\assets')
        disk.file('C:\\notes\\guides\\assets\\cat.png', new Uint8Array([7]))
        disk.file('D:\\Pictures\\cat.png', PNG)

        const path = await addDroppedImage('D:\\Pictures\\cat.png', doc)

        expect(path).toBe('C:\\notes\\guides\\assets\\cat 2.png')
        expect(disk.bytes(path)).toEqual(PNG)
        expect(disk.bytes('C:\\notes\\guides\\assets\\cat.png')).toEqual(new Uint8Array([7]))
    })

    it('uses an image already in the open folder where it is', async () => {
        disk.file('C:\\Notes\\img\\cat.png', PNG)

        expect(await addDroppedImage('C:\\Notes\\img\\cat.png', doc)).toBe('C:\\Notes\\img\\cat.png')
        expect(disk.names('C:\\notes\\guides')).toEqual(['setup.md'])
    })

    it('refuses an image over 12 MB, from outside the folder or in it, rather than link one the preview couldn’t show', async () => {
        disk.file('D:\\Pictures\\photo.jpg', new Uint8Array(TWELVE_MB + 1))
        disk.file('C:\\notes\\img\\scan.png', new Uint8Array(TWELVE_MB + 1))

        await expect(addDroppedImage('D:\\Pictures\\photo.jpg', doc)).rejects.toThrow('photo.jpg is over 12 MB, too big for the preview and exports.')
        await expect(addDroppedImage('C:\\notes\\img\\scan.png', doc)).rejects.toThrow('scan.png is over 12 MB, too big for the preview and exports.')
        expect(disk.names('C:\\notes\\guides')).toEqual(['setup.md'])
    })
})
