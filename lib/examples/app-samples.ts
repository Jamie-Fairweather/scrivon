import { CRAFT_EXAMPLE_BY_ID, CRAFT_EXAMPLES, EXAMPLE_CATEGORIES } from '@/lib/examples/craft-samples'
import { MARKDOWN_SHOWCASE } from '@/lib/examples/markdown-showcase'
import type { AppExample, AppExampleCategory } from '@/lib/examples/types'

export type { AppExample, AppExampleCategory } from '@/lib/examples/types'

export const APP_EXAMPLE_CATEGORIES: AppExampleCategory[] = ['markdown', ...EXAMPLE_CATEGORIES]

export const APP_EXAMPLES: AppExample[] = [...CRAFT_EXAMPLES, MARKDOWN_SHOWCASE]

export const APP_EXAMPLE_BY_ID: Record<string, AppExample> = {
    ...CRAFT_EXAMPLE_BY_ID,
    [MARKDOWN_SHOWCASE.id]: MARKDOWN_SHOWCASE,
}
