/** @type {import('semantic-release').GlobalConfig} */
export default {
    branches: ['main', { name: 'rc', prerelease: 'rc' }],
    plugins: [
        [
            '@semantic-release/commit-analyzer',
            {
                preset: 'conventionalcommits',
            },
        ],
        [
            '@semantic-release/release-notes-generator',
            {
                preset: 'conventionalcommits',
            },
        ],
        [
            '@semantic-release/changelog',
            {
                changelogFile: 'CHANGELOG.md',
            },
        ],
        [
            '@semantic-release/npm',
            {
                npmPublish: false,
            },
        ],
        [
            '@semantic-release/exec',
            {
                prepareCmd: 'node scripts/sync-version.mjs',
            },
        ],
        [
            '@semantic-release/git',
            {
                assets: ['package.json', 'CHANGELOG.md', 'src-tauri/Cargo.toml', 'src-tauri/tauri.conf.json', 'lib/legal/third-party-licenses.ts'],
                message: 'chore(release): ${nextRelease.version}\n\n${nextRelease.notes}',
            },
        ],
        '@semantic-release/github',
    ],
}
