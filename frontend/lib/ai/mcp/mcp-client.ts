import { createMCPClient, MCPClient } from '@ai-sdk/mcp'
import { MCP_SERVERS, MCPServerConfig } from './mcp-config'

interface MCPClientEntry {
  name: string
  client: MCPClient
}

let mcpClients: MCPClientEntry[] = []
let initializationPromise: Promise<void> | null = null
let isInitialized = false

async function initializeMCPClients(): Promise<void> {
  if (MCP_SERVERS.length === 0) {
    console.log('[MCP] No servers configured')
    return
  }

  console.log(`[MCP] Initializing ${MCP_SERVERS.length} server(s)...`)

  const clientPromises = MCP_SERVERS.map(async (server: MCPServerConfig) => {
    try {
      const client = await createMCPClient({
        transport: {
          type: 'http',
          url: server.url,
          headers: server.headers,
        },
      })

      console.log(`[MCP] Connected to server: ${server.name}`)
      return { name: server.name, client }
    } catch (error) {
      console.error(`[MCP] Failed to connect to ${server.name}:`, error)
      return null
    }
  })

  const results = await Promise.all(clientPromises)
  mcpClients = results.filter((entry): entry is MCPClientEntry => entry !== null)

  console.log(
    `[MCP] Successfully connected to ${mcpClients.length}/${MCP_SERVERS.length} server(s)`
  )
}

async function ensureInitialized(): Promise<void> {
  if (isInitialized) return

  if (!initializationPromise) {
    initializationPromise = initializeMCPClients().then(() => {
      isInitialized = true
    })
  }

  await initializationPromise
}

export async function getMCPTools(): Promise<Record<string, any>> {
  await ensureInitialized()

  if (mcpClients.length === 0) {
    return {}
  }

  const allTools: Record<string, any> = {}

  for (const { name, client } of mcpClients) {
    try {
      const tools = await client.tools()

      for (const [toolName, tool] of Object.entries(tools)) {
        const prefixedName = `${name}_${toolName}`
        allTools[prefixedName] = tool
      }
    } catch (error) {
      console.error(`[MCP] Failed to get tools from ${name}:`, error)
    }
  }

  return allTools
}

export async function closeMCPClients(): Promise<void> {
  for (const { name, client } of mcpClients) {
    try {
      await client.close()
      console.log(`[MCP] Closed connection to: ${name}`)
    } catch (error) {
      console.error(`[MCP] Error closing ${name}:`, error)
    }
  }
  mcpClients = []
  isInitialized = false
  initializationPromise = null
}
