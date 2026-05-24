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

const basePlugins = [analyzer, releaseNotes, npm, exec]

export default {
    branches: [
        {
            name: 'main',
            plugins: [
                ...basePlugins,
                ['@semantic-release/changelog', { changelogFile: 'CHANGELOG.md' }],
                git([...versionAssets, 'CHANGELOG.md']),
                '@semantic-release/github',
            ],
        },
        {
            name: 'rc',
            prerelease: 'rc',
            plugins: [...basePlugins, git(versionAssets), '@semantic-release/github'],
        },
    ],
}
