import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { LinkUpdateDialog } from '@/components/studio/dialogs/link-update-provider'
import type { LinkRewrite } from '@/lib/workspace/link-rewrite'
import type { LinkUpdateFile, LinkUpdateScan } from '@/lib/workspace/link-update'

vi.mock('@/components/studio/workspace/workspace-provider', () => ({
    useWorkspaceSession: () => ({ workspaceRoot: 'C:\\ws' }),
    useWorkspaceCoordinator: () => ({}),
}))

/** Lets the dialog finish opening or closing: it waits an animation frame. */
const settle = () =>
    act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50))
    })

const rewrite = (oldAddress: string, newAddress: string, line = 1, start = line * 100): LinkRewrite => ({
    span: { start, end: start + oldAddress.length },
    text: newAddress,
    oldAddress,
    newAddress,
    line,
})

const fileWith = (path: string, rewrites: LinkRewrite[]): LinkUpdateFile => ({ path, oldPath: path, rewrites, signature: '' })

function scanOf(overrides: Partial<LinkUpdateScan> = {}): LinkUpdateScan {
    return {
        move: { root: 'C:\\ws', oldPath: 'C:\\ws\\docs\\setup.md', newPath: 'C:\\ws\\guides\\setup.md', isDirectory: false, tree: [] },
        files: [
            fileWith('C:\\ws\\README.md', [rewrite('docs/setup.md#install', 'guides/setup.md#install', 3)]),
            fileWith('C:\\ws\\notes\\todo.md', [
                rewrite('../docs/setup.md', '../guides/setup.md', 1),
                rewrite('<../docs/setup.md>', '<../guides/setup.md>', 9),
            ]),
        ],
        blocked: [],
        unchecked: 0,
        partialTree: false,
        targetExists: async () => true,
        ...overrides,
    }
}

async function show(scan: LinkUpdateScan) {
    const onAnswer = vi.fn()
    render(<LinkUpdateDialog open scan={scan} onAnswer={onAnswer} />)
    await settle()
    return { onAnswer, dialog: screen.getByRole('alertdialog') }
}

