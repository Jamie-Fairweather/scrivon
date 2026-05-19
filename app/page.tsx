'use client'

import { useState } from 'react'
import Image from 'next/image'
import { invoke } from '@tauri-apps/api/core'

export default function Home() {
    const [greetMsg, setGreetMsg] = useState('')
    const [name, setName] = useState('')

    async function greet() {
        setGreetMsg(await invoke('greet', { name }))
    }

    return (
        <main className="container">
            <h1>Welcome to Tauri + Next.js</h1>

            <div className="row">
                <a href="https://nextjs.org" target="_blank" rel="noreferrer">
                    <Image src="/next.svg" className="logo next" alt="Next.js logo" width={96} height={96} />
                </a>
                <a href="https://tauri.app" target="_blank" rel="noreferrer">
                    <Image src="/tauri.svg" className="logo tauri" alt="Tauri logo" width={96} height={96} />
                </a>
                <a href="https://react.dev" target="_blank" rel="noreferrer">
                    <Image src="/react.svg" className="logo react" alt="React logo" width={96} height={96} />
                </a>
            </div>

            <p>Click on the Tauri, Next.js, and React logos to learn more.</p>

            <form
                className="row"
                onSubmit={(e) => {
                    e.preventDefault()
                    greet()
                }}
            >
                <input id="greet-input" onChange={(e) => setName(e.currentTarget.value)} placeholder="Enter a name..." />
                <button type="submit">Greet</button>
            </form>
            <p>{greetMsg}</p>
        </main>
    )
}
