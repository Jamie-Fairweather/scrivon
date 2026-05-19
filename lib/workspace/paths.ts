const INVALID_CHARS = /[<>:"|?*\x00-\x1f]/

export function validateFileName(name: string): string | null {
    const trimmed = name.trim()
    if (!trimmed) return 'Name cannot be empty'
    if (INVALID_CHARS.test(trimmed)) return 'Name contains invalid characters'
    if (trimmed === '.' || trimmed === '..') return 'Invalid name'
    if (trimmed.includes('/') || trimmed.includes('\\')) return 'Name cannot contain path separators'
    return null
}

export function uniqueFileName(base: string, existing: Set<string>): string {
    if (!existing.has(base)) return base
    const dot = base.lastIndexOf('.')
    const stem = dot > 0 ? base.slice(0, dot) : base
    const ext = dot > 0 ? base.slice(dot) : ''
    let i = 1
    while (existing.has(`${stem} copy${i > 1 ? ` ${i}` : ''}${ext}`)) {
        i += 1
    }
    return `${stem} copy${i > 1 ? ` ${i}` : ''}${ext}`
}

export function uniqueUntitledName(existing: Set<string>): string {
    if (!existing.has('untitled.mmd')) return 'untitled.mmd'
    let i = 2
    while (existing.has(`untitled-${i}.mmd`)) {
        i += 1
    }
    return `untitled-${i}.mmd`
}

export function collectFilePaths(nodes: import('@/lib/workspace/types').FileNode[]): Set<string> {
    const paths = new Set<string>()
    const walk = (items: import('@/lib/workspace/types').FileNode[]) => {
        for (const node of items) {
            if (node.kind === 'file') paths.add(node.path)
            else walk(node.children)
        }
    }
    walk(nodes)
    return paths
}

export function collectFileNames(nodes: import('@/lib/workspace/types').FileNode[]): Set<string> {
    const names = new Set<string>()
    const walk = (items: import('@/lib/workspace/types').FileNode[]) => {
        for (const node of items) {
            names.add(node.name)
            if (node.kind === 'directory') walk(node.children)
        }
    }
    walk(nodes)
    return names
}

export function findNodeByPath(nodes: import('@/lib/workspace/types').FileNode[], path: string): import('@/lib/workspace/types').FileNode | null {
    for (const node of nodes) {
        if (node.path === path) return node
        if (node.kind === 'directory') {
            const found = findNodeByPath(node.children, path)
            if (found) return found
        }
    }
    return null
}