describe('LinkUpdateDialog', () => {
    it('names the move, and lists each file with each link’s old and new address', async () => {
        const { dialog } = await show(scanOf())

        expect(dialog).toHaveAccessibleName('Update links?')
        expect(dialog).toHaveAccessibleDescription('Moving setup.md breaks 3 links in 2 files. Update them to the new place?')
        const list = within(dialog).getByRole('region', { name: 'Links to update' })
        const files = within(list)
            .getAllByRole('listitem')
            .filter((item) => item.parentElement?.parentElement === list)
        expect(files.map((item) => item.firstChild?.textContent)).toEqual(['README.md', 'notes\\todo.md'])
        // Read out as "docs/setup.md becomes guides/setup.md"; the arrow is only for the eye.
        expect(within(files[0]!).getByText('becomes')).toHaveClass('sr-only')
        expect(within(files[0]!).getByText('→')).toHaveAttribute('aria-hidden', 'true')
        expect(files[1]).toHaveTextContent('Line 9:<../docs/setup.md>→becomes<../guides/setup.md>')
    })

    it('says "Renaming" for a rename in place, and "it" for one link', async () => {
        const { dialog } = await show(
            scanOf({
                move: { root: 'C:\\ws', oldPath: 'C:\\ws\\docs\\setup.md', newPath: 'C:\\ws\\docs\\install.md', isDirectory: false, tree: [] },
                files: [fileWith('C:\\ws\\README.md', [rewrite('docs/setup.md', 'docs/install.md')])],
            })
        )
        expect(dialog).toHaveAccessibleDescription('Renaming setup.md breaks 1 link in 1 file. Update it to the new place?')
    })

    it('says which files won’t change and why, and when some files weren’t checked', async () => {
        const { dialog } = await show(
            scanOf({
                blocked: [
                    { path: 'C:\\ws\\old.md', reason: 'encoding', file: fileWith('C:\\ws\\old.md', [rewrite('docs/setup.md', 'guides/setup.md')]) },
                ],
                unchecked: 2,
                partialTree: true,
            })
        )
        expect(dialog).toHaveAccessibleDescription(
            [
                'Moving setup.md breaks 3 links in 2 files. Update them to the new place?',
                "old.md links to it too, but won't change: it isn't saved as UTF-8 or UTF-16, so Scrivon only reads it.",
                "Some files weren't checked: 2 files were too big or couldn't be read, and Scrivon didn't list every file in this folder.",
            ].join(' ')
        )
    })

    it('lists at most 200 links and counts the rest under their file', async () => {
        const many = Array.from({ length: 250 }, (_, i) => rewrite(`a${i}.md`, `b/a${i}.md`, i + 1))
        const { dialog } = await show(scanOf({ files: [fileWith('C:\\ws\\index.md', many)] }))
        expect(within(dialog).getAllByText('becomes')).toHaveLength(200)
        expect(dialog).toHaveTextContent('And 50 more links in this file.')
    })

    it('names every file that would change, also those past the 200 links it lists', async () => {
        const files = Array.from({ length: 250 }, (_, i) => fileWith(`C:\\ws\\notes\\n${i}.md`, [rewrite('../docs/setup.md', '../guides/setup.md')]))
        const { dialog } = await show(scanOf({ files }))
        const list = within(dialog).getByRole('region', { name: 'Links to update' })
        expect(within(list).getAllByText('becomes')).toHaveLength(200)
        // The 250th file has no rows, but is named, with its link counted.
        const last = within(list).getByText('notes\\n249.md').closest('li')!
        expect(last).toHaveTextContent('notes\\n249.md1 link to update in this file.')
        expect(within(list).getByText('notes\\n200.md')).toBeInTheDocument()
        expect(within(list).getByText('notes\\n199.md').closest('li')).toHaveTextContent('Line 1:../docs/setup.md')
    })

    it('keeps many files that won’t change out of the summary, and lists them with why in the list, which scrolls', async () => {
        const blocked = Array.from({ length: 40 }, (_, i) => ({
            path: `C:\\ws\\legacy\\old${i}.md`,
            reason: 'encoding' as const,
            file: fileWith(`C:\\ws\\legacy\\old${i}.md`, [rewrite('../docs/setup.md', '../guides/setup.md')]),
        }))
        const { dialog } = await show(scanOf({ blocked }))
        expect(dialog).toHaveAccessibleDescription(
            "Moving setup.md breaks 3 links in 2 files. Update them to the new place? 40 more files link to it too, but won't change. They are listed below."
        )
        const list = within(dialog).getByRole('region', { name: 'Links to update' })
        const wontChange = within(list).getByRole('list', { name: "Files that won't change" })
        expect(within(wontChange).getAllByRole('listitem')).toHaveLength(40)
        expect(within(wontChange).getAllByRole('listitem')[39]).toHaveTextContent(
            "legacy\\old39.md: it isn't saved as UTF-8 or UTF-16, so Scrivon only reads it."
        )
        // The buttons are still there, after the list, not pushed away by the summary.
        expect(within(dialog).getByRole('button', { name: 'Update Links' })).toBeInTheDocument()
    })

    it('works from the keyboard: the list can take focus to scroll, and each button answers', async () => {
        const { dialog, onAnswer } = await show(scanOf())
        const list = within(dialog).getByRole('region', { name: 'Links to update' })
        expect(list).toHaveAttribute('tabindex', '0')

        fireEvent.click(within(dialog).getByRole('button', { name: 'Update Links' }))
        expect(onAnswer).toHaveBeenCalledWith(true)
    })

    it('answers no on Don’t Update and on Esc', async () => {
        const { dialog, onAnswer } = await show(scanOf())
        fireEvent.click(within(dialog).getByRole('button', { name: "Don't Update" }))
        expect(onAnswer).toHaveBeenLastCalledWith(false)

        onAnswer.mockClear()
        fireEvent.keyDown(dialog, { key: 'Escape' })
        await settle()
        expect(onAnswer).toHaveBeenCalledWith(false)
        expect(onAnswer).not.toHaveBeenCalledWith(true)
    })
})
