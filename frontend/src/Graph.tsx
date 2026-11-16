import { useEffect, useMemo } from 'react'
import { Background, BaseEdge, EdgeLabelRenderer, getSmoothStepPath, Controls, Handle, MarkerType, Position, ReactFlow, useNodesState, useReactFlow, type Connection, type Node, type NodeProps, type EdgeProps } from '@xyflow/react'
import { Flag, Focus, Loader2, Maximize, MessageSquare, Play, Plus, Wrench } from 'lucide-react'
import { Button, cn } from './components/ui/primitives'
import type { Agent, FlowNode, Issue, Transition } from './types'
import type { Selection } from './Inspector'
import type { Marker } from './copilotTypes'
import '@xyflow/react/dist/style.css'

type CardData = { node: FlowNode; start: boolean; issues: Issue[]; change?: string; personas: (Marker & { number: number })[]; onPersona: (id: string) => void; selectEdge: (edge: Transition) => void }
type CardNode = Node<CardData, 'conversation'>
function ConversationNode({ data, selected }: NodeProps<CardNode>) {
  const { node, start, issues, selectEdge } = data
  const errors = issues.filter(i => i.severity === 'error').length
  const Icon = node.end ? Flag : start ? Play : MessageSquare
  return <div data-testid={`node-${node.id}`} className={cn('w-[220px] rounded-lg border border-l-4 border-slate-200 bg-white shadow-sm', node.end ? 'border-l-red-400' : start ? 'border-l-green-500' : 'border-l-slate-300', data.change === 'added' && 'border-green-400 bg-green-50/40', data.change === 'changed' && 'border-amber-400 bg-amber-50/40', data.change === 'removed' && 'border-dashed border-red-400 opacity-50', selected && 'ring-2 ring-indigo-500', issues.length > 0 && (errors ? 'ring-2 ring-red-400' : 'ring-2 ring-amber-400'))}>
    <Handle type="target" position={Position.Left} className="!size-3 !border-2 !border-white !bg-slate-400"/>
    <div className="flex items-center gap-2 border-b border-slate-100 px-3 py-3"><Icon className={cn('size-4 shrink-0', node.end ? 'text-red-500' : start ? 'text-green-600' : 'text-blue-500')}/><span className="min-w-0 flex-1 truncate text-sm font-medium">{node.name || 'Unnamed step'}</span>{issues.length > 0 && <span className={cn('rounded px-1 text-xs', errors ? 'bg-red-50 text-red-600' : 'bg-amber-50 text-amber-600')}>{issues.length}</span>}</div>
    <div className="space-y-3 p-3"><p className="line-clamp-2 text-xs leading-5 text-slate-500">{node.task_messages[0]?.content || 'Add conversation instructions…'}</p>
      {node.edges.length > 0 && <div className="flex flex-wrap gap-1">{node.edges.slice(0, 3).map(edge => <button key={edge.id} className="nodrag flex max-w-full items-center gap-1 rounded bg-slate-100 px-2 py-1 text-xs text-slate-600 hover:bg-indigo-50 hover:text-indigo-600" onClick={event => { event.stopPropagation(); selectEdge(edge) }}><Wrench className="size-3 shrink-0"/><span className="truncate">{edge.function || 'transition'}</span></button>)}{node.edges.length > 3 && <span className="text-xs text-slate-400">+{node.edges.length - 3}</span>}</div>}
      {data.change && <p className="text-xs font-medium capitalize text-slate-500">{data.change}</p>}
      {!!data.personas.length && <div className="flex flex-wrap gap-1">{data.personas.map(persona => <button title={persona.label} aria-label={`Inspect ${persona.label}`} key={persona.id} onClick={event => { event.stopPropagation(); data.onPersona(persona.id) }} className={cn('nodrag flex size-6 items-center justify-center rounded-full text-xs font-medium text-white', persona.status === 'failed' ? 'bg-red-500' : persona.status === 'passed' ? 'bg-green-500' : persona.status === 'error' ? 'bg-amber-500' : 'bg-indigo-500')}>{persona.number}</button>)}</div>}
      {(start || node.end) && <p className={cn('text-xs font-medium', node.end ? 'text-red-500' : 'text-green-600')}>{start && 'START'}{start && node.end && ' · '}{node.end && 'END'}</p>}
    </div>
    {!node.end && <Handle type="source" position={Position.Right} className="!size-3 !border-2 !border-white !bg-indigo-500"/>}
  </div>
}
const nodeTypes = { conversation: ConversationNode }
function PersonaEdge(props: EdgeProps) {
  const [path, x, y] = getSmoothStepPath({...props,offset:32,borderRadius:12})
  const markers = (props.data?.markers || []) as Marker[]
  return <><BaseEdge id={props.id} path={path} style={props.style} markerEnd={props.markerEnd}/>
    {markers.map(marker => <circle key={`${marker.id}-${marker.tick}`} r={6} fill="#6366f1" stroke="white" strokeWidth={2}><animateMotion path={path} dur="0.7s" fill="freeze"/></circle>)}
    <EdgeLabelRenderer><button type="button" title={String(props.label)} aria-label={`Transition ${props.label}`} onClick={props.data?.onSelect as () => void} className="nodrag nopan pointer-events-auto absolute max-w-60 break-all rounded-md border border-slate-200 bg-white px-2 py-1 text-xs leading-5 text-slate-600 shadow-sm hover:border-indigo-300" style={{ transform: `translate(-50%, -50%) translate(${x}px,${y}px)` }}>{props.label}</button></EdgeLabelRenderer>
  </>
}
const edgeTypes = { persona: PersonaEdge }
const EMPTY_MARKERS: Marker[] = []
const EMPTY_CHANGES: { id: string; change: string }[] = []
const NOOP = () => {}

