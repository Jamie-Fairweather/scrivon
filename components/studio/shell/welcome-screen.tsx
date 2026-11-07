'use client'

import { FolderOpen, FolderX, Loader2, Monitor } from 'lucide-react'
import { useWorkspaceSession } from '@/components/studio/workspace/workspace-provider'
import { APP_NAME, APP_TAGLINE } from '@/lib/app-branding'
import { Button } from '@/components/ui/button'
import { getBaseName, samePath } from '@/lib/tauri/fs'
import { cn } from '@/lib/utils'
import { displayPath } from '@/lib/workspace/display-path'
import { supportedExtensionsLabel } from '@/lib/workspace/file-types'
import { shortenPath as truncatePath } from '@/lib/workspace/paths'

export function WelcomeScreen() {
    const { isDesktop, recentWorkspaces, openingWorkspace, pickAndOpenWorkspace, openWorkspace, removeRecent } = useWorkspaceSession()
    // Reading a big folder takes a while, so its row (or the Open Folder button, for a folder picked in the
    // dialog) shows that it is busy. The other rows stay clickable: the folder clicked last is the one that opens.
    const isOpening = (path: string) => openingWorkspace !== null && samePath(path, openingWorkspace)
    const openingFromPicker = openingWorkspace !== null && !recentWorkspaces.some(isOpening)

    // The column scrolls when it is taller than the window; my-auto keeps it centred when it fits.
    return (
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-6">
            <div className="my-auto flex w-full flex-col items-center gap-8 py-8">
                <div className="flex flex-col items-center gap-2 text-center">
                    <h1 className="text-2xl font-semibold tracking-tight">{APP_NAME}</h1>
                    <p className="max-w-md text-sm text-muted-foreground">{APP_TAGLINE}</p>
                    <p className="max-w-md text-sm text-muted-foreground">
                        Open a folder to browse {supportedExtensionsLabel('and')} files, edit in the editor, and preview diagrams or rendered
                        Markdown.
                    </p>
                </div>

                {!isDesktop && (
                    <div
                        className="flex max-w-md items-start gap-3 rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-sm
                            text-warning-foreground"
                    >
                        <Monitor className="mt-0.5 size-4 shrink-0" />
                        <p>
                            Folder workspaces require the desktop app. Run <code className="rounded bg-muted px-1 py-0.5">bun run tauri dev</code> to
                            open folders on disk.
                        </p>
                    </div>
                )}

                <Button size="lg" onClick={() => void pickAndOpenWorkspace()} disabled={!isDesktop} aria-busy={openingFromPicker || undefined}>
                    {openingFromPicker ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <FolderOpen className="size-4" />}
                    Open Folder
                </Button>

                {recentWorkspaces.length > 0 && (
                    <div className="w-full max-w-lg">
                        <h2 className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">Recent folders</h2>
                        <ul className="flex flex-col gap-1">
                            {recentWorkspaces.map((path) => {
                                const name = getBaseName(path)
                                const opening = isOpening(path)
                                return (
                                    <li key={path}>
                                        <div
                                            className="group flex items-center gap-2 rounded-lg border border-transparent px-3 py-2 transition-colors
                                                focus-within:border-border focus-within:bg-muted/50 hover:border-border hover:bg-muted/50"
                                        >
                                            {/* aria-disabled rather than disabled while opening, so keyboard focus stays on the row. */}
                                            <button
                                                type="button"
                                                className="flex min-w-0 flex-1 items-center gap-2 text-left aria-disabled:cursor-progress"
                                                onClick={() => {
                                                    if (!opening) void openWorkspace(path)
                                                }}
                                                disabled={!isDesktop}
                                                aria-busy={opening || undefined}
                                                aria-disabled={opening || undefined}
                                            >
                                                <span className="flex min-w-0 flex-1 flex-col items-start">
                                                    <span dir="auto" className="max-w-full truncate text-sm font-medium">
                                                        {name}
                                                    </span>
                                                    <span className="max-w-full truncate text-xs text-muted-foreground">
                                                        {displayPath(truncatePath(path))}
                                                    </span>
                                                </span>
                                                {opening && <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" aria-hidden />}
                                            </button>
                                            <Button
                                                variant="ghost"
                                                size="icon-sm"
                                                // Hidden until the row is hovered or focused, but always shown on touch screens.
                                                className={cn(
                                                    'shrink-0 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100',
                                                    'focus-visible:opacity-100 pointer-coarse:opacity-100'
                                                )}
                                                aria-label={`Remove ${name} from recent folders`}
                                                title="Remove from recent folders"
                                                onClick={() => void removeRecent(path)}
                                            >
                                                <FolderX className="size-4" />
                                            </Button>
                                        </div>
                                    </li>
                                )
                            })}
                        </ul>
                    </div>
                )}
            </div>
        </div>
    )
}
