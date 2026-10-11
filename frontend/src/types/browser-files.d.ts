interface SaveFilePickerOptions {
  suggestedName?: string
  types?: Array<{ description?: string; accept: Record<string, string[]> }>
}
interface Window {
  __originalFetch?: typeof fetch
  showSaveFilePicker?: (options?: SaveFilePickerOptions) => Promise<{
    createWritable(): Promise<{ write(data: Blob): Promise<void>; close(): Promise<void> }>
  }>
}
