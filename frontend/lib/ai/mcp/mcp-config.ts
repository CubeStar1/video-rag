export interface MCPServerConfig {
  name: string
  url: string
  headers?: Record<string, string>
}

export const MCP_SERVERS: MCPServerConfig[] = [
  {
    name: 'cicd',
    url: process.env.CICD_MCP_URL || 'http://localhost:8000/mcp',
  },
]
