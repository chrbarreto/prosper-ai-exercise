import { useCallback, useEffect, useRef, useState } from 'react'
import { ReactFlowProvider, type Connection } from '@xyflow/react'
import { AlertCircle, ArrowLeft, ArrowRight, Check, ChevronDown, ChevronUp, Headphones, Loader2, MessageSquare, Mic, MicOff, Phone, PhoneOff, Plus, Save, Sparkles, Users, Trash2 } from 'lucide-react'
import { toast, Toaster } from 'sonner'
import { Button, ConfirmDialog, Input, cn } from './components/ui/primitives'
import { Graph } from './Graph'
import { Inspector, type Selection } from './Inspector'
import { api, normalize, type Agent, type AgentResponse, type FlowNode, type Issue, type Summary, type Transition } from './types'
import { useVoice } from './useVoice'
import { useCopilot } from './useCopilot'
import { CopilotPanel, SimulationResults } from './CopilotPanel'
import type { Finding } from './copilotTypes'
import { sourceLabel } from './CallReview'

function routeId() { return window.location.pathname.match(/^\/agents\/([^/]+)$/)?.[1] || null }
function App() {
  const [agents, setAgents] = useState<Summary[]>([])
  const [agent, setAgent] = useState<Agent | null>(null)
  const agentRef = useRef(agent)
  agentRef.current = agent
  const [saved, setSaved] = useState('')
  const [issues, setIssues] = useState<Issue[]>([])
  const [selection, setSelection] = useState<Selection>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [serverError, setServerError] = useState('')
  const [fileErrors, setFileErrors] = useState<{ file: string; message: string }[]>([])
  const [saveFailed, setSaveFailed] = useState(false)
  const [drawer, setDrawer] = useState<'issues' | 'call' | 'simulations' | null>(null)
  const [confirmation, setConfirmation] = useState<{ title: string; description: string; action: () => void | Promise<void> } | null>(null)
  const [focus, setFocus] = useState<{ id: string; tick: number } | null>(null)
  const voice = useVoice()
  const copilot = useCopilot(agent?.id, response => { applyDocument(response); void refresh() })
  const copilotLocked = copilot.locked
  useEffect(() => { if (copilot.session?.running) setDrawer('simulations') }, [copilot.session?.running])
  useEffect(() => { if (agent && sessionStorage.getItem('open-copilot') === agent.id) { sessionStorage.removeItem('open-copilot'); void copilot.connect() } }, [agent?.id])
  const transcriptBottom = useRef<HTMLDivElement>(null)
  const dirty = !!agent && JSON.stringify(agent) !== saved
  const errorCount = issues.filter(i => i.severity === 'error').length
  const warningCount = issues.filter(i => i.severity === 'warning').length
  const callIssueCount = (copilot.session?.issues || []).filter(i => i.status === 'open').length
  const canReviewCall = !!agent && voice.callingAgentId === agent.id && !voice.isCopilot && !voice.active && voice.transcript.some(turn => turn.speaker === 'Caller') && voice.transcript.some(turn => turn.speaker === 'Agent')
  const selected = useCallback((value: Selection) => setSelection(value), [])

  async function refresh() {
    try {
      const data = await api<{ agents: Summary[]; errors: typeof fileErrors }>('/api/agents')
      setAgents(data.agents); setFileErrors(data.errors); setServerError('')
      return true
    } catch { setServerError("Can't reach the server on port 8000. Is make api running?"); return false }
  }
  function applyDocument(response: AgentResponse) {
    const next = normalize(response.agent)
    agentRef.current = next
    setAgent(next); setSaved(JSON.stringify(next)); setIssues(response.issues); setSelection(null); setSaveFailed(false)
  }
  useEffect(() => {
    void (async () => {
      if (await refresh()) {
        const id = routeId()
        if (id) {
          try { applyDocument(await api<AgentResponse>(`/api/agents/${id}`)) }
          catch (reason) { toast.error(String(reason)); window.history.replaceState({}, '', '/') }
        }
      }
      setLoading(false)
    })()
  }, [])
  useEffect(() => {
    if (!agent) return
    let cancelled = false
    const timer = setTimeout(() => {
      void api<{ issues: Issue[] }>(`/api/agents/${agent.id}/validate`, { method: 'POST', body: JSON.stringify(agent) })
        .then(data => { if (!cancelled) setIssues(data.issues) })
        .catch(() => { if (!cancelled) setServerError("Can't reach the server on port 8000. Is make api running?") })
    }, 300)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [agent])
  useEffect(() => { transcriptBottom.current?.scrollIntoView({ block: 'nearest' }) }, [voice.transcript, drawer])

  async function saveCurrent(manual = false): Promise<AgentResponse | null> {
    const current = agentRef.current
    if (!current) return null
    try {
      const response = await api<AgentResponse>(`/api/agents/${current.id}`, { method: 'PUT', body: JSON.stringify(current) })
      const next = normalize(response.agent)
      if (agentRef.current === current) {
        agentRef.current = next; setAgent(next); setIssues(response.issues)
      }
      setSaved(JSON.stringify(next)); setSaveFailed(false); setServerError('')
      if (manual) toast.success('Agent saved')
      await refresh()
      return { agent: next, issues: response.issues }
    } catch (reason) {
      setSaveFailed(true); toast.error(`Save failed. Try again. ${reason instanceof Error ? reason.message : ''}`)
      return null
    }
  }
  async function manualSave() { setBusy(true); try { await saveCurrent(true) } finally { setBusy(false) } }
  async function go(id: string | null, call = false, push = true) {
    if (busy || copilotLocked) return
    if (id === agent?.id) { if (call) await testCall(); return }
    setBusy(true)
    try {
      if (dirty && !await saveCurrent()) return
      await voice.reset()
      setLoading(true); setDrawer(null); setSelection(null)
      if (id) {
        const response = await api<AgentResponse>(`/api/agents/${id}`)
        applyDocument(response)
        if (push) window.history.pushState({}, '', `/agents/${id}`)
        if (call) {
          setDrawer('call')
          if (response.issues.some(i => i.severity === 'error')) { setDrawer('issues'); toast.error('Fix the errors before starting a call.') }
          else await voice.start(response.agent)
        }
      } else {
        setAgent(null); agentRef.current = null; setSaved(''); setIssues([])
        if (push) window.history.pushState({}, '', '/')
      }
    } catch (reason) { toast.error(reason instanceof Error ? reason.message : 'Could not open agent.') }
    finally { setBusy(false); setLoading(false) }
  }
  const navigation = useRef(go)
  navigation.current = go
  useEffect(() => {
    const onPop = () => { void navigation.current(routeId(), false, false) }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])
  async function create(template: 'blank' | 'clinic', withCopilot = false) {
    if (busy || copilotLocked) return
    setBusy(true)
    try {
      if (dirty && !await saveCurrent()) return
      await voice.reset()
      const response = await api<AgentResponse>('/api/agents', { method: 'POST', body: JSON.stringify({ template }) })
      if (withCopilot) sessionStorage.setItem('open-copilot', response.agent.id)
      applyDocument(response); setDrawer(null); window.history.pushState({}, '', `/agents/${response.agent.id}`)
      await refresh(); toast.success('Agent created')
    } catch (reason) { toast.error(reason instanceof Error ? reason.message : 'Could not create agent.') }
    finally { setBusy(false) }
  }
  function deleteAgent(summary: Summary) {
    setConfirmation({ title: `Delete ${summary.name}?`, description: 'This agent and its saved conversation graph will be permanently removed.', action: async () => {
      try {
        if (agentRef.current?.id === summary.id) await voice.reset()
        await api(`/api/agents/${summary.id}`, { method: 'DELETE' })
        if (agentRef.current?.id === summary.id) { setAgent(null); agentRef.current = null; setSaved(''); setDrawer(null); setSelection(null); window.history.pushState({}, '', '/') }
        await refresh(); toast.success('Agent deleted')
      } catch (reason) { toast.error(reason instanceof Error ? reason.message : 'Could not delete agent.') }
    } })
  }
  function update(next: Agent) { setAgent(next); agentRef.current = next; setSaveFailed(false) }
  function addNode(end: boolean) {
    if (!agent) return
    let index = 1, name = end ? 'end' : 'step'
    while (agent.nodes.some(n => n.name === name)) name = `${end ? 'end' : 'step'}_${index++}`
    const node: FlowNode = { id: crypto.randomUUID(), name, task_messages: [{ role: 'developer', content: '' }], edges: [], end }
    const x = agent.nodes.length ? Math.max(...agent.nodes.map((n, i) => agent.editor.positions?.[n.id]?.x ?? i * 300)) + 300 : 80
    update({ ...agent, initial_node: agent.nodes.length ? agent.initial_node : name, nodes: [...agent.nodes, node], editor: { ...agent.editor, positions: { ...agent.editor.positions, [node.id]: { x, y: 160 } } } })
    setSelection({ node: node.id }); setFocus({ id: node.id, tick: Date.now() })
  }
  function addEdge(node: FlowNode, target = '') {
    if (!agent || node.end) return
    let fn = 'continue_conversation', index = 1
    while (node.edges.some(e => e.function === fn)) fn = `continue_conversation_${index++}`
    const edge: Transition = { id: crypto.randomUUID(), function: fn, description: '', target, properties: {}, required: [] }
    update({ ...agent, nodes: agent.nodes.map(n => n.id === node.id ? { ...n, edges: [...n.edges, edge] } : n) })
    setSelection({ node: node.id, edge: edge.id })
  }
  function connect(connection: Connection) {
    const source = agent?.nodes.find(n => n.id === connection.source)
    const target = agent?.nodes.find(n => n.id === connection.target)
    if (source && target) addEdge(source, target.name)
  }
  function deleteNode(node: FlowNode) {
    if (!agent) return
    const incoming = agent.nodes.flatMap(n => n.edges).filter(e => e.target === node.name).length
    setConfirmation({ title: `Delete node ${node.name}?`, description: `${incoming} incoming and ${node.edges.length} outgoing transition(s) will be removed too.`, action: () => {
      const positions = { ...agent.editor.positions }; delete positions[node.id]
      update({ ...agent, initial_node: agent.initial_node === node.name ? '' : agent.initial_node, nodes: agent.nodes.filter(n => n.id !== node.id).map(n => ({ ...n, edges: n.edges.filter(e => e.target !== node.name) })), editor: { ...agent.editor, positions } }); setSelection(null)
    } })
  }
  function deleteEdge(node: FlowNode, edge: Transition) {
    if (!agent) return
    setConfirmation({ title: `Delete transition ${edge.function}?`, description: `The transition from ${node.name} to ${edge.target || 'an unselected step'} and its collected fields will be removed.`, action: () => { update({ ...agent, nodes: agent.nodes.map(n => n.id === node.id ? { ...n, edges: n.edges.filter(e => e.id !== edge.id) } : n) }); setSelection({ node: node.id }) } })
  }
  function setEnd(node: FlowNode, end: boolean) {
    if (!agent) return
    const action = () => update({ ...agent, nodes: agent.nodes.map(n => n.id === node.id ? { ...n, end, edges: end ? [] : n.edges } : n) })
    if (end && node.edges.length) setConfirmation({ title: 'Make this an end step?', description: `${node.edges.length} outgoing transition(s) will be removed.`, action })
    else action()
  }
  async function testCall() {
    if (!agent || busy || copilotLocked || (voice.active && !voice.isCopilot)) return
    setBusy(true)
    try {
      const result = await saveCurrent()
      if (!result) return
      if (result.issues.some(i => i.severity === 'error')) { setDrawer('issues'); toast.error('Fix the errors before starting a call.'); return }
      await voice.reset()
      setDrawer('call')
      await voice.start(result.agent)
    } finally { setBusy(false) }
  }
  function selectIssue(issue: Issue) {
    setDrawer('issues')
    if (issue.node && agent) {
      const node = agent.nodes.find(n => n.id === issue.node || n.name === issue.node)
      if (node) { setSelection({ node: node.id, ...(issue.edge ? { edge: issue.edge } : {}) }); setFocus({ id: node.id, tick: Date.now() }) }
    } else setSelection(null)
    const fields: Record<string, string> = { name: issue.node ? 'node-name' : 'agent-name', voice_id: 'voice' }
    if (issue.field) setTimeout(() => document.getElementById(fields[issue.field!] || issue.field!)?.focus(), 0)
  }
  async function openCopilot() {
    if (copilot.open) { if (!copilotLocked) copilot.setOpen(false); return }
    setBusy(true)
    try { if (dirty && !await saveCurrent()) return; if (voice.active) await voice.stop(); await copilot.connect() }
    finally { setBusy(false) }
  }
  async function analyzeTestCall() {
    if (!agent || !canReviewCall || busy || copilotLocked) return
    setBusy(true)
    try {
      if (dirty && !await saveCurrent()) return
      if (await copilot.action('review-call',{
        agent_id:voice.callingAgentId, source:'test call', name:`Test call · ${voice.callingAgent}`.slice(0,120),
        transcript:voice.transcript.map(turn => ({role:turn.speaker === 'Agent' ? 'assistant' : 'user',text:turn.text})),
      },'Reviewing test call against saved guidelines…')) { copilot.setOpen(true); setDrawer('issues') }
    } finally { setBusy(false) }
  }
  function selectFinding(finding: Finding) {
    const node = agent?.nodes.find(n => n.name === finding.node || n.id === finding.node)
    if (node) { setSelection({ node: node.id }); setFocus({ id: node.id, tick: Date.now() }) }
  }
  const proposal = copilot.session?.proposal
  const reviewKey = proposal && proposal.target !== 'copilot' ? JSON.stringify(proposal.patch) : undefined
  let displayAgent = agent
  if (agent && proposal && proposal.target !== 'copilot') {
    const candidate = normalize(proposal.candidate)
    const removed = proposal.original.nodes.filter(n => !candidate.nodes.some(c => c.id === n.id))
    displayAgent = { ...candidate, editor: { ...candidate.editor, positions:copilot.previewPositions }, nodes: [...candidate.nodes.slice(0, copilot.reveal), ...removed] }
  }
  const behavioralIssues: Issue[] = (copilot.session?.issues || []).filter(i => i.status === 'open' && i.source === 'simulation' && i.node).map(i => ({ severity: 'error', code: i.category, message: i.explanation, node: i.node, edge: null, field: null }))
  const navDisabled = busy || loading || copilotLocked
  return <div className="flex h-screen min-w-[1040px] flex-col overflow-hidden">
    <Toaster position="bottom-right" richColors/>
    {serverError && <div role="alert" className="flex shrink-0 items-center justify-between gap-4 border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800"><span>{serverError}</span><Button variant="outline" onClick={() => { void refresh().then(ok => { if (ok && !agent && routeId()) void go(routeId()) }) }}>Retry</Button></div>}
    <header className="flex h-12 shrink-0 items-center gap-4 border-b border-slate-200 bg-white px-4">
      <button onClick={() => void go(null)} disabled={navDisabled} className="flex w-[228px] shrink-0 items-center gap-2 text-base font-medium"><span className="flex size-7 items-center justify-center rounded-md bg-indigo-600 text-white"><Headphones className="size-4"/></span>Prosper<span className="ml-1 text-xs font-normal text-slate-400">Agent builder</span></button>
      {agent ? <><Input aria-label="Rename agent" className="h-8 max-w-80 border-transparent px-0 text-xl font-medium hover:border-slate-200 focus:px-2" value={agent.name} disabled={busy || copilotLocked} onChange={e => update({ ...agent, name: e.target.value })}/><span className={cn('flex items-center gap-2 text-xs', saveFailed ? 'text-red-600' : 'text-slate-400')}><span className={cn('size-1 rounded-full', saveFailed ? 'bg-red-500' : dirty ? 'bg-amber-500' : 'bg-green-500')}/>{saveFailed ? 'Save failed. Try again.' : busy && dirty ? 'Saving…' : dirty ? 'Unsaved changes' : 'Saved'}</span><div className="ml-auto flex items-center gap-2"><Button variant={copilot.open ? "default" : "outline"} disabled={busy || loading || copilotLocked} onClick={() => void openCopilot()}><Sparkles/>Copilot</Button><Button variant="outline" disabled={busy || loading || copilotLocked} onClick={() => void manualSave()}><Save/>Save</Button><Button disabled={busy || copilotLocked || (voice.active && !voice.isCopilot) || loading} onClick={() => void testCall()}>{busy ? <Loader2 className="animate-spin"/> : <Phone/>}Test call</Button></div></> : <span className="text-sm text-slate-400">Your voice agents</span>}
    </header>
    <div className="flex min-h-0 flex-1">
      <nav aria-label="Agents" className="flex w-[260px] shrink-0 flex-col border-r border-slate-200 bg-white p-4">
        <button disabled={navDisabled} onClick={() => void go(null)} className="mb-6 flex items-center gap-2 text-xs text-slate-500 hover:text-indigo-600"><ArrowLeft className="size-3"/>All agents</button>
        <div className="mb-4 flex items-center justify-between"><span className="text-xs font-medium text-slate-400">AGENT PROFILES</span><span className="text-xs text-slate-400">{agents.length}</span></div>
        <Button variant="outline" className="mb-4 justify-start" disabled={navDisabled} onClick={() => void create('blank')}><Plus/>New agent</Button>
        <div className="min-h-0 flex-1 space-y-1 overflow-y-auto">
          {loading && !agents.length ? [1, 2, 3].map(i => <div key={i} className="h-10 animate-pulse rounded-md bg-slate-100"/>) : agents.map(item => <div key={item.id} className={cn('group flex items-center rounded-md', item.id === agent?.id ? 'bg-indigo-50 text-indigo-700' : 'text-slate-600 hover:bg-slate-50')}><button disabled={navDisabled} onClick={() => void go(item.id)} className="flex min-w-0 flex-1 items-center gap-2 p-2 text-left"><MessageSquare className="size-4 shrink-0"/><span className="truncate">{item.id === agent?.id ? agent.name || 'Untitled agent' : item.name || 'Untitled agent'}</span></button><button disabled={navDisabled} aria-label={`Delete ${item.name}`} className="mr-2 rounded p-1 text-slate-400 opacity-0 hover:text-red-500 focus:opacity-100 group-hover:opacity-100" onClick={() => deleteAgent(item)}><Trash2 className="size-3"/></button></div>)}
        </div>
        <div className="mt-4 border-t border-slate-100 pt-4 text-xs leading-5 text-slate-400">Build a conversation.<br/>Connect its steps. Try it out.</div>
      </nav>
      {loading ? <main className="flex flex-1 items-center justify-center"><Loader2 className="size-6 animate-spin text-indigo-500"/><span className="sr-only">Loading agent</span></main> : !agent ? <main className="min-w-0 flex-1 overflow-y-auto p-8">
        <div className="mx-auto max-w-4xl"><div className="mb-8 flex items-center justify-between"><div><h1 className="text-xl font-medium">Voice agents</h1><p className="mt-2 text-sm text-slate-500">Design a conversation, then hear it come to life.</p></div>{agents.length > 0 && <div className="flex gap-2"><Button disabled={busy} variant="outline" onClick={() => void create('blank')}><Plus/>New agent</Button><Button disabled={busy} onClick={() => void create('blank', true)}><Sparkles/>Create with Copilot</Button></div>}</div>
        {fileErrors.map(item => <div key={item.file} role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{item.file}: {item.message}</div>)}
        {!agents.length ? <div className="rounded-lg border border-slate-200 bg-white p-12 text-center shadow-sm"><div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-lg bg-indigo-50"><Headphones className="size-6 text-indigo-500"/></div><h2 className="text-base font-medium">Create your first agent</h2><p className="mb-6 mt-2 text-sm text-slate-500">Start with a blank canvas or explore a ready-made conversation.</p><div className="flex justify-center gap-3"><Button disabled={busy} onClick={() => void create('blank', true)}><Sparkles/>Create with Copilot</Button><Button disabled={busy} variant="outline" onClick={() => void create('blank')}><Plus/>Create agent</Button><Button variant="outline" disabled={busy} onClick={() => void create('clinic')}>Start from the clinic scheduler<ArrowRight/></Button></div></div> : <div className="grid grid-cols-2 gap-4">{agents.map(item => <article key={item.id} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm"><div className="mb-4 flex items-start gap-3"><div className="rounded-lg bg-slate-100 p-3"><MessageSquare className="size-5 text-slate-500"/></div><div className="min-w-0 flex-1"><h2 className="truncate text-base font-medium">{item.name || 'Untitled agent'}</h2><p className="mt-1 text-xs text-slate-400">{item.node_count} conversation step{item.node_count === 1 ? '' : 's'}</p></div><Button aria-label={`Delete ${item.name} from library`} disabled={busy} variant="ghost" onClick={() => deleteAgent(item)}><Trash2/></Button></div><div className="mb-6 flex items-center gap-2 text-xs">{item.errors ? <span className="rounded bg-red-50 px-2 py-1 text-red-600">{item.errors} error{item.errors === 1 ? '' : 's'}</span> : <span className="rounded bg-green-50 px-2 py-1 text-green-700">Ready to test</span>}{item.warnings > 0 && <span className="text-amber-600">{item.warnings} warning{item.warnings === 1 ? '' : 's'}</span>}</div><div className="flex gap-2"><Button disabled={busy} variant="outline" onClick={() => void go(item.id)}>Open editor<ArrowRight/></Button><Button disabled={busy} variant="ghost" onClick={() => void go(item.id, true)}><Phone/>Test call</Button></div></article>)}</div>}
        </div>
      </main> : <ReactFlowProvider key={agent.id}><div className="flex min-w-0 flex-1 flex-col">
        <div className={cn('flex min-h-0 flex-1', busy && 'pointer-events-none')}><Graph agent={displayAgent || agent} selection={selection} issues={[...issues, ...behavioralIssues]} onSelect={selected} onChange={update} onConnect={connect} onAdd={addNode} focus={focus} readOnly={copilotLocked} reviewKey={reviewKey} onReviewPosition={copilot.busy ? undefined : copilot.movePreviewNode} preparing={copilot.preparingProposal} markers={copilot.markers} changes={proposal?.target !== 'copilot' ? proposal?.changes : undefined} onPersona={id => { copilot.setSelectedScenario(id); setDrawer('simulations') }}/></div>
        {proposal && <div className="flex items-center gap-2 border-t border-indigo-100 bg-indigo-50 px-4 py-2 text-xs text-indigo-700"><Sparkles className="size-4"/>Proposed changes · not saved. Review and Apply or Reject in the Copilot.</div>}
        <section className="shrink-0 border-t border-slate-200 bg-white" aria-label="Agent drawer"><div className="flex h-10 items-center gap-1 px-4"><button className={cn('flex h-full items-center gap-2 border-b-2 px-3 text-xs', drawer === 'issues' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-500')} onClick={() => setDrawer(drawer === 'issues' ? null : 'issues')}><AlertCircle className="size-4"/>Issues{errorCount + warningCount + (copilot.session?.issues.filter(i => i.status === 'open').length || 0) > 0 && <span className={errorCount ? 'text-red-600' : 'text-amber-600'}>{errorCount + warningCount + (copilot.session?.issues.filter(i => i.status === 'open').length || 0)}</span>}</button><button className={cn('flex h-full items-center gap-2 border-b-2 px-3 text-xs', drawer === 'call' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-500')} onClick={() => setDrawer(drawer === 'call' ? null : 'call')}><Phone className="size-4"/>Test call{voice.active && <span className="size-2 rounded-full bg-green-500"/>}</button><button className={cn('flex h-full items-center gap-2 border-b-2 px-3 text-xs', drawer === 'simulations' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-500')} onClick={() => setDrawer(drawer === 'simulations' ? null : 'simulations')}><Users className="size-4"/>Callers</button><button aria-label={drawer ? 'Collapse drawer' : 'Expand drawer'} className="ml-auto rounded p-1 text-slate-400" onClick={() => setDrawer(drawer ? null : 'issues')}>{drawer ? <ChevronDown className="size-4"/> : <ChevronUp className="size-4"/>}</button></div>
          {drawer === 'issues' && <div className="max-h-56 overflow-y-auto border-t border-slate-100 p-4">{!issues.length && !copilot.session?.issues.length ? <p className="flex items-center gap-2 text-xs text-slate-500"><Check className="size-4 text-green-500"/>No issues</p> : <><p className="mb-3 text-xs text-slate-400">{errorCount} error{errorCount === 1 ? '' : 's'} · {warningCount} warning{warningCount === 1 ? '' : 's'} · {callIssueCount} call finding(s)</p>{[...issues].sort((a, b) => a.severity.localeCompare(b.severity)).map((issue, index) => <button key={index} onClick={() => selectIssue(issue)} className="flex w-full items-start gap-2 rounded p-2 text-left text-xs hover:bg-slate-50"><AlertCircle className={cn('mt-0 size-4 shrink-0', issue.severity === 'error' ? 'text-red-500' : 'text-amber-500')}/><span>{issue.message}</span></button>)}{copilot.session?.issues.map(finding => <div key={finding.id} className="flex items-start gap-3 rounded-md border-t border-slate-100 py-3"><button className="min-w-0 flex-1 space-y-1 text-left text-xs" onClick={() => selectFinding(finding)}><p className="font-medium">{finding.explanation}</p><p className="text-slate-400">{sourceLabel(finding.source)}{finding.call_name && ` · ${finding.call_name}`}{finding.evidence_turn && ` · turn ${finding.evidence_turn}`} · {finding.category.replaceAll('_',' ')} · {finding.status.replaceAll('_',' ')}</p><p className="italic text-slate-500">“{finding.evidence}”</p></button>{finding.call_id && <Button variant="ghost" onClick={() => { copilot.setOpen(true); copilot.setSelectedReview(finding.call_id!); }}>View call</Button>}<Button variant="outline" disabled={copilotLocked || finding.status !== 'open'} onClick={async () => { if (!copilot.open) await copilot.connect(); await copilot.action('fix',{issue_id:finding.id},'Reproducing issue and proposing a fix…') }}>Fix</Button></div>)}</>}</div>}
          {drawer === 'simulations' && <div className="max-h-[360px] overflow-y-auto border-t border-slate-100"><SimulationResults copilot={copilot}/></div>}
          {drawer === 'call' && <div className="border-t border-slate-100 p-4"><div className="mb-3 flex items-center gap-3"><span className={cn('size-2 rounded-full', voice.status === 'connected' ? 'bg-green-500' : voice.status === 'error' ? 'bg-red-500' : 'bg-slate-300')}/><span className="text-xs capitalize">{voice.status === 'idle' ? 'Ready to call' : voice.status}{voice.callingAgent && ` · ${voice.callingAgent}`}</span><div className="ml-auto flex gap-2">{voice.active ? <><Button variant="outline" onClick={voice.toggleMute} aria-label={voice.muted ? 'Unmute microphone' : 'Mute microphone'}>{voice.muted ? <MicOff/> : <Mic/>}{voice.muted ? 'Unmute' : 'Mute'}</Button><Button variant="destructive" onClick={() => void voice.stop()}><PhoneOff/>End call</Button></> : <><Button variant="outline" disabled={!canReviewCall || busy || copilotLocked} onClick={() => void analyzeTestCall()}><Sparkles/>Analyze this call</Button><Button disabled={busy || copilotLocked} onClick={() => void testCall()}><Phone/>{voice.status === 'error' ? 'Retry call' : 'Connect'}</Button></>}</div></div>{voice.error && <p role="alert" className="mb-3 rounded-md bg-red-50 p-3 text-xs leading-5 text-red-600">{voice.error}</p>}<div aria-label="Live transcript" aria-live="polite" className="h-36 space-y-3 overflow-y-auto rounded-md border border-slate-100 bg-slate-50 p-3">{!voice.transcript.length && <p className="text-xs text-slate-400">The live transcript will appear here when you speak with the agent.</p>}{voice.groupedTranscript.map((line, index) => <p key={index} className="flex gap-3 text-xs leading-5"><span className={cn('w-12 shrink-0 font-medium', line.speaker === 'Agent' ? 'text-indigo-600' : 'text-slate-500')}>{line.speaker}</span><span>{line.text}</span></p>)}<div ref={transcriptBottom}/></div></div>}
        </section>
      </div>{copilot.open ? <CopilotPanel copilot={copilot} voice={voice} agent={agent} onReviewed={() => setDrawer('issues')}/> : <fieldset disabled={busy || copilotLocked} className="flex min-w-0"><Inspector agent={agent} selection={selection} issues={issues} onChange={update} onSelect={selected} onDeleteNode={deleteNode} onDeleteEdge={deleteEdge} onAddEdge={addEdge} onEnd={setEnd}/></fieldset>}</ReactFlowProvider>}
    </div>
    <ConfirmDialog confirmation={confirmation} onClose={() => setConfirmation(null)}/>
  </div>
}
export default App
