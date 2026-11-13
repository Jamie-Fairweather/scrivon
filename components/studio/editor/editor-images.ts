import type { IDisposable, IRange, editor } from 'monaco-editor'
import { isExampleTabId } from '@/lib/examples/example-tab'
import { notifyError, notifyInfo } from '@/lib/notify'
import { registerFileDropTarget } from '@/lib/tauri/file-drop'
import { getBaseName, isMarkdownFile, isPathInside } from '@/lib/tauri/fs'
import { addDroppedImage, isImageFile, markdownImage, pastedImageName, saveImageInAssets, type ImageDocument } from '@/lib/workspace/image-assets'
import type { DocumentTab } from '@/lib/workspace/types'

/** The editor calls the image code makes. */
export type ImageEditor = Pick<
    editor.ICodeEditor,
    | 'getContainerDomNode'
    | 'hasTextFocus'
    | 'getModel'
    | 'getSelection'
    | 'setPosition'
    | 'getTargetAtClientPoint'
    | 'executeEdits'
    | 'pushUndoStop'
    | 'focus'
>

/** The tab as a document images can go into: a Markdown file in the open folder that can be edited. */
export function imageDocumentFor(tab: DocumentTab | null, workspaceRoot: string | null): ImageDocument | null {
    if (!tab || !workspaceRoot || tab.readOnly || isExampleTabId(tab.id)) return null
    if (!isMarkdownFile(tab.name) || !isPathInside(tab.path, workspaceRoot)) return null
    return { path: tab.path, workspaceRoot }
}

const UNSUPPORTED_IMAGE = 'Only PNG, JPEG, GIF, WebP and SVG images can be added.'

/** Monaco's TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges: the spot follows edits; typing at it puts the link after the typed text. */
const FOLLOWS_EDITS = 1 as editor.TrackedRangeStickiness

/**
 * Puts the links to `images` at `range` once they are ready. The spot follows edits made meanwhile. If the file
 * isn't showing by then (another one is, or its tab was closed), the link isn't added (that file's text would be out
 * of step with its tab) and the user is told. Resolves when done, and never rejects: a failure is shown instead.
 */
function insertImageLinks(editor: ImageEditor, range: IRange, doc: ImageDocument, images: Promise<string[]>): Promise<void> {
    // The caller had a selection, so the editor has a model.
    const model = editor.getModel()!
    const [mark] = model.deltaDecorations([], [{ range, options: { stickiness: FOLLOWS_EDITS } }])
    const forget = () => {
        if (!model.isDisposed()) model.deltaDecorations([mark!], [])
    }
    return images.then(
        (paths) => {
            const where = model.isDisposed() ? null : model.getDecorationRange(mark!)
            forget()
            if (paths.length === 0) return
            const text = paths.map((path) => markdownImage(doc.path, path)).join(' ')
            if (!where || editor.getModel() !== model) {
                const what = paths.length === 1 ? getBaseName(paths[0]!) : `${paths.length} images`
                notifyInfo(`Saved ${what}`, {
                    description: `${getBaseName(doc.path)} wasn't showing any more, so no link was added. Link it with ${text}`,
                })
                return
            }
            const selection = editor.getSelection()
            const caretThere =
                selection !== null &&
                selection.startLineNumber === where.startLineNumber &&
                selection.startColumn === where.startColumn &&
                selection.endLineNumber === where.endLineNumber &&
                selection.endColumn === where.endColumn
            editor.pushUndoStop()
            editor.executeEdits('scrivon.images', [{ range: where, text }])
            editor.pushUndoStop()
            if (caretThere) {
                const start = model.getOffsetAt({ lineNumber: where.startLineNumber, column: where.startColumn })
                editor.setPosition(model.getPositionAt(start + text.length))
            }
        },
        (err: unknown) => {
            forget()
            notifyError("Couldn't add the image", err)
        }
    )
}

/**
 * Pasting a picture into the document, or dropping image files onto it, adds the images and puts links to them
 * where the cursor is (or where they were dropped). `documentNow` is the document showing, or null when it can't
 * take images; pastes and drops are then left alone.
 */
export function attachEditorImages(editor: ImageEditor, documentNow: () => ImageDocument | null): IDisposable {
    const container = editor.getContainerDomNode()

    const onPaste = (event: ClipboardEvent) => {
        const data = event.clipboardData
        // Text wins: copying from Word or a web page brings a picture of the text along too.
        if (!data || data.getData('text/plain') || !editor.hasTextFocus()) return
        const doc = documentNow()
        const selection = editor.getSelection()
        const files = [...data.files].filter((file) => file.type.startsWith('image/'))
        if (!doc || !selection || files.length === 0) return
        // Before Monaco sees it, which would paste nothing.
        event.preventDefault()
        event.stopPropagation()
        const when = new Date()
        const named = files.map((file) => ({ file, name: pastedImageName(file.type, when) }))
        const skipped = named.filter(({ name }) => !name)
        if (skipped.length > 0) {
            const what = skipped.length === 1 ? skipped[0]!.file.name : `${skipped.length} images`
            notifyInfo(`Couldn't add ${what}`, { description: UNSUPPORTED_IMAGE })
        }
        const saves = named.flatMap(({ file, name }) =>
            name ? [file.arrayBuffer().then((bytes) => saveImageInAssets(doc.path, name, new Uint8Array(bytes)))] : []
        )
        if (saves.length > 0) void insertImageLinks(editor, selection, doc, Promise.all(saves))
    }
    container.addEventListener('paste', onPaste, true)

    const stopDrops = registerFileDropTarget(container, async ({ paths, x, y }) => {
        const doc = documentNow()
        const images = paths.filter(isImageFile)
        if (!doc || images.length === 0) return paths
        // On a line of text, they go where they were dropped; otherwise (a scrollbar, say) at the cursor.
        const point = editor.getTargetAtClientPoint(x, y)?.position
        if (point) editor.setPosition(point)
        const selection = editor.getSelection()
        if (!selection) return paths
        editor.focus()
        // The other files (a document to open) wait until the links are in, so this file is still showing.
        await insertImageLinks(editor, selection, doc, Promise.all(images.map((image) => addDroppedImage(image, doc))))
        return paths.filter((path) => !isImageFile(path))
    })

    return {
        dispose: () => {
            container.removeEventListener('paste', onPaste, true)
            stopDrops()
        },
    }
}
