import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { AlertCircle, ArrowRight, Check, ChevronDown, Loader2, MessageSquare, Mic, PhoneOff, Play, RotateCcw, Send, Sparkles, X } from 'lucide-react'
import { api, type Agent } from './types'
import { Button, Textarea, cn } from './components/ui/primitives'
import type { Copilot } from './useCopilot'
import type { Voice } from './useVoice'
import type { Proposal } from './copilotTypes'
import { CallReviews, ImportCall } from './CallReview'

const DEMO_BRIEF = `Build an inbound voice assistant for a fictional clinic, answering calls from patients. Help callers book, cancel, or ask about billing. Collect their name and booking reference when needed. Explain that actions are simulated. Demo appointments are Tuesday at 10 or Thursday at 2. If asked for a person, offer a simulated team follow-up without claiming a real transfer. For the billing demo, the fictional account balance is 80 demo credits. Keep a friendly tone and brief spoken replies.`
function textValue(value: unknown) { return typeof value === 'string' ? value : JSON.stringify(value, null, 2) }
function ProposalReview({ proposal, copilot }: { proposal: Proposal; copilot: Copilot }) {
  const [showJson, setShowJson] = useState(false)
  const spec = proposal.candidate.copilot as { spec?: { agent_role?: string; human_role?: string; call_direction?: 'inbound' | 'outbound'; policies: string[]; intents: string[]; fields: string[]; escalation_rules: string[]; tone: string; assumptions: string[] }; scenarios?: { persona: string; goal: string; expected: string[] }[] } | undefined
  return <div className="space-y-4 border-y border-indigo-100 bg-indigo-50/50 p-4">
    <div className="flex items-center gap-2 text-sm font-medium text-indigo-700"><Sparkles className="size-4"/>Review proposed changes</div>
    <p className="text-xs leading-5 text-slate-600">{proposal.summary}</p>
    {proposal.reproduction && <div className={cn('rounded-md p-3 text-xs leading-5', proposal.reproduction.status === 'reproduced' ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700')}><span className="font-medium">{proposal.reproduction.status === 'reproduced' ? 'Failure reproduced before this patch.' : 'Failure was not reproduced.'}</span>{proposal.reproduction.status !== 'reproduced' && ' This is a proposed improvement, not a verified repair.'}<p className="mt-1">{proposal.reproduction.result.verdict?.summary}</p></div>}
    {proposal.test_changes && <p className="rounded-md bg-amber-50 p-3 text-xs leading-5 text-amber-700">This proposal replaces the specification and five tests. It starts a new comparison baseline.</p>}
    {spec?.spec && proposal.kind === 'generation' && <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-3 text-xs leading-5"><p className="font-medium">Specification</p>{spec.spec.agent_role && <p><span className="font-medium text-slate-500">Agent role:</span> {spec.spec.agent_role}</p>}{spec.spec.human_role && <p><span className="font-medium text-slate-500">Human role:</span> {spec.spec.human_role}</p>}{spec.spec.call_direction && <p><span className="font-medium text-slate-500">Call initiated by:</span> {spec.spec.call_direction === 'outbound' ? 'Agent (outbound)' : 'Human (inbound)'}</p>}{(['intents','fields','policies','escalation_rules','assumptions'] as const).map(key => <div key={key}><p className="mb-1 font-medium capitalize text-slate-500">{key.replace('_',' ')}</p>{spec.spec![key].map((line,index) => <p key={index}>• {line}</p>)}</div>)}<p><span className="font-medium">Tone:</span> {spec.spec.tone}</p><p className="border-t border-slate-100 pt-3 font-medium">Five caller scenarios</p>{spec.scenarios?.map(s => <p key={s.persona}><span className="font-medium capitalize">{s.persona}:</span> {s.goal}<span className="mt-1 block text-slate-500">Expected: {s.expected.join(' · ')}</span></p>)}</div>}
    <div className="space-y-2">{proposal.changes.map(change => <p key={change.id} className="flex items-center gap-2 text-xs"><span className={cn('rounded px-2 py-1', change.change === 'added' ? 'bg-green-50 text-green-700' : change.change === 'removed' ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700')}>{change.change}</span>{change.name}</p>)}</div>
    <button className="flex items-center gap-1 text-xs text-indigo-600" onClick={() => setShowJson(!showJson)}><ChevronDown className="size-3"/>{showJson ? 'Hide' : 'Show'} field-level diff</button>
    {showJson && <div className="max-h-80 space-y-3 overflow-auto rounded-md border border-slate-200 bg-white p-3">{proposal.patch.map((operation,index) => { const keys = operation.path.split('/').slice(1).map(k => k.replace(/~1/g,'/').replace(/~0/g,'~')); let original: unknown = proposal.original; for (const key of keys) original = original && typeof original === 'object' ? (original as Record<string,unknown>)[key] : undefined; return <div key={index} className="space-y-2 text-xs"><p className="break-all font-medium">{operation.op} {operation.path}</p>{original !== undefined && <pre className="whitespace-pre-wrap break-words rounded bg-red-50 p-2 text-red-700">− {textValue(original)}</pre>}{operation.value !== undefined && <pre className="whitespace-pre-wrap break-words rounded bg-green-50 p-2 text-green-700">+ {textValue(operation.value)}</pre>}</div> })}</div>}
    <div className="flex gap-2"><Button disabled={!!copilot.busy} onClick={() => void copilot.action('approve',{},'Applying…')}><Check/>Apply</Button><Button disabled={!!copilot.busy} variant="outline" onClick={() => void copilot.action('reject',{},'Discarding…')}><X/>Reject</Button></div>
    <p className="text-xs leading-5 text-slate-400">Arrange nodes as you review. Apply saves the proposed conversation and this layout.</p>
  </div>
}
export function CopilotPanel({ copilot, voice, agent, onReviewed }: { copilot: Copilot; voice: Voice; agent: Agent; onReviewed: () => void }) {
  const [text,setText] = useState('')
  const [voiceBusy,setVoiceBusy] = useState(false)
  const [reviewOpen,setReviewOpen] = useState(false)
  const bottom = useRef<HTMLDivElement>(null)
  const session = copilot.session
  const voiceMode = voice.isCopilot && voice.active
  const preparing = copilot.preparingProposal && !agent.nodes.length
  const pending = copilot.pendingMessage
  const showPending = pending && !session?.messages.slice(pending.after).some(message => message.role === 'user' && message.text === pending.text)
  useEffect(() => { bottom.current?.scrollIntoView({block:'nearest'}) }, [session?.messages.length,voice.transcript.length,copilot.pendingMessage,copilot.busy])
  async function startVoice() {
    if (!session) return
    setVoiceBusy(true)
    try { const definition = await api<Agent>('/api/copilot/definition'); await voice.start(definition,{copilot_session_id:session.id}) }
    catch (reason) { toast.error(reason instanceof Error ? reason.message : 'Could not start Copilot voice.') }
    finally { setVoiceBusy(false) }
  }
  async function submit() {
    if (!text.trim() || !session) return
    const message=text; setText('')
    if (voiceMode) { try { await voice.sendText(message) } catch { setText(message) } }
    else if (!await copilot.action('messages',{text:message},'Copilot is thinking…')) setText(message)
  }
  async function build() {
    const brief=text; setText('')
    if (!await copilot.action('generate',{text:brief},'Building agent and scenarios…')) setText(brief)
  }
  return <aside className="flex w-[400px] shrink-0 flex-col border-l border-slate-200 bg-white" aria-label="Copilot">
    <div className="flex h-12 shrink-0 items-center gap-2 border-b border-slate-100 px-4"><Sparkles className="size-4 text-indigo-600"/><h2 className="text-base font-medium">Agent Copilot</h2><Button className="ml-auto" variant="ghost" disabled={copilot.locked || voiceMode} onClick={() => copilot.setOpen(false)} aria-label="Close Copilot"><X/></Button></div>
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="space-y-3 p-4"><p className="text-xs leading-5 text-slate-500">Describe the agent you need, or bring a call that went wrong. Every change comes back for your review.</p>
        <div className="flex flex-wrap gap-2"><Button disabled={copilot.locked || voiceMode} variant="outline" onClick={() => setText(DEMO_BRIEF)}><MessageSquare/>Example brief</Button><Button disabled={copilot.locked || voiceMode || agent.nodes.length === 0} variant="outline" onClick={() => void copilot.action('simulate',{},'Simulating calls…')}><Play/>Simulate calls</Button><Button disabled={copilot.locked || voiceMode || agent.nodes.length === 0} variant="outline" onClick={() => setReviewOpen(!reviewOpen)}>Review a call</Button></div>
      </div>
      {reviewOpen && <ImportCall key={agent.id} agent={agent} copilot={copilot} onClose={() => setReviewOpen(false)} onReviewed={onReviewed}/>}
      {!session?.messages.length && !session?.proposal && !copilot.busy && <div className="mx-4 mb-4 rounded-lg bg-slate-50 p-4 text-xs leading-6 text-slate-500"><p className="mb-2 font-medium text-slate-700">One loop, from brief to better calls</p><p>1. Describe the guidelines.</p><p>2. Review and apply the graph.</p><p>3. Watch five callers test it.</p><p>4. Reproduce an issue, review a fix, rerun.</p></div>}
      <div className="space-y-3 px-4 pb-4" aria-label="Copilot conversation" aria-live="polite">{session?.messages.map((message,index) => <div key={index} className={cn('rounded-lg p-3 text-sm leading-6', message.role === 'user' ? 'ml-6 bg-indigo-50' : 'mr-4 bg-slate-50')}><p className="mb-1 text-xs font-medium text-slate-400">{message.role === 'user' ? 'You' : 'Copilot'}</p><p className="whitespace-pre-wrap">{message.text}</p></div>)}{showPending && <div className="ml-6 rounded-lg bg-indigo-50 p-3 text-sm leading-6"><p className="mb-1 text-xs font-medium text-slate-400">You</p><p className="whitespace-pre-wrap">{pending.text}</p></div>}{voiceMode && <div aria-label="Copilot voice transcript" className="space-y-3">{voice.groupedTranscript.map((line,index) => <div key={`voice-${index}`} className="rounded-lg bg-slate-50 p-3 text-sm leading-6"><p className="text-xs font-medium text-slate-400">{line.speaker === 'Agent' ? 'Copilot · voice' : 'You · voice'}</p>{line.text}</div>)}</div>}<div ref={bottom}/></div>
      {session?.proposal && <ProposalReview proposal={session.proposal} copilot={copilot}/>}
      {(copilot.error || (voice.isCopilot && voice.error)) && <div role="alert" className="m-4 flex items-start gap-2 rounded-md bg-red-50 p-3 text-xs leading-5 text-red-700"><AlertCircle className="mt-1 size-4 shrink-0"/>{copilot.error || voice.error}</div>}
      <CallReviews copilot={copilot}/>
      <div className="flex flex-wrap gap-2 border-t border-slate-100 p-4"><Button disabled={copilot.locked || voiceMode} className="text-xs" variant="ghost" onClick={() => void copilot.action('restore-previous',{},'Restoring…')}><RotateCcw/>Restore previous version</Button><Button disabled={!!copilot.busy || voiceMode} className="text-xs" variant="ghost" onClick={async () => { try { await api('/api/copilot/restore-default',{method:'POST'}); toast.success('Copilot restored'); } catch (reason) { toast.error(reason instanceof Error ? reason.message : 'Restore failed.') } }}><RotateCcw/>Restore Copilot</Button></div>
    </div>
    <div className="space-y-3 border-t border-slate-200 p-4">{copilot.busy && <div role="status" aria-label="Copilot working" className="flex items-start gap-3 rounded-lg border border-indigo-100 bg-indigo-50 p-3"><Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-indigo-600"/><div><p className="text-sm font-medium text-indigo-700">{preparing ? 'Building your agent…' : copilot.busy}</p>{preparing && <p className="mt-1 text-xs leading-5 text-indigo-600">Preparing your graph and caller scenarios. Your proposal will appear here for review.</p>}</div></div>}<div className="flex items-center gap-2 text-xs text-slate-400"><span className="flex-1">{voiceMode ? 'Listening · Agent Copilot' : 'Text works without microphone or ElevenLabs'}</span>{voiceMode ? <Button variant="outline" onClick={() => void voice.stop()}><PhoneOff/>Stop voice</Button> : <Button variant="outline" disabled={!!copilot.busy || voiceBusy || !!session?.proposal} onClick={() => void startVoice()}>{voiceBusy ? <Loader2 className="animate-spin"/> : <Mic/>}Talk</Button>}</div>
      <Textarea aria-label="Message Copilot" placeholder={agent.nodes.length ? 'Ask for a change or describe a problem…' : 'Paste the client’s guidelines…'} value={text} disabled={!!copilot.busy || !!session?.proposal} className="min-h-24" onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void submit() } }}/>
      <div className="flex items-center justify-between"><span className="text-xs text-slate-400">{session?.runs || 0} / {session?.max_runs || 10} simulation runs</span><div className="flex gap-2">{!agent.nodes.length && <Button variant="outline" disabled={!text.trim() || copilot.locked || voiceMode} onClick={() => void build()}>{preparing ? <Loader2 className="animate-spin"/> : <ArrowRight/>}{preparing ? 'Building…' : 'Build agent'}</Button>}<Button disabled={!text.trim() || !!copilot.busy || !!session?.proposal} onClick={() => void submit()}>{copilot.busy ? <Loader2 className="animate-spin"/> : <Send/>}{copilot.busy ? 'Working…' : 'Send'}</Button></div></div>
    </div>
  </aside>
}
export function SimulationResults({ copilot }: { copilot: Copilot }) {
  const session=copilot.session
  const results=session?.current?.results || []
  const chosen=results.find(r => r.scenario.id === copilot.selectedScenario)
  const live=copilot.markers.find(m => m.id === copilot.selectedScenario)
  const turns=chosen?.transcript || live?.turns || []
  return <div className="space-y-4 p-4">
    <div className="flex items-center gap-4"><div><p className="text-xs text-slate-400">Before</p><p className="text-xl font-medium text-slate-500">{session?.before ? `${session.before.passed}/5` : '—'}</p></div><ArrowRight className="size-4 text-slate-300"/><div><p className="text-xs text-slate-400">{session?.running ? 'Running' : 'Current'}</p><p className="text-xl font-medium text-indigo-600">{session?.current ? `${session.current.passed}/5` : '—'}</p></div><div className="ml-2 text-xs leading-5 text-slate-500">{session?.current ? <><p>{session.current.failed} behavioral failure(s) · {session.current.errors} service error(s)</p><p>Model-assessed results, not a production guarantee.</p></> : <p>Watch the callers explore the graph, then inspect their evidence.</p>}</div></div>
    {session?.regressions.map(scenario => { const baseline = session.regression_baselines?.[scenario.id.replace('regression-','')]?.result; const after = results.find(result => result.scenario.id === scenario.id); return <button key={scenario.id} className="flex w-full items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-left text-xs" onClick={() => copilot.setSelectedScenario(scenario.id)}><div className="min-w-0 flex-1"><p className="font-medium">Retained regression</p><p className="mt-1 text-slate-500">{scenario.expected.join(' · ')}</p></div><span className={baseline?.status === 'failed' ? 'text-red-600' : 'text-slate-500'}>{baseline?.status || '—'}</span><ArrowRight className="size-4 text-slate-300"/><span className={after?.status === 'passed' ? 'text-green-600' : 'text-slate-500'}>{after?.status || 'Awaiting rerun'}</span></button> })}
    <div className="flex flex-wrap gap-2">{(copilot.markers.length ? copilot.markers : results.map(r => ({id:r.scenario.id,label:r.scenario.persona,status:r.status}))).map((marker,index) => <button key={marker.id} onClick={() => copilot.setSelectedScenario(marker.id)} className={cn('flex items-center gap-2 rounded-md border px-3 py-2 text-xs', copilot.selectedScenario === marker.id ? 'border-indigo-300 bg-indigo-50' : 'border-slate-200')}><span className={cn('flex size-5 items-center justify-center rounded-full text-xs', marker.status === 'passed' ? 'bg-green-100 text-green-700' : marker.status === 'failed' ? 'bg-red-100 text-red-700' : marker.status === 'error' ? 'bg-amber-100 text-amber-700' : 'bg-indigo-100 text-indigo-700')}>{index+1}</span><span className="capitalize">{marker.label}</span><span className="text-slate-400">{marker.status}</span></button>)}</div>
    {chosen?.error && <p className="text-xs text-amber-700">Service error: {chosen.error}</p>}{chosen?.verdict && <div className="space-y-1 text-xs text-slate-500"><p>{chosen.verdict.summary}</p>{chosen.verdict.models && <p className="text-slate-400">Judge: {chosen.verdict.models.join(' → ')}{chosen.verdict.reviewed ? ' · independently reviewed' : ''}</p>}</div>}
    {!!turns.length && <div className="max-h-40 space-y-2 overflow-y-auto rounded-md bg-slate-50 p-3">{turns.map((turn,index) => <p key={index} className="flex gap-3 text-xs leading-5"><span className="w-20 shrink-0 text-slate-400">{index+1} · {turn.role === 'user' ? 'Caller' : 'Agent'}</span><span className="flex-1">{turn.text}</span><span className="text-slate-400">{turn.node}</span></p>)}</div>}
  </div>
}
