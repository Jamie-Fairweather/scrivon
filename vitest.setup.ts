import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'
import '@testing-library/jest-dom/vitest'
import './vitest/mocks/tauri'

// happy-dom has no Web Animations API; Base UI popups, menus and scroll areas ask for running animations.
if (typeof Element.prototype.getAnimations !== 'function') {
    Object.defineProperty(Element.prototype, 'getAnimations', { configurable: true, writable: true, value: () => [] })
}

afterEach(() => {
    cleanup()
})
