'use client'

import { FolderOpen, FolderX, Monitor } from 'lucide-react'
import { useWorkspaceSession } from '@/components/studio/workspace/workspace-provider'
import { APP_NAME, APP_TAGLINE } from '@/lib/app-branding'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

function truncatePath(path: string, max = 56): string {
    if (path.length <= max) return path
    const start = path.slice(0, 20)
    const end = path.slice(-32)
    return `${start}…${end}`
}

export function WelcomeScreen() {
    const { isDesktop, recentWorkspaces, pickAndOpenWorkspace, openWorkspace, removeRecent } = useWorkspaceSession()

    return (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-8 px-6">
            <div className="flex flex-col items-center gap-2 text-center">
                <h1 className="text-2xl font-semibold tracking-tight">{APP_NAME}</h1>
                <p className="max-w-md text-sm text-muted-foreground">{APP_TAGLINE}</p>
                <p className="max-w-md text-sm text-muted-foreground/80">
                    Open a folder to browse diagram files, edit in the editor, and preview on the canvas.
                </p>
            </div>

            {!isDesktop && (
                <div
                    className="flex max-w-md items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100"
                >
                    <Monitor className="mt-0.5 size-4 shrink-0" />
                    <p>
                        Folder workspaces require the desktop app. Run <code className="rounded bg-black/30 px-1 py-0.5">bun run tauri dev</code> to
                        open folders on disk.
                    </p>
                </div>
            )}

            <Button size="lg" onClick={() => void pickAndOpenWorkspace()} disabled={!isDesktop}>
                <FolderOpen className="size-4" />
                Open Folder
            </Button>

            {recentWorkspaces.length > 0 && (
                <div className="w-full max-w-lg">
                    <h2 className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">Recent folders</h2>
                    <ul className="flex flex-col gap-1">
                        {recentWorkspaces.map((path) => {
                            const name = path.split(/[/\\]/).pop() ?? path
                            return (
                                <li key={path}>
                                    <div
                                        className="group flex items-center gap-2 rounded-lg border border-transparent px-3 py-2 transition-colors
                                            hover:border-border hover:bg-muted/50"
                                    >
                                        <button
                                            type="button"
                                            className="flex min-w-0 flex-1 flex-col items-start text-left"
                                            onClick={() => void openWorkspace(path)}
                                            disabled={!isDesktop}
                                        >
                                            <span className="truncate text-sm font-medium">{name}</span>
                                            <span className="truncate text-xs text-muted-foreground">{truncatePath(path)}</span>
                                        </button>
                                        <Button
                                            variant="ghost"
                                            size="icon-sm"
                                            className={cn('shrink-0 opacity-0 transition-opacity group-hover:opacity-100')}
                                            aria-label="Remove from recents"
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
    )
}
