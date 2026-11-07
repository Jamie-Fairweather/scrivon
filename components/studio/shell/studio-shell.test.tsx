import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { StudioShell } from './studio-shell'

type Crashable = 'name-prompt' | 'delete-confirm' | 'app-update'

const crash = vi.hoisted(() => ({ in: null as string | null }))

function CrashingDialog({ owner }: { owner: Crashable }) {
    if (crash.in === owner) throw new Error(`${owner} dialog exploded`)
    return null
}

// Each provider renders its dialog next to its children, like the real ones do.
function providerWithDialog(owner: Crashable) {
    return function Provider({ children }: { children: ReactNode }) {
        return (
            <>
                {children}
                <CrashingDialog owner={owner} />
            </>
        )
    }
}

vi.mock('@/components/studio/workspace/workspace-provider', () => ({
    WorkspaceProvider: ({ children }: { children: ReactNode }) => children,
    useWorkspaceSession: () => ({ hydrated: false, workspaceRoot: null }),
    useDocumentSave: () => ({ flushAllSaves: async () => true }),
}))
vi.mock('@/components/studio/hooks/use-window-close', () => ({ useWindowCloseHandler: vi.fn() }))
vi.mock('@/components/studio/shell/use-native-window-title', () => ({ NativeWindowTitle: () => null }))
vi.mock('@/components/studio/shell/studio-layout', () => ({ StudioLayout: () => null }))
vi.mock('@/components/studio/shell/studio-menu-bar', () => ({ StudioMenuBar: () => null }))
vi.mock('@/components/studio/shell/welcome-screen', () => ({ WelcomeScreen: () => null }))
vi.mock('@/components/studio/dialogs/name-prompt-provider', () => ({ NamePromptProvider: providerWithDialog('name-prompt') }))
vi.mock('@/components/studio/dialogs/delete-confirm-provider', () => ({ DeleteConfirmProvider: providerWithDialog('delete-confirm') }))
vi.mock('@/components/studio/app-update-provider', () => ({ AppUpdateProvider: providerWithDialog('app-update') }))

beforeEach(() => {
    crash.in = null
    vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
    vi.restoreAllMocks()
})

describe('StudioShell', () => {
    it.each<Crashable>(['name-prompt', 'delete-confirm', 'app-update'])('offers to save open files when the %s dialog crashes', (owner) => {
        crash.in = owner
        render(<StudioShell />)

        expect(screen.getByRole('alert')).toHaveTextContent(`${owner} dialog exploded`)
        expect(screen.getByRole('button', { name: 'Save and reload' })).toBeInTheDocument()
    })
})
