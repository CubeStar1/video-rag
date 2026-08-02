import { redirect } from 'next/navigation'

type Params = Promise<{ projectId: string }>

/**
 * There is no standalone "blank chat" page. The project workspace is where a
 * chat starts: it creates the conversation on submit and routes to it.
 */
export default async function Page({ params }: { params: Params }) {
  const { projectId } = await params
  redirect(`/projects/${projectId}`)
}
