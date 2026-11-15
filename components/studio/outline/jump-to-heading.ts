import { revealHeadingInPreview } from '@/components/studio/markdown/preview-heading'
import type { WorkspaceCoordinatorRefs } from '@/components/studio/workspace/workspace-coordinator'

/** A heading to jump to: its id in the preview and its line in the file (from 1). */
type HeadingTarget = { id: string; line: number }

/**
 * Moves the preview to a heading of the file at `path`, and the editor too when it shows. A hidden editor is left
 * alone: it would jump, and take the keyboard, whenever it is next shown. Used by the Outline panel and by '@' in
 * the command palette.
 */
export function jumpToHeading(
    coordinator: Pick<WorkspaceCoordinatorRefs, 'revealInEditor'>,
    path: string | null,
    heading: HeadingTarget,
    editorOpen: boolean
): void {
    revealHeadingInPreview(heading.id)
    if (path !== null && editorOpen) coordinator.revealInEditor.current(path, heading.line, 1)
}
