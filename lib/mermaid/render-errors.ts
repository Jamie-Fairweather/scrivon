/**
 * What the diagram renderers share: how long a render may take and the errors a render can end with. Both the
 * worker queue (render-client.ts) and the official mermaid queue (render-official.ts) use them, so a slow or
 * dropped render reads the same whichever engine drew it.
 */

/** A render taking longer than this is stopped, so a huge or hostile diagram can't tie the renderer up. */
export const RENDER_TIMEOUT_MS = 20_000
export const RENDER_TIMEOUT_MESSAGE = 'This diagram is too big to draw. Try splitting it into smaller diagrams.'

/** The render was dropped before it started: a newer text for the same document came in, or every view waiting for it went away. */
export class SupersededRenderError extends Error {
    constructor() {
        super('A newer version of this diagram replaced this render.')
        this.name = 'SupersededRenderError'
    }
}

/**
 * The renderer couldn't be loaded on the main thread. Nothing is wrong with the diagram, so this isn't
 * remembered like a parse error: the next render tries the load again.
 */
export class RendererLoadError extends Error {
    constructor(cause: unknown) {
        super("Couldn't load the diagram renderer. Edit the diagram or switch tabs to try again.", { cause })
        this.name = 'RendererLoadError'
    }
}
