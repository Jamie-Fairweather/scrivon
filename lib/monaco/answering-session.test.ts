import { describe, expect, it } from 'vitest'
import { createAnsweringSessions } from '@/lib/monaco/answering-session'

describe('the session that answers for a buffer', () => {
    it('is one of the sessions checking it, so a buffer in both groups gets each quick fix once', () => {
        const answering = createAnsweringSessions()
        const left = () => 'buffer-a'
        const right = () => 'buffer-a'
        const other = () => 'buffer-b'
        answering.add(left)
        const removeRight = answering.add(right)
        answering.add(other)

        expect([left, right].filter((session) => answering.answers(session, 'buffer-a'))).toHaveLength(1)
        expect(answering.answers(other, 'buffer-b')).toBe(true)
        expect(answering.answers(right, 'buffer-b')).toBe(false)

        removeRight()
        expect(answering.answers(left, 'buffer-a')).toBe(true)
    })

    it('is the latest session when none checks the buffer, as with one editor', () => {
        const answering = createAnsweringSessions()
        const none = () => null
        answering.add(none)
        expect(answering.answers(none, 'buffer-a')).toBe(true)
    })
})
