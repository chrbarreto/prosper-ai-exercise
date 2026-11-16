import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { api, type AgentResponse } from './types'
import type { CopilotSession, Marker, Scenario, SimulationResult } from './copilotTypes'
import { proposalPositions } from './graphLayout'

export function useCopilot(agentId: string | undefined, onApplied: (data: AgentResponse) => void) {
  const [open, setOpen] = useState(false)
  const [session, setSession] = useState<CopilotSession | null>(null)
  const [busy, setBusy] = useState('')
  const [operation,setOperation] = useState('')
  const [pendingMessage, setPendingMessage] = useState<{text: string; after: number} | null>(null)
  const [reviewLayout,setReviewLayout] = useState<{key: string; positions: Record<string,{x: number; y: number}>}>({key:'',positions:{}})
  const [error, setError] = useState('')
  const [markers, setMarkers] = useState<Marker[]>([])
  const [selectedScenario, setSelectedScenario] = useState<string | null>(null)
  const [selectedReview, setSelectedReview] = useState<string | null>(null)
  const [reveal, setReveal] = useState(1000)
  const stream = useRef<EventSource | null>(null)
  const currentAgent = useRef(agentId)
  currentAgent.current = agentId
  const onAppliedRef = useRef(onApplied)
  onAppliedRef.current = onApplied
  useEffect(() => {
    stream.current?.close(); stream.current = null; setOpen(false); setSession(null); setMarkers([]); setBusy(''); setOperation(''); setPendingMessage(null); setError(''); setSelectedScenario(null); setSelectedReview(null)
    return () => stream.current?.close()
  }, [agentId])
  const proposalKey = JSON.stringify(session?.proposal?.patch || [])
  useEffect(() => setReviewLayout({key:proposalKey,positions:{}}),[proposalKey,agentId])
  let previewPositions: Record<string,{x: number; y: number}> = {}
  const proposal = session?.proposal
  if (proposal && proposal.target !== 'copilot') {
    const removed = proposal.original.nodes.filter(node => !proposal.candidate.nodes.some(candidate => candidate.id === node.id))
    previewPositions = {...proposalPositions({...proposal.candidate,nodes:[...proposal.candidate.nodes,...removed]}),...(reviewLayout.key === proposalKey ? reviewLayout.positions : {})}
  }
  function movePreviewNode(id: string,position: {x: number; y: number}) {
    setReviewLayout(current => ({key:proposalKey,positions:{...(current.key === proposalKey ? current.positions : {}),[id]:position}}))
  }
  useEffect(() => {
    if (session?.proposal?.kind !== 'generation') { setReveal(1000); return }
    setReveal(0)
    const count = session.proposal.candidate.nodes.length
    const timer = setInterval(() => setReveal(value => { if (value + 1 >= count) clearInterval(timer); return Math.min(value + 1, count) }), 120)
    return () => clearInterval(timer)
  }, [proposalKey])
  async function connect() {
    if (!agentId) return
    setError('')
    try {
      const target = agentId
      const state = await api<CopilotSession>('/api/copilot/sessions', { method: 'POST', body: JSON.stringify({ agent_id: agentId }) })
      if (target !== currentAgent.current) return
      setSession(state); setOpen(true)
      if (stream.current) return state
      const source = new EventSource(`/api/copilot/sessions/${state.id}/events`)
      stream.current = source
      source.onmessage = event => {
        if (target !== currentAgent.current) return
        const data = JSON.parse(event.data)
        if (data.type === 'state') setSession(data.session)
        if (data.type === 'suite_started') {
          setMarkers(data.scenarios.map((scenario: Scenario, index: number) => ({ id: scenario.id, label: scenario.persona, node: '', status: 'running', tick: index, turns: [] })))
          setSelectedScenario(data.scenarios[0]?.id || null)
        }
        if (data.scenario_id && ['scenario_started', 'node_entered', 'turn', 'scenario_result'].includes(data.type)) {
          setMarkers(previous => {
            const existing = previous.find(marker => marker.id === data.scenario_id)
            const base: Marker = existing || { id: data.scenario_id, label: data.persona, node: '', status: 'running', tick: 0, turns: [] }
            let next = { ...base }
            if (data.type === 'node_entered' || data.type === 'scenario_started') next = { ...next, previous: data.previous || undefined, node: data.node, tick: next.tick + 1 }
            if (data.type === 'turn') { next.turns = [...next.turns, data.turn]; next.node ||= data.turn.node || '' }
            if (data.type === 'scenario_result') next = { ...next, status: data.result.status, previous: undefined, node: data.result.trace.at(-1) || next.node, turns: data.result.transcript }
            return existing ? previous.map(marker => marker.id === next.id ? next : marker) : [...previous, next]
          })
          if (data.type === 'node_entered') setTimeout(() => setMarkers(items => items.map(marker => marker.id === data.scenario_id && marker.node === data.node ? { ...marker, previous: undefined } : marker)), 750)
        }
        if (data.type === 'suite_complete') {
          setMarkers(data.suite.results.map((result: SimulationResult, index: number) => ({ id: result.scenario.id, label: result.scenario.persona, node: result.trace.at(-1) || '', status: result.status, tick: index, turns: result.transcript })))
        }
      }
      source.onerror = () => { if (target === currentAgent.current) setError('Live updates disconnected. Reconnecting…') }
      source.onopen = () => { if (target === currentAgent.current) setError('') }
      return state
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not open Copilot.') }
  }
  async function action(path: string, body: unknown = {}, label = 'Working…') {
    if (busy || session?.activity) return false
    const target = agentId
    setBusy(label); setError('')
    setOperation(path)
    if ((path === 'generate' || path === 'messages') && typeof (body as {text?: unknown}).text === 'string')
      setPendingMessage({text:(body as {text:string}).text,after:session?.messages.length || 0})
    if (path === 'review-call') setOpen(true)
    try {
      const activeSession = session || await connect()
      if (!activeSession || target !== currentAgent.current) return false
      let payload = body
      if (path === 'approve' && proposal && proposal.target !== 'copilot') {
        const ids = new Set(proposal.candidate.nodes.map(node => node.id))
        payload = {positions:Object.fromEntries(Object.entries(previewPositions).filter(([id]) => ids.has(id)))}
      }
      const data = await api<CopilotSession & { agent?: AgentResponse['agent']; session?: CopilotSession; issues: never }>(`/api/copilot/sessions/${activeSession.id}/${path}`, { method: 'POST', body: JSON.stringify(payload) })
      if (target !== currentAgent.current) return false
      if (data.session) setSession(data.session)
      else if (data.id) setSession(data)
      if (data.agent) { onAppliedRef.current({ agent: data.agent, issues: data.issues }); toast.success(path === 'approve' ? 'Proposal applied' : 'Previous version restored') }
      if (path === 'review-call') {
        const review = data.reviews.at(-1)
        if (review) { setSelectedReview(review.id); toast.success(`Call reviewed: ${review.verdict.findings.length} finding(s)`) }
      }
      return true
    } catch (reason) { if (target === currentAgent.current) setError(reason instanceof Error ? reason.message : 'Copilot request failed.'); return false }
    finally { if (target === currentAgent.current) { setBusy(''); setOperation(''); setPendingMessage(null) } }
  }
  const activity = busy || session?.activity || ''
  const preparingProposal = operation === 'generate' || operation === 'messages' || !!session?.activity
  return { open, setOpen, session, busy:activity, preparingProposal, pendingMessage, previewPositions, movePreviewNode, error, markers, selectedScenario, setSelectedScenario, selectedReview, setSelectedReview, connect, action, reveal,
           locked: !!session?.proposal || !!session?.running || !!activity }
}
export type Copilot = ReturnType<typeof useCopilot>
