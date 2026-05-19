"use client";

export default function Home() {
  const api =
    typeof window !== "undefined" ? window.electronAPI : undefined;

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-8 px-6 py-16">
      <div className="flex max-w-lg flex-col items-center gap-4 text-center">
        <span className="rounded-full border border-zinc-200 bg-zinc-100 px-3 py-1 text-xs font-medium tracking-wide text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
          Electron + Next.js + Bun + TypeScript
        </span>
        <h1 className="text-4xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Diagram App
        </h1>
        <p className="text-lg leading-8 text-zinc-600 dark:text-zinc-400">
          Desktop shell powered by Electron. UI rendered with the Next.js App
          Router and React.
        </p>
      </div>

      <div className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        <h2 className="mb-4 text-sm font-medium uppercase tracking-wide text-zinc-500">
          Runtime
        </h2>
        {api ? (
          <dl className="grid gap-3 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-zinc-500">Platform</dt>
              <dd className="font-mono text-zinc-900 dark:text-zinc-100">
                {api.platform}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-zinc-500">Electron</dt>
              <dd className="font-mono text-zinc-900 dark:text-zinc-100">
                {api.versions.electron}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-zinc-500">Chrome</dt>
              <dd className="font-mono text-zinc-900 dark:text-zinc-100">
                {api.versions.chrome}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-zinc-500">Node</dt>
              <dd className="font-mono text-zinc-900 dark:text-zinc-100">
                {api.versions.node}
              </dd>
            </div>
          </dl>
        ) : (
          <p className="text-sm text-zinc-500">
            Open this page in the Electron window to see runtime details. In a
            browser-only preview, the preload bridge is unavailable.
          </p>
        )}
      </div>

      <p className="max-w-md text-center text-sm text-zinc-500">
        Edit{" "}
        <code className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-zinc-800 dark:bg-zinc-900 dark:text-zinc-200">
          src/app/page.tsx
        </code>{" "}
        to build your UI. Use{" "}
        <code className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-zinc-800 dark:bg-zinc-900 dark:text-zinc-200">
          electron/preload.ts
        </code>{" "}
        to expose safe APIs from the main process.
      </p>
    </div>
  );
}
