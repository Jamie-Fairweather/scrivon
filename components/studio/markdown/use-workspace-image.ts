import { useEffect, useState, useSyncExternalStore } from 'react'
import { errorMessage } from '@/lib/notify'
import { cachedWorkspaceImage, readWorkspaceImage, subscribeWorkspaceImages, workspaceImageVersion } from '@/lib/workspace/workspace-images'

export type WorkspaceImage = { status: 'loading' } | { status: 'loaded'; url: string } | { status: 'failed'; reason: string }

type Read = { path: string; image: WorkspaceImage }

/**
 * An image inside the open folder, read again whenever it changes on disk. One read before shows straight away,
 * and while a changed image is read again the old picture stays, so it doesn't flicker.
 */
export function useWorkspaceImage(path: string, workspaceRoot: string): WorkspaceImage {
    const version = useSyncExternalStore(
        subscribeWorkspaceImages,
        () => workspaceImageVersion(path),
        () => 0
    )
    // Kept here too, so the picture stays when the memory cache lets it go.
    const [read, setRead] = useState<Read | null>(null)

    useEffect(() => {
        let live = true
        readWorkspaceImage(path, workspaceRoot).then(
            (url) => {
                if (live) setRead({ path, image: { status: 'loaded', url } })
            },
            (err: unknown) => {
                if (live) setRead({ path, image: { status: 'failed', reason: errorMessage(err, 'Couldn’t read the image.') } })
            }
        )
        return () => {
            live = false
        }
    }, [path, workspaceRoot, version])

    const cached = cachedWorkspaceImage(path)
    if (cached !== undefined) return { status: 'loaded', url: cached }
    return read?.path === path ? read.image : { status: 'loading' }
}
