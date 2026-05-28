import type { CraftExample, ExampleCategory as MermaidExampleCategory } from '@/lib/examples/craft-samples'

export type { CraftExample, MermaidExampleCategory }

export type AppExampleCategory = MermaidExampleCategory | 'markdown'

export type AppExample = Omit<CraftExample, 'category'> & {
    category: AppExampleCategory
}
