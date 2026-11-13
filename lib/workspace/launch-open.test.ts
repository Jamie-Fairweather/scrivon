import { describe, expect, it } from 'vitest'
import type { LaunchPath } from '@/lib/tauri/launch'
import { planLaunchOpen } from './launch-open'

const file = (path: string): LaunchPath => ({ path, isFolder: false })
const folder = (path: string): LaunchPath => ({ path, isFolder: true })

describe('planLaunchOpen', () => {
    it('does nothing when there is nothing to open', () => {
        expect(planLaunchOpen([], 'C:\\ws')).toEqual({ folder: null, files: [], skipped: [] })
    })

    it("opens a file's own folder, even a whole drive", () => {
        expect(planLaunchOpen([file('C:\\notes.md')], null)).toEqual({ folder: 'C:\\', files: ['C:\\notes.md'], skipped: [] })
    })

    it('stays in the open folder for a file anywhere inside it', () => {
        expect(planLaunchOpen([file('c:/WS/docs/a.md')], 'C:\\ws')).toEqual({ folder: null, files: ['c:/WS/docs/a.md'], skipped: [] })
    })

    it('opens a folder named while another is open, even one inside it', () => {
        expect(planLaunchOpen([folder('C:\\ws\\docs')], 'C:\\ws')).toEqual({ folder: 'C:\\ws\\docs', files: [], skipped: [] })
    })

    it('leaves out other folders, and files outside the folder it opens', () => {
        expect(planLaunchOpen([folder('/home/me/notes'), file('/home/me/notes/a.md'), folder('/tmp'), file('/home/me/b.md')], null)).toEqual({
            folder: '/home/me/notes',
            files: ['/home/me/notes/a.md'],
            skipped: ['/tmp', '/home/me/b.md'],
        })
    })
})
