import { createSupabaseBrowser } from '@/lib/supabase/client'
import type { FileUIPart } from 'ai'

export async function uploadChatAttachment(projectId: string, file: File): Promise<FileUIPart> {
  const supabase = createSupabaseBrowser()

  const fileId = crypto.randomUUID()
  const storagePath = `${projectId}/chat-attachments/${fileId}-${file.name}`

  const { data: uploadData, error: uploadError } = await supabase.storage
    .from('project-assets')
    .upload(storagePath, file)

  if (uploadError) {
    console.error('Error uploading chat attachment:', uploadError)
    throw new Error('Failed to upload attachment')
  }

  const {
    data: { publicUrl },
  } = supabase.storage.from('project-assets').getPublicUrl(uploadData.path)

  return {
    type: 'file',
    url: publicUrl,
    filename: file.name,
    mediaType: file.type,
  }
}

export async function uploadChatAttachments(
  projectId: string,
  files: File[]
): Promise<FileUIPart[]> {
  return Promise.all(files.map((file) => uploadChatAttachment(projectId, file)))
}
