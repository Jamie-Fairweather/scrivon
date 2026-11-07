'use client'

import { useEffect, useMemo, useState } from 'react'
import { Accordion, AccordionItem, AccordionPanel, AccordionTrigger } from '@/components/ui/accordion'
import { Dialog, DialogDescription, DialogHeader, DialogPanel, DialogPopup, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import type { ThirdPartyPackage } from '@/lib/legal/third-party-licenses'
import { cn } from '@/lib/utils'

type OpenSourceLicensesDialogProps = {
    open: boolean
    onOpenChange: (open: boolean) => void
}

const ECOSYSTEM_LABELS: Record<ThirdPartyPackage['ecosystem'], string> = {
    npm: 'npm package',
    rust: 'Rust crate',
    font: 'Font',
}

let packagesLoad: Promise<readonly ThirdPartyPackage[]> | null = null

/**
 * The licence list is large (every licence text), so it is loaded the first time the dialog opens instead of
 * with the app. One load is shared by every opening; after a failure, the next opening tries again.
 */
function loadPackages(): Promise<readonly ThirdPartyPackage[]> {
    if (!packagesLoad) {
        packagesLoad = import('@/lib/legal/third-party-licenses').then((module) => module.THIRD_PARTY_PACKAGES)
        packagesLoad.catch(() => {
            packagesLoad = null
        })
    }
    return packagesLoad
}

export function OpenSourceLicensesDialog({ open, onOpenChange }: OpenSourceLicensesDialogProps) {
    const [query, setQuery] = useState('')
    const [allPackages, setAllPackages] = useState<readonly ThirdPartyPackage[] | null>(null)
    const [loadFailed, setLoadFailed] = useState(false)

    useEffect(() => {
        if (!open || allPackages) return
        let cancelled = false
        loadPackages().then(
            (loaded) => {
                if (cancelled) return
                setAllPackages(loaded)
                setLoadFailed(false)
            },
            (err: unknown) => {
                console.error("Couldn't load the licence list", err)
                if (!cancelled) setLoadFailed(true)
            }
        )
        return () => {
            cancelled = true
        }
    }, [open, allPackages])

    const packages = useMemo(() => {
        if (!allPackages) return null
        const q = query.trim().toLowerCase()
        if (!q) return allPackages
        // Match the package name and licence type only. Searching the full licence text made short queries
        // ('isc', 'use') hit boilerplate words in almost every notice.
        return allPackages.filter((pkg) => pkg.name.toLowerCase().includes(q) || pkg.license.toLowerCase().includes(q))
    }, [allPackages, query])

    return (
        <Dialog
            open={open}
            onOpenChange={(next) => {
                onOpenChange(next)
                if (!next) {
                    setQuery('')
                    // The next opening tries the load again, and says it is loading meanwhile.
                    setLoadFailed(false)
                }
            }}
        >
            <DialogPopup className="flex max-h-[min(85vh,720px)] max-w-3xl flex-col">
                <DialogHeader>
                    <DialogTitle>Licences</DialogTitle>
                    <DialogDescription>
                        Third-party software included in this application build. Notices below apply to packages shipped in the desktop app.
                    </DialogDescription>
                </DialogHeader>
                {/* The filter sits outside DialogPanel so it stays put while the package list scrolls. */}
                <div className="px-6 pb-3">
                    <Input
                        type="search"
                        placeholder="Filter packages…"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        aria-label="Filter packages"
                    />
                </div>
                <DialogPanel className="pt-0">
                    {!packages ? (
                        loadFailed ? (
                            <p role="alert" className="text-sm text-destructive">
                                Couldn&apos;t load the licence list. Close Licences and open it again to retry.
                            </p>
                        ) : (
                            <p role="status" className="text-sm text-muted-foreground">
                                Loading licences…
                            </p>
                        )
                    ) : packages.length === 0 ? (
                        <p className="text-sm text-muted-foreground">No packages match your search.</p>
                    ) : (
                        <Accordion className="rounded-lg border">
                            {packages.map((pkg) => (
                                <AccordionItem key={pkg.name} value={pkg.name}>
                                    <AccordionTrigger className="px-4 hover:no-underline">
                                        <span className="flex min-w-0 flex-1 flex-col items-start gap-0.5 text-left">
                                            <span className="truncate font-medium">{pkg.name}</span>
                                            <span className="text-xs font-normal text-muted-foreground">
                                                {ECOSYSTEM_LABELS[pkg.ecosystem]} · {pkg.version ? `v${pkg.version} · ` : ''}
                                                {pkg.license}
                                            </span>
                                        </span>
                                    </AccordionTrigger>
                                    <AccordionPanel className="px-4 pb-4">
                                        {pkg.repository && (
                                            <p className="mb-3 text-xs text-muted-foreground">
                                                <a
                                                    href={pkg.repository}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="text-foreground underline-offset-4 hover:underline"
                                                >
                                                    {pkg.repository}
                                                </a>
                                            </p>
                                        )}
                                        {pkg.licenseText ? (
                                            <ScrollArea className="h-64 w-full overflow-hidden rounded-md border bg-muted/40" scrollbarGutter>
                                                <pre className={cn('p-3 font-mono text-xs leading-relaxed', 'break-words whitespace-pre-wrap')}>
                                                    {pkg.licenseText}
                                                </pre>
                                            </ScrollArea>
                                        ) : (
                                            <p className="text-sm text-muted-foreground">
                                                Licence: {pkg.license}. Full licence text was not bundled with this package metadata.
                                            </p>
                                        )}
                                    </AccordionPanel>
                                </AccordionItem>
                            ))}
                        </Accordion>
                    )}
                </DialogPanel>
            </DialogPopup>
        </Dialog>
    )
}
