'use client'

import { useMemo } from 'react'
import { ChevronRight } from 'lucide-react'
import { useDocumentTabs } from '@/components/studio/workspace/workspace-provider'
import { APP_EXAMPLES, APP_EXAMPLE_CATEGORIES, type AppExample, type AppExampleCategory } from '@/lib/examples/app-samples'
import { EXAMPLE_CATEGORY_LABELS } from '@/lib/examples/category-labels'
import { exampleTabId } from '@/lib/examples/example-tab'
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from '@/components/ui/collapsible'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'

function ExamplesByCategory({ category, examples }: { category: AppExampleCategory; examples: AppExample[] }) {
    const { activeTabId, openExample } = useDocumentTabs()

    return (
        <Collapsible defaultOpen className="border-b border-sidebar-border last:border-b-0">
            <CollapsibleTrigger
                className="flex w-full items-center gap-1 px-2 py-1.5 text-left text-xs font-medium text-muted-foreground hover:bg-muted/50
                    data-panel-open:*:data-[slot=collapsible-indicator]:rotate-90"
            >
                <ChevronRight data-slot="collapsible-indicator" className="size-3.5 shrink-0 transition-transform duration-200" />
                {EXAMPLE_CATEGORY_LABELS[category]} ({examples.length})
            </CollapsibleTrigger>
            <CollapsiblePanel>
                <ul className="pb-1">
                    {examples.map((example) => {
                        const tabId = exampleTabId(example.id)
                        const isActive = activeTabId === tabId
                        return (
                            <li key={example.id}>
                                <button
                                    type="button"
                                    className={cn(
                                        'w-full px-3 py-1.5 text-left text-xs transition-colors hover:bg-muted/50',
                                        isActive && 'bg-muted/60 font-medium text-foreground'
                                    )}
                                    onClick={() => openExample(example.id)}
                                    title={example.description}
                                >
                                    <span className="line-clamp-2">{example.title}</span>
                                </button>
                            </li>
                        )
                    })}
                </ul>
            </CollapsiblePanel>
        </Collapsible>
    )
}

export function ExamplesExplorer() {
    const byCategory = useMemo(() => {
        const map = new Map<AppExampleCategory, AppExample[]>()
        for (const cat of APP_EXAMPLE_CATEGORIES) {
            map.set(cat, [])
        }
        for (const ex of APP_EXAMPLES) {
            map.get(ex.category)?.push(ex)
        }
        return map
    }, [])

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <ScrollArea className="min-h-0 flex-1">
                {APP_EXAMPLE_CATEGORIES.map((category) => {
                    const examples = byCategory.get(category) ?? []
                    if (examples.length === 0) return null
                    return <ExamplesByCategory key={category} category={category} examples={examples} />
                })}
            </ScrollArea>
            <p className="shrink-0 border-t border-sidebar-border px-3 py-2 text-[10px] leading-snug text-muted-foreground">
                Samples from{' '}
                <a
                    href="https://agents.craft.do/mermaid"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline underline-offset-2 hover:text-foreground"
                >
                    Beautiful Mermaid by Craft
                </a>
            </p>
        </div>
    )
}
