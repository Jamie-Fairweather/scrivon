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
        '@semantic-release/github',
    ],
}

export default releaseConfig
