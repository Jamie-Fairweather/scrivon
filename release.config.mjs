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
    plugins: [
        ...analyzer,
        releaseNotes,
        npm,
        exec,
        ...(isRc ? [] : [changelog]),
        git(isRc ? versionAssets : [...versionAssets, 'CHANGELOG.md']),
        '@semantic-release/github',
    ],
}

export default releaseConfig
