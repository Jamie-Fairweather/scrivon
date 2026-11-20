import type { Monaco } from '@monaco-editor/react'
import type { IDisposable, IPosition, IRange, editor, languages } from 'monaco-editor'
import { decode } from '@/components/studio/markdown/markdown-links'
import type { DocumentLink, TextSpan } from '@/lib/markdown/document-links'
import type { LinksReader } from '@/lib/markdown/links-reader'
import { findBrokenLinks, type BrokenLink } from '@/lib/workspace/broken-links'
import { documentLinkAddress, encodeLinkText } from '@/lib/workspace/image-assets'
import type { LinkIndex } from '@/lib/workspace/link-index'
import type { WikiIndex } from '@/lib/workspace/wiki-link-lookup'
import { closeAnchors, closeLinkTargets } from '@/lib/workspace/link-suggestions'
import { checkLinkTarget, forgetLinkTargets, subscribeLinkTargets, type DiskAnswer } from '@/lib/workspace/link-target-cache'
import { createAnsweringSessions } from '@/lib/monaco/answering-session'

/** Which link check gives a buffer its quick fixes, when two editors show it. */
const answering = createAnsweringSessions()

/** Whose marks these are, so setting them leaves spell check's (and any other) marks alone. */
export const LINK_CHECK_MARKER_OWNER = 'scrivon-links'
/** How long typing must pause before the links are checked again. */
export const LINK_CHECK_DELAY_MS = 400
/** Other documents' anchors kept, by their text, so an open tab linked many times is read once per change. */
const MAX_KEPT_ANCHORS = 8

/** What to check: the file showing (by its model's URI), where it is, and what the open folder holds. */
export type LinkCheckConfig = {
    modelUri: string
    /** The file on disk, or null for one that isn't saved anywhere yet. */
    documentPath: string | null
    workspaceRoot: string | null
    /** The open folder's tree as one lookup (buildLinkIndex), or null without a folder. */
    index: LinkIndex | null
    /** The open folder's notes, which wiki links are checked against (wikiIndexFor); null or left out, they aren't. */
    wikiIndex?: WikiIndex | null
    /** An open tab's text, unsaved edits included (openTabText); undefined when no tab has the file. */
    openText: (path: string) => string | undefined
}

export type LinkCheckSession = IDisposable & {
    /** Null turns the check off for the file showing (a diagram, a read-only file or an example, or the setting off). */
    setConfig(config: LinkCheckConfig | null): void
}

type Options = {
    reader: LinksReader
    /** Whether a path the tree can't vouch for is there; checkLinkTarget, asked once and kept, by default. */
    checkOnDisk?: (path: string, fresh: boolean) => Promise<DiskAnswer>
    /** Calls back when kept disk answers are forgotten (the window got focus again, say); subscribeLinkTargets by default. */
    subscribe?: (listener: () => void) => () => void
    /** Forgets every kept disk answer, as another tab shows; forgetLinkTargets by default. */
    forget?: () => void
}

/** A broken link where the last check found it, with the text it had then and where its fix goes. */
type Mark = {
    range: IRange
    /** The address as it was checked: the mark only counts while it still reads so. */
    text: string
    message: string
    fix: BrokenLink['fix']
    fixRange: IRange
}

function rangeOf(model: editor.ITextModel, span: TextSpan): IRange {
    const start = model.getPositionAt(span.start)
    const end = model.getPositionAt(span.end)
    return { startLineNumber: start.lineNumber, startColumn: start.column, endLineNumber: end.lineNumber, endColumn: end.column }
}

function contains(range: IRange, position: IPosition): boolean {
    if (position.lineNumber < range.startLineNumber || position.lineNumber > range.endLineNumber) return false
    if (position.lineNumber === range.startLineNumber && position.column < range.startColumn) return false
    if (position.lineNumber === range.endLineNumber && position.column > range.endColumn) return false
    return true
}

