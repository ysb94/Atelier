import { useEffect, useRef, useState } from 'react'
import { SamplePackFileDownloads } from './SamplePackFileDownloads'
import {
  downloadSamplePackBlob, getPublishedSamplePack, safeSamplePackName,
  SAMPLE_PACK_BUFFER_LIMIT, samplePackSize, streamSamplePackZip, type SamplePack,
} from '@/lib/supabase/sample-work-order-packs'

type SavePicker = (options: { suggestedName: string }) => Promise<{ createWritable: () => Promise<WritableStream<Uint8Array>> }>

export function useSamplePackDownload() {
  const [pack, setPack] = useState<SamplePack | null>(null)
  const complete = useRef<((saved: boolean) => void) | null>(null)
  useEffect(() => () => { complete.current?.(false) }, [])

  async function download(id: string, label: string) {
    const latest = await getPublishedSamplePack(id)
    const name = `${safeSamplePackName(label)}.zip`
    if (samplePackSize(latest) <= SAMPLE_PACK_BUFFER_LIMIT) {
      const stream = await streamSamplePackZip(latest)
      const chunks: BlobPart[] = []
      await stream.pipeTo(new WritableStream({ write: chunk => { chunks.push(chunk.slice().buffer) } }))
      downloadSamplePackBlob(new Blob(chunks, { type: 'application/zip' }), name)
      return true
    }

    const picker = (window as Window & { showSaveFilePicker?: SavePicker }).showSaveFilePicker
    if (picker && navigator.userActivation?.isActive) {
      let target
      try {
        target = await picker.call(window, { suggestedName: name })
      } catch (cause) {
        if (cause instanceof DOMException && cause.name === 'AbortError') return false
        if (!(cause instanceof DOMException && cause.name === 'SecurityError')) throw cause
      }
      if (target) {
        const stream = await streamSamplePackZip(latest)
        await stream.pipeTo(await target.createWritable())
        return true
      }
    }

    return new Promise<boolean>(resolve => {
      complete.current = resolve
      setPack(latest)
    })
  }

  function close(saved: boolean) {
    complete.current?.(saved)
    complete.current = null
    setPack(null)
  }

  return { download, dialog: pack && <SamplePackFileDownloads pack={pack} onClose={close} /> }
}
