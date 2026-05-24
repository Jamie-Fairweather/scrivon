const GITHUB_REPO = 'Jamie-Fairweather/scrivon'

type GitHubRelease = {
    body?: string | null
}

export function releaseTagForVersion(version: string): string {
    return version.startsWith('v') ? version : `v${version}`
}

export async function fetchReleaseNotes(version: string): Promise<string | null> {
    const tag = releaseTagForVersion(version)

    try {
        const response = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/tags/${tag}`, {
            headers: {
                Accept: 'application/vnd.github+json',
            },
        })

        if (!response.ok) return null

        const release = (await response.json()) as GitHubRelease
        const body = release.body?.trim()
        return body || null
    } catch {
        return null
    }
}
