/**
 * Utility for robust client-side file downloads across all modern browsers and environments.
 *
 * Solutions implemented:
 * 1. Native File System Access API (`showSaveFilePicker`) where available (Chrome, Edge on desktop):
 *    - Opens the native OS "Save As" dialog with `suggestedName` and extension pre-filled.
 *    - Bypasses external download managers (IDM) and browser URL heuristics completely.
 *    - Directly streams binary data to disk, avoiding corruptions.
 * 2. Base64 Data URL Fallback:
 *    - Avoids `blob:` URL path UUID fallback in Chrome/Edge.
 *    - External download managers do not intercept `data:` URLs.
 * 3. Clean Anchor Object URL Fallback:
 *    - Strips `rel="noopener noreferrer"` which breaks the `download` attribute in Chromium.
 */
export async function downloadBlob(blob: Blob, filename: string, mimeType?: string): Promise<void> {
  if (typeof window === 'undefined') return

  const effectiveMime = mimeType || blob.type || 'application/octet-stream'
  const effectiveBlob = blob.type !== effectiveMime
    ? new Blob([blob], { type: effectiveMime })
    : blob

  // Extract extension for file picker configuration
  const extMatch = filename.match(/\.([a-zA-Z0-9]+)$/)
  const ext = extMatch ? `.${extMatch[1].toLowerCase()}` : ''

  // ── Tier 1: Native File System Access API (Chrome, Edge, Opera) ──
  if (typeof window.showSaveFilePicker === 'function') {
    try {
      const pickerOptions: SaveFilePickerOptions = {
        suggestedName: filename,
      }
      if (ext) {
        let desc = 'File'
        if (ext === '.pdf') desc = 'PDF Document (*.pdf)'
        else if (ext === '.xlsx') desc = 'Excel Spreadsheet (*.xlsx)'
        else if (ext === '.csv') desc = 'CSV File (*.csv)'

        pickerOptions.types = [
          {
            description: desc,
            accept: { [effectiveMime]: [ext] },
          },
        ]
      }

      const handle = await window.showSaveFilePicker(pickerOptions)
      const writable = await handle.createWritable()
      await writable.write(effectiveBlob)
      await writable.close()
      return
    } catch (err: unknown) {
      // User cancelled the file save dialog — do not trigger fallback or error
      if (err instanceof Error && err.name === 'AbortError') {
        return
      }
      console.warn('[downloadBlob] showSaveFilePicker failed or was not allowed, attempting data URL fallback:', err)
    }
  }

  // ── Tier 2: Base64 Data URL ──
  // Data URLs do not have a URL path, preventing browser/IDM UUID fallback.
  try {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onloadend = () => {
        if (typeof reader.result === 'string') resolve(reader.result)
        else reject(new Error('FileReader did not return a string'))
      }
      reader.onerror = () => reject(reader.error)
      reader.readAsDataURL(effectiveBlob)
    })

    const a = document.createElement('a')
    a.style.display = 'none'
    a.href = dataUrl
    a.download = filename
    // Note: Do NOT set `a.rel = 'noreferrer'` here as it causes Chromium to treat
    // the download as cross-origin and discard the `download` filename!

    document.body.appendChild(a)
    a.click()

    window.setTimeout(() => {
      try {
        if (document.body.contains(a)) {
          document.body.removeChild(a)
        }
      } catch {
        // Ignore
      }
    }, 1000)
    return
  } catch (dataUrlErr) {
    console.warn('[downloadBlob] Data URL download failed, falling back to object URL:', dataUrlErr)
  }

  // ── Tier 3: Standard Object URL with Clean Anchor ──
  const url = window.URL.createObjectURL(effectiveBlob)
  const a = document.createElement('a')
  a.style.display = 'none'
  a.href = url
  a.download = filename

  document.body.appendChild(a)
  a.click()

  window.setTimeout(() => {
    try {
      if (document.body.contains(a)) {
        document.body.removeChild(a)
      }
      window.URL.revokeObjectURL(url)
    } catch {
      // Ignore
    }
  }, 45000)
}

