// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { applyThemeToDocument } from './apply-document-theme'

afterEach(() => {
    const root = document.documentElement
    root.removeAttribute('style')
    root.removeAttribute('data-app-theme')
    root.classList.remove('dark')
})

describe('applyThemeToDocument', () => {
    it('sets a dark colour scheme for dark themes so native scrollbars and controls are dark', () => {
        applyThemeToDocument('scrivon-dark')

        const root = document.documentElement
        expect(root.style.colorScheme).toBe('dark')
        expect(root.classList.contains('dark')).toBe(true)
        expect(root.dataset.appTheme).toBe('scrivon-dark')
    })

    it('switches back to a light colour scheme for light themes', () => {
        applyThemeToDocument('nord')
        applyThemeToDocument('github-light')

        const root = document.documentElement
        expect(root.style.colorScheme).toBe('light')
        expect(root.classList.contains('dark')).toBe(false)
    })
})