/**
 * Checks the links, images, reference definitions, `#anchors` and wiki links' notes of the Markdown file in the editor once typing pauses,
 * and underlines (as warnings) the ones that lead nowhere. Ctrl+. on one offers the closest files, folders or headings.
 * The links are read in a worker; the tree is looked up through `config.index`, and the disk is asked only about a
 * path the tree can't vouch for, once.
 */
export function attachLinkCheck(
    editorInstance: editor.IStandaloneCodeEditor,
    monaco: Monaco,
    {
        reader,
        checkOnDisk = (path, fresh) => checkLinkTarget(path, undefined, { fresh }),
        subscribe = subscribeLinkTargets,
        forget = () => forgetLinkTargets(),
    }: Options,
    initial: LinkCheckConfig | null
): LinkCheckSession {
    let config = initial
    let timer: ReturnType<typeof setTimeout> | null = null
    const marks = new WeakMap<editor.ITextModel, Mark[]>()
    const checking = () => config?.modelUri ?? null
    const leaveAnswering = answering.add(checking)
    /** Lines typed on since the last check, so a link edited there is asked about on disk afresh. */
    let editedLines = new Set<number>()
    const keptAnchors = new Map<string, Promise<readonly string[]>>()

    const toMarker = ({ range, message }: Mark): editor.IMarkerData => ({ ...range, severity: monaco.MarkerSeverity.Warning, message })

    /** The mark at a position, only while its text is what was checked: an edit since may have moved or changed it. */
    const markAt = (model: editor.ITextModel, position: IPosition): Mark | undefined =>
        marks.get(model)?.find((mark) => contains(mark.range, position) && model.getValueInRange(mark.range) === mark.text)

    const show = (model: editor.ITextModel, found: Mark[]) => {
        marks.set(model, found)
        monaco.editor.setModelMarkers(model, LINK_CHECK_MARKER_OWNER, found.map(toMarker))
    }

    const anchorsOf = (text: string): Promise<readonly string[]> => {
        const kept = keptAnchors.get(text)
        if (kept) return kept
        const read = reader.read(text).then((links) => links.anchors)
        keptAnchors.set(text, read)
        if (keptAnchors.size > MAX_KEPT_ANCHORS) keptAnchors.delete(keptAnchors.keys().next().value!)
        return read
    }

    const noActions: languages.CodeActionList = { actions: [], dispose: () => {} }

    type Fix = { title: string; text: string }
    /** Each mark's closest files or folders, ranked once: Monaco asks again whenever the cursor moves inside it. */
    const rankedTargets = new WeakMap<Mark, { index: LinkIndex; fixes: Fix[] }>()

    /**
     * The fixes Ctrl+. offers for a mark: the closest files or folders, or the closest anchors. Ranking files means
     * going through the whole folder's list, which can take a few hundred milliseconds in a very big folder, so it is
     * done only when asked for (`ranking`): Ctrl+., or Quick Fix in the mark's hover. Monaco also asks by itself, for
     * its light bulb, as the cursor moves and as marks change; those asks get only what was ranked already.
     */
    const fixesFor = (model: editor.ITextModel, mark: Mark, asked: LinkCheckConfig, ranking: boolean): Fix[] => {
        const { fix } = mark
        if (fix.kind === 'note') return []
        if (fix.kind === 'anchor') {
            const written = decode(model.getValueInRange(mark.fixRange))
            return closeAnchors(fix.ids, written).map((id) => ({ title: `Change to #${id}`, text: encodeLinkText(id) }))
        }
        const { index, documentPath } = asked
        if (!index || !documentPath) return []
        const ranked = rankedTargets.get(mark)
        if (ranked?.index === index) return ranked.fixes
        if (!ranking) return []
        const fixes = closeLinkTargets(index, fix.target, { wanted: fix.wanted, documentPath }).map((path) => {
            const text = documentLinkAddress(documentPath, path)
            return { title: `Change to ${decode(text)}`, text }
        })
        rankedTargets.set(mark, { index, fixes })
        return fixes
    }

    const codeActions: languages.CodeActionProvider = {
        provideCodeActions(model, range, context) {
            const asked = config
            // Only for its own marks: spell check answers for misspelt words in the same file. With the editor split,
            // the other group's editor may check this file too: only one of them answers.
            const mark = markAt(model, { lineNumber: range.startLineNumber, column: range.startColumn })
            if (!mark || !asked || model.uri.toString() !== asked.modelUri) return noActions
            if (!answering.answers(checking, model.uri.toString())) return noActions
            const diagnostics = [toMarker(mark)]
            const versionId = model.getVersionId()
            const ranking = context.trigger !== monaco.languages.CodeActionTriggerType.Auto
            const actions = fixesFor(model, mark, asked, ranking).map(({ title, text }, index): languages.CodeAction => ({
                title,
                kind: 'quickfix',
                diagnostics,
                isPreferred: index === 0,
                edit: { edits: [{ resource: model.uri, versionId, textEdit: { range: mark.fixRange, text } }] },
            }))
            return { actions, dispose: () => {} }
        },
    }

    const toMarks = (model: editor.ITextModel, source: string, found: BrokenLink[]): Mark[] =>
        found.map(({ span, message, fix }) => ({
            range: rangeOf(model, span),
            text: source.slice(span.start, span.end),
            message,
            fix,
            fixRange: rangeOf(model, fix.span),
        }))

    const check = () => {
        timer = null
        const model = editorInstance.getModel()
        if (!model) return
        const asked = config
        if (!asked || model.uri.toString() !== asked.modelUri) {
            // Not just when this session marked it: another editor, or one before it, may have.
            show(model, [])
            return
        }
        const version = model.getVersionId()
        const source = model.getValue()
        const edited = editedLines
        editedLines = new Set()
        // The text, the file showing or the settings changed while it was checked: a newer check is on its way.
        const stale = () => model.isDisposed() || model.getVersionId() !== version || config !== asked || editorInstance.getModel() !== model
        const wasEdited = (link: DocumentLink) => {
            for (let line = link.position.start.line; line <= link.position.end.line; line += 1) if (edited.has(line)) return true
            return false
        }
        reader
            // Keyed by the model, so while a long file is still being read only its newest text waits.
            .read(source, asked.modelUri)
            .then((links) => (stale() ? null : findBrokenLinks(source, links, { ...asked, anchorsOf, checkOnDisk, edited: wasEdited })))
            .then(
                (found) => {
                    if (found && !stale()) show(model, toMarks(model, source, found))
                },
                // A link that couldn't be checked just isn't underlined.
                () => {}
            )
    }

    const schedule = (delay: number) => {
        if (timer !== null) clearTimeout(timer)
        timer = setTimeout(check, delay)
    }

    const registerCodeActions = () => monaco.languages.registerCodeActionProvider('markdown', codeActions, { providedCodeActionKinds: ['quickfix'] })
    let codeActionsRegistration = registerCodeActions()

    const subscriptions: IDisposable[] = [
        editorInstance.onDidChangeModelContent((event) => {
            for (const change of event.changes) {
                const lines = change.text.split('\n').length
                for (let line = change.range.startLineNumber; line < change.range.startLineNumber + lines; line += 1) editedLines.add(line)
            }
            schedule(LINK_CHECK_DELAY_MS)
        }),
        // Another tab: what the disk said may be out of date, as the watcher can't see every folder.
        editorInstance.onDidChangeModel(() => {
            editedLines = new Set()
            forget()
            schedule(0)
        }),
        { dispose: subscribe(() => schedule(0)) },
    ]
    schedule(0)

    return {
        setConfig(next) {
            const turnedOn = config === null && next !== null
            config = next
            // As for spell check (setConfig in lib/monaco/spellcheck.ts): registering the quick fixes again when the
            // check turns on makes Monaco set Ctrl+. up for a file that was read-only when it was put in the editor.
            if (turnedOn) {
                codeActionsRegistration.dispose()
                codeActionsRegistration = registerCodeActions()
            }
            schedule(0)
        },
        dispose() {
            if (timer !== null) clearTimeout(timer)
            leaveAnswering()
            codeActionsRegistration.dispose()
            subscriptions.forEach((subscription) => subscription.dispose())
        },
    }
}
