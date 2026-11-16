import type { Agent } from './types'

// Preview layout reserves a full label-width corridor between conversation steps.
export function proposalPositions(agent: Agent): Record<string,{x: number; y: number}> {
  const firstByName = new Map<string,Agent['nodes'][number]>()
  for (const node of agent.nodes) if (!firstByName.has(node.name)) firstByName.set(node.name,node)
  const start = firstByName.get(agent.initial_node) || agent.nodes[0]
  if (!start) return {}
  const depth = new Map([[start.id,0]])
  const queue = [start]
  for (let index=0;index<queue.length;index++) {
    const node = queue[index]
    for (const edge of node.edges) {
      const target = firstByName.get(edge.target)
      if (target && !depth.has(target.id)) {
        depth.set(target.id,depth.get(node.id)!+1)
        queue.push(target)
      }
    }
  }
  const lastColumn = Math.max(...depth.values())+1
  const columns = new Map<number,typeof agent.nodes>()
  for (const node of agent.nodes) {
    const column = depth.get(node.id) ?? lastColumn
    columns.set(column,[...(columns.get(column) || []),node])
  }
  const longestLabel = Math.max(0,...agent.nodes.flatMap(node => node.edges.map(edge => edge.function.length)))
  const corridor = Math.max(200,Math.min(240,longestLabel*7)+48)
  const positions: Record<string,{x: number; y: number}> = {}
  for (const [column,nodes] of columns) nodes.forEach((node,index) => {
    positions[node.id] = {x:80+column*(220+corridor),y:200+(index-(nodes.length-1)/2)*360}
  })
  return positions
}
