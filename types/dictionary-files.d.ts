// Hunspell dictionary files, bundled as text (turbopack.rules in next.config.mjs).
declare module '*.aff' {
    const text: string
    export default text
}

declare module '*.dic' {
    const text: string
    export default text
}
