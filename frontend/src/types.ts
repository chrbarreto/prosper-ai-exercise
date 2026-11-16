export type Property = { type?: string; description?: string; enum?: string[]; [key: string]: unknown }
export type Transition = { id: string; function: string; description: string; target: string; properties: Record<string, Property>; required: string[]; [key: string]: unknown }
export type FlowNode = { id: string; name: string; task_messages: { role: string; content: string; [key: string]: unknown }[]; edges: Transition[]; end: boolean; role_message?: string | null; [key: string]: unknown }
export type Agent = { id: string; name: string; persona: string; model: string; voice_id: string; initial_node: string; nodes: FlowNode[]; editor: { positions?: Record<string, { x: number; y: number }>; [key: string]: unknown }; [key: string]: unknown }
export type Issue = { severity: 'error' | 'warning'; code: string; message: string; node: string | null; edge: string | null; field: string | null }
export type Summary = { id: string; name: string; node_count: number; errors: number; warnings: number }
export type AgentResponse = { agent: Agent; issues: Issue[] }
export async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...options, headers: { 'Content-Type': 'application/json', ...options?.headers } })
  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    throw new Error(typeof body.detail === 'string' ? body.detail : `Request failed (${response.status}).`)
  }
  return response.status === 204 ? undefined as T : response.json()
}
export function normalize(agent: Agent): Agent {
  return { ...agent, editor: agent.editor || {}, nodes: agent.nodes.map((node, index) => ({ ...node, id: node.id || `node-${index}`, end: !!node.end, task_messages: node.task_messages || [], edges: (node.edges || []).map((edge, i) => ({ ...edge, id: edge.id || `edge-${index}-${i}`, properties: edge.properties || {}, required: edge.required || [] })) })) }
}
