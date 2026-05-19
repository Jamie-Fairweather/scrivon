import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
    title: 'diagram-app',
    description: 'Diagram app built with Tauri and Next.js',
}

export default function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode
}>) {
    return (
        <html lang="en">
            <body>{children}</body>
        </html>
    )
}
