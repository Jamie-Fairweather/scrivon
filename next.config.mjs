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
    // Port 3000 must match `next dev -p 3000` in package.json and build.devUrl in src-tauri/tauri.conf.json.
    // The explicit -p makes next dev stop when 3000 is taken instead of moving to another port.
    assetPrefix: isProd ? undefined : `http://${internalHost}:3000`,
}

export default nextConfig
