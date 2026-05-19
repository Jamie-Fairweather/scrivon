import type { Metadata } from 'next'
import './globals.css'
import { Geist, Inter, Geist_Mono } from 'next/font/google'
import { cn } from '@/lib/utils'
import { ThemeProvider } from '@/components/theme-provider'

const geistMono = Geist_Mono({ subsets: ['latin'], variable: '--font-mono' })

const interHeading = Inter({ subsets: ['latin'], variable: '--font-heading' })

const inter = Inter({ subsets: ['latin'], variable: '--font-sans' })

export const metadata: Metadata = {
    title: 'Mermaid Studio',
    description: 'Edit Mermaid diagrams with a live preview canvas',
}

export default function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode
}>) {
    return (
        <html lang="en" className={cn('font-sans', 'font-mono', inter.variable, interHeading.variable, geistMono.variable)} suppressHydrationWarning>
            <body className="h-screen w-screen overflow-hidden bg-background">
                <ThemeProvider attribute="class" defaultTheme="dark" forcedTheme="dark" disableTransitionOnChange>
                    {children}
                </ThemeProvider>
            </body>
        </html>
    )
}
