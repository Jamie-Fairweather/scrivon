/** A full path to a file on disk: `D:\…`, `\\server\…` or `/…`. Example tabs use ids like `example:intro`. */
const ABSOLUTE_PATH = /^(?:[a-z]:[\\/]|\\\\|\/)/i

/**
 * Where a save dialog starts: next to the document when it is a file on disk, so the export lands
 * beside it. Example and unsaved tabs have no folder, so they get the bare name and the dialog picks one.
 */
export function savePathBesideDocument(fileName: string, documentPath: string | undefined): string {
    if (!documentPath || !ABSOLUTE_PATH.test(documentPath)) return fileName
    const slash = Math.max(documentPath.lastIndexOf('/'), documentPath.lastIndexOf('\\'))
    return `${documentPath.slice(0, slash + 1)}${fileName}`
}
