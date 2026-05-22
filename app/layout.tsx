import type { Metadata } from 'next'
import './globals.css'
import { Inter, Geist_Mono } from 'next/font/google'
import { cn } from '@/lib/utils'
import { ThemeProvider } from '@/components/theme-provider'
import { APP_TAGLINE } from '@/lib/app-branding'

const geistMono = Geist_Mono({ subsets: ['latin'], variable: '--font-mono', preload: true })

const interHeading = Inter({ subsets: ['latin'], variable: '--font-heading', preload: true })

const inter = Inter({ subsets: ['latin'], variable: '--font-sans', preload: true })

export const metadata: Metadata = {
    title: 'Scrivon',
    description: APP_TAGLINE,
}

export default function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode
}>) {
    return (
        <html
            lang="en"
            className={cn('dark h-full overflow-hidden', inter.variable, interHeading.variable, geistMono.variable)}
            style={{ backgroundColor: '#161616' }}
            suppressHydrationWarning
        >
            <body className="h-full w-full overflow-hidden bg-background font-sans">
                <ThemeProvider attribute="class" defaultTheme="dark" forcedTheme="dark" disableTransitionOnChange>
                    {children}
                </ThemeProvider>
            </body>
        </html>
    )
}
