export type ParsedVersion = {
    core: [number, number, number]
    prerelease: string[]
}

/** Reads `1.2.3`, `v1.2.3` or `1.2.3-rc.1`; null for anything else. */
export function parseVersion(version: string): ParsedVersion | null {
    const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(version.trim())
    if (!match) return null
    return {
        core: [Number(match[1]), Number(match[2]), Number(match[3])],
        prerelease: match[4] ? match[4].split('.') : [],
    }
}

/** True for a pre-release build such as `1.6.0-rc.1`. */
export function isPrereleaseVersion(version: string): boolean {
    return (parseVersion(version)?.prerelease.length ?? 0) > 0
}

function comparePrereleaseIds(a: string, b: string): number {
    const aNumeric = /^\d+$/.test(a)
    const bNumeric = /^\d+$/.test(b)
    if (aNumeric && bNumeric) return Number(a) - Number(b)
    if (aNumeric) return -1
    if (bNumeric) return 1
    return a < b ? -1 : a > b ? 1 : 0
}

/** Semver order: negative when `a` is older than `b`, positive when newer, 0 when equal. */
export function compareParsedVersions(a: ParsedVersion, b: ParsedVersion): number {
    for (let i = 0; i < 3; i++) {
        const diff = a.core[i] - b.core[i]
        if (diff !== 0) return diff
    }
    // A release is newer than any prerelease of the same version (1.0.0 > 1.0.0-beta).
    if (a.prerelease.length === 0 || b.prerelease.length === 0) return b.prerelease.length - a.prerelease.length
    const length = Math.min(a.prerelease.length, b.prerelease.length)
    for (let i = 0; i < length; i++) {
        const diff = comparePrereleaseIds(a.prerelease[i], b.prerelease[i])
        if (diff !== 0) return diff
    }
    return a.prerelease.length - b.prerelease.length
}
