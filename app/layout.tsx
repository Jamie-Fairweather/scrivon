import type { Metadata } from 'next'
import './globals.css'
import { Inter, Geist_Mono } from 'next/font/google'
import { cn } from '@/lib/utils'
import { AppThemeProvider } from '@/components/theme/app-theme-provider'
import { SettingsDialog } from '@/components/studio/settings/settings-dialog'
import { SettingsProvider } from '@/components/studio/settings/settings-provider'
import { ToastProvider } from '@/components/ui/toast'
import { getThemeBootScript } from '@/lib/theme/theme-boot-script'
import { APP_TAGLINE } from '@/lib/app-branding'
import { DisableNativeContextMenu } from '@/components/disable-native-context-menu'

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
        <html lang="en" className={cn('h-full overflow-hidden', inter.variable, interHeading.variable, geistMono.variable)} suppressHydrationWarning>
            <head>
                <script dangerouslySetInnerHTML={{ __html: getThemeBootScript() }} />
            </head>
            <body className="h-full w-full overflow-hidden bg-background font-sans">
                <SettingsProvider>
                    <AppThemeProvider>
                        <ToastProvider position="bottom-right">
                            <DisableNativeContextMenu />
                            {children}
                            <SettingsDialog />
                        </ToastProvider>
                    </AppThemeProvider>
                </SettingsProvider>
            </body>
        </html>
    )
}
