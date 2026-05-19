import { readDir, readTextFile, writeTextFile, mkdir, rename, remove, copyFile, type DirEntry } from '@tauri-apps/plugin-fs'
import { isTauri } from '@/lib/tauri/platform'
import type { FileNode } from '@/lib/workspace/types'

const SKIP_DIRS = new Set(['.git', 'node_modules', '.next', 'target', 'dist', 'build'])

function compareEntries(a: FileNode, b: FileNode): number {
    if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
}

async function readDirTree(dirPath: string): Promise<FileNode[]> {
    const entries = await readDir(dirPath)
    const nodes: FileNode[] = []

    for (const entry of entries) {
        const fullPath = `${dirPath.replace(/[/\\]+$/, '')}/${entry.name}`
        if (entry.isDirectory) {
            if (SKIP_DIRS.has(entry.name)) continue
            const children = await readDirTree(fullPath)
            nodes.push({
                kind: 'directory',
                name: entry.name,
                path: fullPath,
                children,
            })
        } else if (entry.isFile) {
            nodes.push({
                kind: 'file',
                name: entry.name,
                path: fullPath,
            })
        }
    }

    return nodes.sort(compareEntries)
}

export async function listWorkspaceTree(rootPath: string): Promise<FileNode[]> {
    if (!isTauri()) return []
    return readDirTree(rootPath)
}

export async function readWorkspaceFile(path: string): Promise<string> {
    if (!isTauri()) return ''
    return readTextFile(path)
}

export async function writeWorkspaceFile(path: string, content: string): Promise<void> {
    if (!isTauri()) return
    await writeTextFile(path, content)
}

export async function createWorkspaceDirectory(path: string): Promise<void> {
    if (!isTauri()) return
    await mkdir(path, { recursive: true })
}

export async function createWorkspaceFile(path: string, content: string): Promise<void> {
    if (!isTauri()) return
    await writeTextFile(path, content)
}

export async function renameWorkspacePath(oldPath: string, newPath: string): Promise<void> {
    if (!isTauri()) return
    await rename(oldPath, newPath)
}

export async function removeWorkspacePath(path: string): Promise<void> {
    if (!isTauri()) return
    await remove(path)
}

export async function duplicateWorkspaceFile(sourcePath: string, destPath: string): Promise<void> {
    if (!isTauri()) return
    await copyFile(sourcePath, destPath)
}

export function joinPath(parent: string, name: string): string {
    const sep = parent.includes('\\') ? '\\' : '/'
    return `${parent.replace(/[/\\]+$/, '')}${sep}${name}`
}

export function getBaseName(path: string): string {
    const parts = path.split(/[/\\]/)
    return parts[parts.length - 1] ?? path
}

export function getParentPath(path: string): string {
    const parts = path.split(/[/\\]/)
    parts.pop()
    return parts.join(path.includes('\\') ? '\\' : '/')
}

export function isMermaidFile(name: string): boolean {
    return name.endsWith('.mmd') || name.endsWith('.mermaid')
}

export type { DirEntry }
