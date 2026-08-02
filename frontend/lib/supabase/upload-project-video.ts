import { createSupabaseBrowser } from '@/lib/supabase/client'

export interface UploadedVideo {
  publicUrl: string
  storagePath: string
  title: string
}

/**
 * Push a video file into the public `project-assets` bucket and return its public
 * URL — that URL is what VideoDB ingests, so the bucket has to stay public.
 */
export async function uploadProjectVideo(
  projectId: string,
  file: File
): Promise<UploadedVideo> {
  const supabase = createSupabaseBrowser()

  const safeName = file.name.replace(/[^\w.\-]+/g, '_')
  const storagePath = `${projectId}/videos/${crypto.randomUUID()}-${safeName}`

  const { data, error } = await supabase.storage
    .from('project-assets')
    .upload(storagePath, file, { contentType: file.type || 'video/mp4', upsert: false })

  if (error) {
    // Supabase caps uploads at 50MB by default; the message is otherwise cryptic.
    if (/exceeded the maximum allowed size|payload too large/i.test(error.message)) {
      throw new Error(
        `"${file.name}" is larger than the storage limit. Raise the bucket file-size limit in Supabase, or add it by URL instead.`
      )
    }
    throw new Error(`Upload failed for "${file.name}": ${error.message}`)
  }

  const {
    data: { publicUrl },
  } = supabase.storage.from('project-assets').getPublicUrl(data.path)

  return {
    publicUrl,
    storagePath: data.path,
    title: file.name.replace(/\.[^.]+$/, ''),
  }
}
