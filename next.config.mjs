const isProd = process.env.NODE_ENV === 'production'
const internalHost = process.env.TAURI_DEV_HOST || 'localhost'

/** @type {import('next').NextConfig} */
const nextConfig = {
    output: 'export',
    // Only so scripts/generate-licenses.mjs can trace the shipped packages; it deletes them from out/ afterwards.
    productionBrowserSourceMaps: process.env.GENERATE_LICENSES === '1',
    images: {
        unoptimized: true,
    },
    assetPrefix: isProd ? undefined : `http://${internalHost}:3000`,
}

export default nextConfig
