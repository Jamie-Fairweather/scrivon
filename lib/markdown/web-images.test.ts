import { describe, expect, it } from 'vitest'
import { isExportWebImageUrl, isWebImageUrl } from './web-images'

describe('isWebImageUrl', () => {
    const windowsApp = 'http://tauri.localhost/'
    const macApp = 'tauri://localhost'

    it('reads the address the way the webview does, however it is spelled', () => {
        for (const page of [windowsApp, macApp]) {
            for (const src of ['https://evil.example/x.png', 'HTTPS://Evil.example/x.png', 'https:evil.example/x.png', 'https:/evil.example/x.png']) {
                expect({ page, src, web: isWebImageUrl(src, page) }).toEqual({ page, src, web: true })
            }
        }
        expect(isWebImageUrl('//badges.example/build.svg', windowsApp)).toBe(true)
        // Another scheme than the page's is read as absolute: http://evil.example/x.png.
        expect(isWebImageUrl('http:evil.example/x.png', macApp)).toBe(true)
    })

    it('leaves the app’s own addresses alone', () => {
        for (const page of [windowsApp, macApp]) {
            for (const src of ['./diagram.png', 'img/a.png', '/a.png', '%5C%5Cserver%5Cx.png', '']) {
                expect({ page, src, web: isWebImageUrl(src, page) }).toEqual({ page, src, web: false })
            }
        }
        // The same scheme as the page is read as a path on the page's own site.
        expect(isWebImageUrl('http:evil.example/x.png', windowsApp)).toBe(false)
        expect(isWebImageUrl('http://tauri.localhost/a.png', windowsApp)).toBe(false)
        expect(isWebImageUrl('C:%5Cpics%5Ca.png', windowsApp)).toBe(false)
    })

    it('blocks what it can’t read', () => {
        expect(isWebImageUrl('x.png', 'not a url')).toBe(true)
        expect(isWebImageUrl('http://[bad/x.png', windowsApp)).toBe(true)
    })
})

describe('isExportWebImageUrl', () => {
    it('catches every spelling that either export page would fetch from the web', () => {
        for (const src of [
            'https://evil.example/x.png',
            'HTTPS://Evil.example/x.png',
            'https:evil.example/x.png',
            // Inside the app this is a path on the app's own site, but the Windows export page fetches it from evil.example.
            'http:evil.example/x.png',
            '//badges.example/build.svg',
            'http://[bad/x.png',
        ]) {
            expect({ src, web: isExportWebImageUrl(src) }).toEqual({ src, web: true })
        }
    })

    it('leaves relative paths and data: URLs alone', () => {
        for (const src of ['./diagram.png', 'img/a.png', '/a.png', '%5C%5Cserver%5Cx.png', 'C:%5Cpics%5Ca.png', 'data:image/png;base64,AAAA', '']) {
            expect({ src, web: isExportWebImageUrl(src) }).toEqual({ src, web: false })
        }
    })
})
