import { useEffect, useState, type ReactNode } from 'react'
import { ArrowRight, Flag, Plus, Trash2, Wrench } from 'lucide-react'
import { toast } from 'sonner'
import { Button, Input, Label, Select, Textarea } from './components/ui/primitives'
import type { Agent, FlowNode, Issue, Property, Transition } from './types'

function Field({ title, id, errors, children, help }: { title: string; id: string; errors?: Issue[]; children: ReactNode; help?: string }) {
  return <div className="space-y-2"><Label htmlFor={id}>{title}</Label>{children}{help && <p className="text-xs leading-5 text-slate-400">{help}</p>}{errors?.map((issue, index) => <p key={index} className={issue.severity === 'error' ? 'text-xs text-red-600' : 'text-xs text-amber-600'}>{issue.message}</p>)}</div>
}
function CollectedField({ name, property, required, onChange, onRename, onDelete }: { name: string; property: Property; required: boolean; onChange: (property: Property, required: boolean) => void; onRename: (name: string) => void; onDelete: () => void }) {
  const [draftName, setDraftName] = useState(name)
  useEffect(() => setDraftName(name), [name])
  const basic = !!property && typeof property === 'object' && ['string', 'number', 'integer', 'boolean'].includes(property.type || '')
  return <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
    <div className="flex gap-2"><Input aria-label={`Field name ${name}`} value={draftName} onChange={e => setDraftName(e.target.value)} onBlur={() => { if (draftName !== name) onRename(draftName); setDraftName(name) }}/><Button variant="ghost" aria-label={`Remove field ${name}`} onClick={onDelete}><Trash2/></Button></div>
    {basic ? <><Select aria-label={`Type for ${name}`} value={property.type} onChange={e => { const next = { ...property, type: e.target.value }; if (next.type !== 'string') delete next.enum; onChange(next, required) }}><option value="string">Text</option><option value="number">Number</option><option value="integer">Integer</option><option value="boolean">Yes / no</option></Select>
      <Input aria-label={`Description for ${name}`} placeholder="What should the agent collect?" value={property.description || ''} onChange={e => onChange({ ...property, description: e.target.value }, required)}/>
      {property.type === 'string' && <Input aria-label={`Choices for ${name}`} placeholder="Choices, separated by commas (optional)" value={property.enum?.join(', ') || ''} onChange={e => { const next = { ...property }; if (e.target.value.trim()) next.enum = e.target.value.split(',').map(v => v.trim()); else delete next.enum; onChange(next, required) }}/>}</> : <p className="text-xs text-slate-500">This field uses an advanced schema. Its definition is preserved.</p>}
    <label className="flex items-center gap-2 text-xs text-slate-600"><input type="checkbox" className="size-4 accent-indigo-600" checked={required} onChange={e => onChange(property, e.target.checked)}/>Required before transitioning</label>
  </div>
}
export type Selection = { node: string; edge?: string } | null
export function Inspector({ agent, selection, issues, onChange, onSelect, onDeleteNode, onDeleteEdge, onAddEdge, onEnd }: {
  agent: Agent; selection: Selection; issues: Issue[]; onChange: (agent: Agent) => void; onSelect: (selection: Selection) => void;
  onDeleteNode: (node: FlowNode) => void; onDeleteEdge: (node: FlowNode, edge: Transition) => void; onAddEdge: (node: FlowNode) => void; onEnd: (node: FlowNode, end: boolean) => void;
}) {
  const node = agent.nodes.find(n => n.id === selection?.node)
  const edge = node?.edges.find(e => e.id === selection?.edge)
  const [nodeName, setNodeName] = useState(node?.name || '')
  useEffect(() => setNodeName(node?.name || ''), [node?.id, node?.name])
  const updateNode = (patch: Partial<FlowNode>) => { if (node) onChange({ ...agent, nodes: agent.nodes.map(n => n.id === node.id ? { ...n, ...patch } : n) }) }
  const updateEdge = (patch: Partial<Transition>) => { if (node && edge) updateNode({ edges: node.edges.map(e => e.id === edge.id ? { ...e, ...patch } : e) }) }
  const fieldIssues = (field: string) => issues.filter(i => i.field === field && (node ? i.node === node.id || i.node === node.name : !i.node) && (edge ? i.edge === edge.id : !i.edge))
  function renameNode() {
    if (!node || nodeName === node.name) return
    if (!nodeName.trim() || agent.nodes.some(n => n.id !== node.id && n.name === nodeName)) { toast.error('Use a nonempty, unique node name.'); setNodeName(node.name); return }
    onChange({ ...agent, initial_node: agent.initial_node === node.name ? nodeName : agent.initial_node, nodes: agent.nodes.map(n => ({ ...n, name: n.id === node.id ? nodeName : n.name, edges: n.edges.map(e => e.target === node.name ? { ...e, target: nodeName } : e) })) })
  }
  const header = edge ? 'Transition' : node ? 'Conversation step' : 'Agent settings'
  return <aside className="flex w-[360px] shrink-0 flex-col border-l border-slate-200 bg-white" aria-label="Inspector">
    <div className="flex h-12 shrink-0 items-center justify-between border-b border-slate-100 px-4"><h2 className="text-base font-medium">{header}</h2>{selection && <Button variant="ghost" onClick={() => onSelect(null)}>Done</Button>}</div>
    <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-4">
      {!node && <>
        <Field title="Agent name" id="agent-name" errors={fieldIssues('name')}><Input id="agent-name" value={agent.name} onChange={e => onChange({ ...agent, name: e.target.value })}/></Field>
        <Field title="Global persona" id="persona" help="The voice and behavior shared by every step."><Textarea id="persona" className="min-h-40" value={agent.persona} onChange={e => onChange({ ...agent, persona: e.target.value })}/></Field>
        <Field title="Model" id="model" errors={fieldIssues('model')}><Input id="model" value={agent.model} onChange={e => onChange({ ...agent, model: e.target.value })}/></Field>
        <Field title="ElevenLabs voice ID" id="voice" errors={fieldIssues('voice_id')}><Input id="voice" value={agent.voice_id} onChange={e => onChange({ ...agent, voice_id: e.target.value })}/></Field>
        <div className="rounded-lg bg-slate-50 p-4 text-xs leading-5 text-slate-500">Select a step to edit its instructions, or a connection to configure when the conversation moves forward.</div>
      </>}
      {node && !edge && <>
        <Field title="Node name" id="node-name" errors={fieldIssues('name')}><Input id="node-name" value={nodeName} onChange={e => setNodeName(e.target.value)} onBlur={renameNode}/></Field>
        <Field title="Conversation instructions" id="instructions" errors={fieldIssues('instructions')} help="What should the agent do at this step?"><Textarea id="instructions" className="min-h-40" placeholder="Ask the caller…" value={node.task_messages[0]?.content || ''} onChange={e => updateNode({ task_messages: [{ ...node.task_messages[0], role: node.task_messages[0]?.role || 'developer', content: e.target.value }, ...node.task_messages.slice(1)] })}/></Field>
        {node.task_messages.length > 1 && <p className="text-xs text-slate-500">{node.task_messages.length - 1} additional message(s) preserved.</p>}
        <div className="flex items-center justify-between rounded-lg border border-slate-200 p-3"><span className="text-sm">Conversation starts here</span>{agent.initial_node === node.name ? <span className="text-xs font-medium text-green-600">START</span> : <Button variant="outline" onClick={() => onChange({ ...agent, initial_node: node.name })}>Set as start</Button>}</div>
        <label className="flex items-center gap-2"><input type="checkbox" className="size-4 accent-indigo-600" checked={node.end} onChange={e => onEnd(node, e.target.checked)}/><Flag className="size-4 text-red-500"/>End the call after this step</label>
        {fieldIssues('end').map(i => <p key={i.code} className="text-xs text-red-600">{i.message}</p>)}
        <div className="space-y-3"><div className="flex items-center justify-between"><h3 className="text-xs font-medium text-slate-500">OUTGOING TRANSITIONS</h3>{!node.end && <Button variant="ghost" onClick={() => onAddEdge(node)}><Plus/>Add transition</Button>}</div>
          {node.end ? <p className="text-xs leading-5 text-slate-400">This step speaks its instructions, then ends the call.</p> : node.edges.length ? node.edges.map(e => <button key={e.id} onClick={() => onSelect({ node: node.id, edge: e.id })} className="flex w-full items-center gap-2 rounded-md border border-slate-200 p-3 text-left hover:border-indigo-300"><Wrench className="size-4 text-slate-400"/><div className="min-w-0 flex-1"><p className="truncate text-sm">{e.function || 'Untitled transition'}</p><p className="mt-1 truncate text-xs text-slate-400">{e.target || 'Choose destination'}</p></div><ArrowRight className="size-4 text-slate-400"/></button>) : <p className="text-xs leading-5 text-slate-400">Add a transition or drag from this node's output to another step.</p>}
        </div>
        <Button variant="ghost" className="text-red-600" onClick={() => onDeleteNode(node)}><Trash2/>Delete node</Button>
      </>}
      {node && edge && <>
        <button className="text-xs text-indigo-600 hover:underline" onClick={() => onSelect({ node: node.id })}>← Back to {node.name}</button>
        <Field title="Function name" id="function" errors={fieldIssues('function')}><Input id="function" value={edge.function} onChange={e => updateEdge({ function: e.target.value })}/></Field>
        <Field title="When should this transition happen?" id="description" errors={fieldIssues('description')}><Textarea id="description" value={edge.description} onChange={e => updateEdge({ description: e.target.value })} placeholder="When the caller has provided their details…"/></Field>
        <Field title="Go to step" id="target" errors={fieldIssues('target')}><Select id="target" value={edge.target} onChange={e => updateEdge({ target: e.target.value })}><option value="">Choose destination</option>{agent.nodes.map(n => <option key={n.id} value={n.name}>{n.name || 'Unnamed step'}</option>)}</Select></Field>
        <div className="space-y-3"><div className="flex items-center justify-between"><h3 className="text-xs font-medium text-slate-500">INFORMATION TO COLLECT</h3><Button variant="ghost" onClick={() => { let name = 'field'; let i = 1; while (name in edge.properties) name = `field_${i++}`; updateEdge({ properties: { ...edge.properties, [name]: { type: 'string', description: '' } } }) }}><Plus/>Add field</Button></div>
          <p className="text-xs leading-5 text-slate-400">The agent collects these values before taking this transition.</p>
          {fieldIssues('properties').map(i => <p key={i.code} className="text-xs text-red-600">{i.message}</p>)}
          {Object.entries(edge.properties).map(([name, property]) => <CollectedField key={name} name={name} property={property} required={edge.required.includes(name)} onChange={(value, required) => updateEdge({ properties: { ...edge.properties, [name]: value }, required: required ? [...new Set([...edge.required, name])] : edge.required.filter(n => n !== name) })} onRename={newName => { if (!newName.trim() || newName in edge.properties) { toast.error('Use a unique field name.'); return }; updateEdge({ properties: Object.fromEntries(Object.entries(edge.properties).map(([key, value]) => [key === name ? newName : key, value])), required: edge.required.map(key => key === name ? newName : key) }) }} onDelete={() => updateEdge({ properties: Object.fromEntries(Object.entries(edge.properties).filter(([key]) => key !== name)), required: edge.required.filter(key => key !== name) })}/>)}
        </div>
        <Button variant="ghost" className="text-red-600" onClick={() => onDeleteEdge(node, edge)}><Trash2/>Delete transition</Button>
      </>}
    </div>
  </aside>
}
