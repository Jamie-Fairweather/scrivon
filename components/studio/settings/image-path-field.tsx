'use client'

import { FolderOpenIcon, XIcon } from 'lucide-react'
import { pickOpenFile } from '@/lib/tauri/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

const IMAGE_FILTERS = [
    { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'] },
    { name: 'All files', extensions: ['*'] },
]

type ImagePathFieldProps = {
    id?: string
    value: string
    placeholder?: string
    title?: string
    onChange: (value: string) => void
}

/** Read-only path display with Browse (image file picker) and Clear. */
export function ImagePathField({ id, value, placeholder = 'Choose an image', title = 'Choose image', onChange }: ImagePathFieldProps) {
    return (
        <div className="flex min-w-0 items-center gap-2">
            <Input id={id} value={value} placeholder={placeholder} readOnly title={value || undefined} className="min-w-0 flex-1" />
            {value.trim() ? (
                <Button type="button" variant="outline" size="icon-sm" aria-label="Clear path" onClick={() => onChange('')}>
                    <XIcon />
                </Button>
            ) : null}
            <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                    void pickOpenFile({
                        title,
                        defaultPath: value.trim() || undefined,
                        filters: IMAGE_FILTERS,
                    }).then((next) => {
                        if (next) onChange(next)
                    })
                }}
            >
                <FolderOpenIcon />
                Browse
            </Button>
        </div>
    )
}
