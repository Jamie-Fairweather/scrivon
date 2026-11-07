'use client'

import { FolderOpenIcon, XIcon } from 'lucide-react'
import { pickOpenFile } from '@/lib/tauri/dialog'
import { rememberExportImage } from '@/lib/tauri/export-image-access'
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
    /**
     * What the image is for, e.g. "footer left image". Names the Browse and Clear
     * buttons ("Browse for footer left image") so several fields can be told apart.
     */
    label?: string
    /** File picker title; defaults to "Choose <label>". */
    title?: string
    onChange: (value: string) => void
}

/** Read-only path display with Browse (image file picker) and Clear. */
export function ImagePathField({
    id,
    value,
    placeholder = 'Choose an image',
    label = 'image',
    title = `Choose ${label}`,
    onChange,
}: ImagePathFieldProps) {
    return (
        <div className="flex min-w-0 items-center gap-2">
            <Input id={id} value={value} placeholder={placeholder} readOnly title={value || undefined} className="min-w-0 flex-1" />
            {value.trim() ? (
                <Button type="button" variant="outline" size="icon-sm" aria-label={`Clear ${label}`} onClick={() => onChange('')}>
                    <XIcon />
                </Button>
            ) : null}
            <Button
                type="button"
                variant="outline"
                size="sm"
                aria-label={`Browse for ${label}`}
                onClick={() => {
                    void pickOpenFile({
                        title,
                        defaultPath: value.trim() || undefined,
                        filters: IMAGE_FILTERS,
                    }).then((next) => {
                        if (!next) return
                        // The export only reads images the user chose, so record this one for later sessions.
                        void rememberExportImage(next)
                        onChange(next)
                    })
                }}
            >
                <FolderOpenIcon />
                Browse
            </Button>
        </div>
    )
}
