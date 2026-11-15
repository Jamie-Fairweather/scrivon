import { describe, expect, it } from 'vitest'
import { manifestProblems } from './patch-updater-manifest.mjs'

/** A signature the way tauri signer writes one: base64 of the minisign text, which names the signed file. */
function signature(file: string): string {
    const text = [
        'untrusted comment: signature from tauri secret key',
        'RUQuaEVFfi7qKG0/6Vd6iSYYz9Mh9kP1doeEcoC08rfSMDAavpd8oThLRQD8+TfNMn9FXRXeXZW1gT47FFFolVXVNeYR1zS7AwE=',
        `trusted comment: timestamp:1794095274\tfile:${file}\tversion:1.6.0`,
        'Wauu0qTnaq3gV0rlvVRnCDat/l2aaQcfXszW4wu5JUg5v4SfmuoFPnBWY5ST78m1JNqzIVh3LNPCzl+ntOqiCg==',
        '',
    ].join('\n')
    return Buffer.from(text).toString('base64')
}

function entry(file: string, asset: number) {
    return { signature: signature(file), url: `https://api.github.com/repos/Jamie-Fairweather/scrivon/releases/assets/${asset}` }
}

/** latest.json after both Windows builds of 1.6.0 added their installers. */
function combinedManifest() {
    return {
        version: '1.6.0',
        notes: '',
        pub_date: '2026-11-13T10:00:00.000Z',
        platforms: {
            'windows-x86_64': entry('Scrivon_1.6.0_x64-setup.exe', 1),
            'windows-x86_64-nsis': entry('Scrivon_1.6.0_x64-setup.exe', 1),
            'windows-aarch64': entry('Scrivon_1.6.0_arm64-setup.exe', 2),
            'windows-aarch64-nsis': entry('Scrivon_1.6.0_arm64-setup.exe', 2),
        },
    }
}

describe('manifestProblems', () => {
    it('accepts a manifest with both Windows installers of this version', () => {
        expect(manifestProblems(combinedManifest(), '1.6.0')).toEqual([])
        expect(manifestProblems(combinedManifest(), 'v1.6.0')).toEqual([])
    })

    it('reports an architecture whose build was overwritten or never added', () => {
        const manifest = combinedManifest()
        delete (manifest.platforms as Partial<typeof manifest.platforms>)['windows-aarch64']
        delete (manifest.platforms as Partial<typeof manifest.platforms>)['windows-aarch64-nsis']

        expect(manifestProblems(manifest, '1.6.0')).toEqual(['windows-aarch64 is missing', 'windows-aarch64-nsis is missing'])
    })

    it('reports an entry that points at another version or architecture', () => {
        const manifest = combinedManifest()
        manifest.platforms['windows-x86_64-nsis'] = entry('Scrivon_1.5.0_x64-setup.exe', 3)
        manifest.platforms['windows-aarch64'] = entry('Scrivon_1.6.0_x64-setup.exe', 1)

        expect(manifestProblems(manifest, '1.6.0')).toEqual([
            'windows-x86_64-nsis is signed for Scrivon_1.5.0_x64-setup.exe, not the 1.6.0 x64 installer',
            'windows-aarch64 is signed for Scrivon_1.6.0_x64-setup.exe, not the 1.6.0 arm64 installer',
        ])
    })

    it('reports a manifest for another version', () => {
        expect(manifestProblems({ ...combinedManifest(), version: '1.5.0' }, '1.6.0')).toEqual(['version is 1.5.0, not 1.6.0'])
    })
})
