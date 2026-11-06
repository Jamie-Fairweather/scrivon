/** @type {import('semantic-release').GlobalConfig} */

const analyzer = [
    '@semantic-release/commit-analyzer',
    {
        preset: 'conventionalcommits',
    },
]

const releaseNotes = [
    '@semantic-release/release-notes-generator',
    {
        preset: 'conventionalcommits',
    },
]

const npm = [
    '@semantic-release/npm',
    {
        npmPublish: false,
    },
]

const exec = [
    '@semantic-release/exec',
    {
        prepareCmd: 'node scripts/sync-version.mjs',
        // Release workflow step outputs (new_release_published / new_release_version) for the Windows build job.
        successCmd: 'node scripts/write-release-outputs.mjs ${nextRelease.version}',
    },
]

const versionAssets = ['package.json', 'src-tauri/Cargo.toml', 'src-tauri/tauri.conf.json', 'lib/legal/third-party-licenses.ts']

/** @param {string[]} assets */
function git(assets) {
    return [
        '@semantic-release/git',
        {
            assets,
            message: 'chore(release): ${nextRelease.version}\n\n${nextRelease.notes}',
        },
    ]
}

// Plugins must be top-level — semantic-release ignores plugins nested under branches[].
// Changelog is main-only; rc releases only bump version files.
const branch = process.env.GITHUB_REF?.replace(/^refs\/heads\//, '') ?? ''
const isRc = branch === 'rc'

const changelog = ['@semantic-release/changelog', { changelogFile: 'CHANGELOG.md' }]

// The GitHub Release starts as a draft, so it can't become 'latest' (the updater's latest.json URL)
// before it has installers. The Windows build job in release.yml publishes it once they are uploaded.
// A draft's own link stops working when it is published, so the PR comment links the tag instead.
const github = [
    '@semantic-release/github',
    {
        draftRelease: true,
        successComment:
            ':tada: This ${issue.pull_request ? "PR is included" : "issue has been resolved"} in version ${nextRelease.version} :tada:' +
            '\n\nThe release is available on [GitHub release](${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/releases/tag/${nextRelease.gitTag})' +
            '\n\nYour **[semantic-release](https://github.com/semantic-release/semantic-release)** bot :package::rocket:',
    },
]

const releaseConfig = {
    branches: [{ name: 'main' }, { name: 'rc', prerelease: 'rc' }],
    // Each entry is a name or a [name, options] pair; never spread a pair into this list.
    plugins: [
        analyzer,
        releaseNotes,
        npm,
        exec,
        ...(isRc ? [] : [changelog]),
        git(isRc ? versionAssets : [...versionAssets, 'CHANGELOG.md']),
        github,
    ],
}

export default releaseConfig
