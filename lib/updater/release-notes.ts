import { compareParsedVersions, parseVersion, type ParsedVersion } from '@/lib/updater/version'

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

export function releaseTagForVersion(version: string): string {
    return version.startsWith('v') ? version : `v${version}`
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

/** The published releases on GitHub, newest first; null when GitHub can't be reached. */
export async function fetchReleaseList(): Promise<GitHubReleaseSummary[] | null> {
    try {
        const response = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases?per_page=${RELEASES_PER_PAGE}`, {
            headers: GITHUB_HEADERS,
        })

        if (!response.ok) return null

        const releases: unknown = await response.json()
        return Array.isArray(releases) ? (releases as GitHubReleaseSummary[]) : null
    } catch {
        return null
    }
}

/** Notes for every release between the installed version (exclusive) and `targetVersion` (inclusive). */
export async function fetchReleaseNotesSince(currentVersion: string, targetVersion: string): Promise<string | null> {
    const releases = await fetchReleaseList()
    return releases ? combineReleaseNotes(releases, currentVersion, targetVersion) : null
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
