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

/**
 * Asks the app whether there is a newer version. The update channel only lists stable releases, so a
 * pre-release (rc) build also names the newest release on GitHub, which may be a newer rc. Throws when
 * the check fails.
 */
export async function checkForAppUpdate(currentVersion: string | null): Promise<AppUpdateInfo | null> {
    let releaseTag: string | null = null
    if (currentVersion && isPrereleaseVersion(currentVersion)) {
        const releases = await fetchReleaseList()
        releaseTag = releases ? newestReleaseTag(releases, currentVersion) : null
    }
    return invoke<AppUpdateInfo | null>('check_for_app_update', { releaseTag })
}