export function Graph({ agent, selection, issues, onSelect, onChange, onConnect, onAdd, focus, markers = EMPTY_MARKERS, changes = EMPTY_CHANGES, onPersona = NOOP, readOnly = false, reviewKey, onReviewPosition, preparing = false }: { agent: Agent; selection: Selection; issues: Issue[]; onSelect: (selection: Selection) => void; onChange: (agent: Agent) => void; onConnect: (connection: Connection) => void; onAdd: (end: boolean) => void; focus: { id: string; tick: number } | null; markers?: Marker[]; changes?: { id: string; change: string }[]; onPersona?: (id: string) => void; readOnly?: boolean; reviewKey?: string; onReviewPosition?: (id: string, position: {x: number; y: number}) => void; preparing?: boolean }) {
  const initialNodes = useMemo(() => agent.nodes.map((node, index) => ({ id: node.id, type: 'conversation' as const, position: agent.editor.positions?.[node.id] || { x: index * 300, y: 120 }, selected: selection?.node === node.id && !selection.edge, data: { node, change: changes.find(c => c.id === node.id)?.change, personas: markers.map((m, index) => ({...m, number:index+1})).filter(m => m.node === node.name && !m.previous), onPersona, start: agent.initial_node === node.name, issues: issues.filter(i => i.node === node.id || i.node === node.name), selectEdge: (edge: Transition) => onSelect({ node: node.id, edge: edge.id }) } })), [agent, selection, issues, onSelect, markers, changes, onPersona])
  const [nodes, setNodes, onNodesChange] = useNodesState<CardNode>(initialNodes)
  useEffect(() => setNodes(initialNodes), [initialNodes, setNodes])
  const flow = useReactFlow()
  useEffect(() => {
    if (!focus) return
    const timer = setTimeout(() => {
      const node = flow.getNode(focus.id)
      if (node) void flow.setCenter(node.position.x + 110, node.position.y + 80, { zoom: 1, duration: 200 })
    }, 50)
    return () => clearTimeout(timer)
  }, [focus, flow, nodes.length])
  useEffect(() => {
    if (!reviewKey || !nodes.length) return
    const timer = setTimeout(() => { void flow.fitView({ nodes:flow.getNodes().slice(0,2), padding: 0.2, minZoom:0.65, maxZoom: 1, duration: 200 }) }, 100)
    return () => clearTimeout(timer)
  }, [reviewKey, nodes.length, flow])
  const edges = agent.nodes.flatMap(node => node.edges.flatMap(edge => {
    const target = agent.nodes.find(n => n.name === edge.target)
    if (!target) return []
    const selected = selection?.edge === edge.id
    const invalid = issues.some(i => i.edge === edge.id && i.severity === 'error')
    return [{ id: edge.id, source: node.id, target: target.id, type: 'persona', data: { markers: markers.filter(m => m.previous === node.name && m.node === target.name), onSelect: () => onSelect({node:node.id,edge:edge.id}) }, label: edge.function || 'transition', selected, markerEnd: { type: MarkerType.ArrowClosed, color: invalid ? '#ef4444' : selected ? '#6366f1' : '#94a3b8' }, style: { stroke: invalid ? '#ef4444' : selected ? '#6366f1' : '#94a3b8', strokeWidth: selected ? 2 : 1.5, strokeDasharray: agent.nodes.indexOf(target) <= agent.nodes.indexOf(node) ? '5 4' : undefined }, labelStyle: { fontSize: 12, fill: '#64748b' }, labelBgStyle: { fill: '#fff', stroke: '#e2e8f0' }, labelBgPadding: [8, 4] as [number, number], labelBgBorderRadius: 6 }]
  }))
  return <div className="relative min-h-0 flex-1 bg-slate-50" aria-label="Conversation graph" aria-busy={preparing}>
    <div className="absolute left-4 top-4 z-10 flex max-w-[calc(100%-2rem)] flex-wrap items-center gap-2">{reviewKey ? <><Button variant="outline" onClick={() => { void flow.fitView({padding:0.2,minZoom:0.15,maxZoom:1,duration:200}) }}><Maximize/>Fit graph</Button><Button variant="outline" onClick={() => { const node=flow.getNode(selection?.node || agent.nodes[0]?.id); if (node) void flow.setCenter(node.position.x+110,node.position.y+100,{zoom:1,duration:200}) }}><Focus/>Readable view</Button><span className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-500">Drag nodes to arrange this preview</span></> : <><Button variant="outline" disabled={readOnly} onClick={() => onAdd(false)}><Plus/>Add step</Button><Button variant="outline" disabled={readOnly} onClick={() => onAdd(true)}><Flag/>Add end step</Button></>}</div>
    {preparing && <div className="absolute inset-0 z-20 flex cursor-wait items-center justify-center bg-slate-50/90 p-8 backdrop-blur-sm"><div role="status" aria-label="Copilot processing brief" className="w-full max-w-sm rounded-lg border border-indigo-100 bg-white p-8 text-center shadow-sm"><Loader2 aria-hidden="true" className="mx-auto mb-6 size-12 animate-spin text-indigo-600"/><p className="text-base font-medium">Copilot is working…</p><p className="mt-2 text-sm leading-6 text-slate-500">Processing your instructions and preparing a response.</p></div></div>}
    {!agent.nodes.length && !preparing && <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center"><div className="pointer-events-auto rounded-lg border border-slate-200 bg-white p-8 text-center shadow-sm"><MessageSquare className="mx-auto mb-4 size-8 text-slate-300"/><p className="mb-4 text-base font-medium">Add your first node</p><Button disabled={readOnly} onClick={() => onAdd(false)}><Plus/>Add step</Button></div></div>}
    <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} onNodesChange={onNodesChange} onNodeClick={(_, node) => onSelect({ node: node.id })} onPaneClick={() => onSelect(null)} onEdgeClick={(_, edge) => { const owner = agent.nodes.find(n => n.edges.some(e => e.id === edge.id)); if (owner) onSelect({ node: owner.id, edge: edge.id }) }} onConnect={onConnect} onNodeDragStop={(_, node) => {
      if (reviewKey) onReviewPosition?.(node.id,node.position)
      else if (!readOnly) onChange({ ...agent, editor: { ...agent.editor, positions: { ...agent.editor.positions, [node.id]: node.position } } })
    }} nodesConnectable={!readOnly} nodesDraggable={!readOnly || (!!reviewKey && !!onReviewPosition)} deleteKeyCode={null} fitView fitViewOptions={{ padding: 0.3, maxZoom: 1 }} minZoom={0.15} maxZoom={1.5}>
      <Background color="#cbd5e1" gap={24} size={1}/><Controls showInteractive={false}/>
    </ReactFlow>
  </div>
}
