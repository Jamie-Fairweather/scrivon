const GITHUB_REPO = 'Jamie-Fairweather/scrivon'
const GITHUB_HEADERS = { Accept: 'application/vnd.github+json' }
/** GitHub's maximum page size, so one request covers anyone who has skipped many releases. */
const RELEASES_PER_PAGE = 100

type GitHubRelease = {
    body?: string | null
}

export type GitHubReleaseSummary = {
    tag_name?: unknown
    body?: unknown
    draft?: unknown
    prerelease?: unknown
}

type ParsedVersion = {
    core: [number, number, number]
    prerelease: string[]
}

export function releaseTagForVersion(version: string): string {
    return version.startsWith('v') ? version : `v${version}`
}

function parseVersion(version: string): ParsedVersion | null {
    const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(version.trim())
    if (!match) return null
    return {
        core: [Number(match[1]), Number(match[2]), Number(match[3])],
        prerelease: match[4] ? match[4].split('.') : [],
    }
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
function compareParsedVersions(a: ParsedVersion, b: ParsedVersion): number {
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

/**
 * Joins the notes of every release after `currentVersion` up to and including `targetVersion`, newest first,
 * so someone skipping several versions sees everything that changed. Returns null when the versions can't be
 * read or the target release isn't in the list, so the caller can fall back to the target's own notes.
 */
export function combineReleaseNotes(releases: readonly GitHubReleaseSummary[], currentVersion: string, targetVersion: string): string | null {
    const current = parseVersion(currentVersion)
    const target = parseVersion(targetVersion)
    if (!current || !target) return null

    const includePrereleases = target.prerelease.length > 0
    const matching: { version: ParsedVersion; tag: string; body: string }[] = []

    for (const release of releases) {
        if (release.draft === true || typeof release.tag_name !== 'string') continue
        const version = parseVersion(release.tag_name)
        if (!version) continue
        if (!includePrereleases && (release.prerelease === true || version.prerelease.length > 0)) continue
        if (compareParsedVersions(version, current) <= 0 || compareParsedVersions(version, target) > 0) continue
        matching.push({ version, tag: release.tag_name, body: typeof release.body === 'string' ? release.body.trim() : '' })
    }

    if (!matching.some((release) => compareParsedVersions(release.version, target) === 0)) return null

    const sections = matching
        .sort((a, b) => compareParsedVersions(b.version, a.version))
        .filter((release) => release.body)
        // Release bodies normally start with their own "## [x.y.z]" heading; add one if a body doesn't.
        .map((release) => (/^#{1,6}\s/.test(release.body) ? release.body : `## ${release.tag}\n\n${release.body}`))

    return sections.length > 0 ? sections.join('\n\n') : null
}

export async function fetchReleaseNotes(version: string): Promise<string | null> {
    const tag = releaseTagForVersion(version)

    try {
        const response = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/tags/${tag}`, {
            headers: GITHUB_HEADERS,
        })

        if (!response.ok) return null

        const release = (await response.json()) as GitHubRelease
        const body = release.body?.trim()
        return body || null
    } catch {
        return null
    }
}

/** Notes for every release between the installed version (exclusive) and `targetVersion` (inclusive). */
export async function fetchReleaseNotesSince(currentVersion: string, targetVersion: string): Promise<string | null> {
    try {
        const response = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases?per_page=${RELEASES_PER_PAGE}`, {
            headers: GITHUB_HEADERS,
        })

        if (!response.ok) return null

        const releases: unknown = await response.json()
        if (!Array.isArray(releases)) return null
        return combineReleaseNotes(releases as GitHubReleaseSummary[], currentVersion, targetVersion)
    } catch {
        return null
    }
}

/**
 * Release notes to show for an available update: every version since `currentVersion` when that list can be
 * fetched, otherwise the update's own notes (from the update manifest, or fetched for its tag).
 */
export async function fetchUpdateReleaseNotes(
    update: { version: string; notes: string | null },
    currentVersion: string | null
): Promise<string | null> {
    if (currentVersion) {
        const combined = await fetchReleaseNotesSince(currentVersion, update.version)
        if (combined) return combined
    }
    return update.notes?.trim() || fetchReleaseNotes(update.version)
}
