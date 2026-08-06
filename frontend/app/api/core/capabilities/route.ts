import { getUser } from '@/app/agent/hooks/get-user'
import { core, CoreApiError } from '@/lib/core/client'

export const revalidate = 60

/**
 * What this core install can actually do: its analyzers, vector fields,
 * exclusive groups, aggregators and filters.
 *
 * The upload dialog builds its analyzer list from this rather than from a
 * constant, because core's contract is that adding an analyzer touches one
 * module and one registry line — a hardcoded list here would quietly make that
 * "…and the frontend". Cached briefly: the answer only changes when core is
 * redeployed.
 */
export async function GET() {
  const user = await getUser()
  if (!user) return new Response('Unauthorized', { status: 401 })

  try {
    return Response.json(await core.capabilities())
  } catch (error: any) {
    const status = error instanceof CoreApiError ? error.status : 502
    return new Response(error?.message || 'Could not reach the analysis backend', { status })
  }
}
