import { invoke } from '@tauri-apps/api/core'
import type { AppUpdateInfo } from '@/components/studio/dialogs/update-available-dialog'
import { fetchReleaseList, type GitHubReleaseSummary } from '@/lib/updater/release-notes'
import { compareParsedVersions, isPrereleaseVersion, parseVersion, type ParsedVersion } from '@/lib/updater/version'

/** The tag of the newest published release after `currentVersion` (rc or stable), or null when there is none. */
export function newestReleaseTag(releases: readonly GitHubReleaseSummary[], currentVersion: string): string | null {
    const current = parseVersion(currentVersion)
    if (!current) return null

    let newest: { tag: string; version: ParsedVersion } | null = null
    for (const release of releases) {
        if (release.draft === true || typeof release.tag_name !== 'string') continue
        const version = parseVersion(release.tag_name)
        if (!version || compareParsedVersions(version, current) <= 0) continue
        if (!newest || compareParsedVersions(version, newest.version) > 0) newest = { tag: release.tag_name, version }
    }
    return newest?.tag ?? null
}

/** What an update check found. */
export type AppUpdateCheck = {
    /** The newer version, or null when there is none. */
    update: AppUpdateInfo | null
    /** A pre-release (rc) build couldn't get the release list from GitHub, so only stable releases were checked. */
    missedPrereleases: boolean
}

/**
 * Asks the app whether there is a newer version. The update channel only lists stable releases, so a
 * pre-release (rc) build also names the newest release on GitHub, which may be a newer rc. Throws when
 * the check fails.
 */
export async function checkForAppUpdate(currentVersion: string | null): Promise<AppUpdateCheck> {
    let releaseTag: string | null = null
    let missedPrereleases = false
    if (currentVersion && isPrereleaseVersion(currentVersion)) {
        const releases = await fetchReleaseList()
        if (releases) releaseTag = newestReleaseTag(releases, currentVersion)
        else missedPrereleases = true
    }
    const update = await invoke<AppUpdateInfo | null>('check_for_app_update', { releaseTag })
    return { update, missedPrereleases }
}
