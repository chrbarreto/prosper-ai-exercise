import { useEffect, useRef, useState } from 'react'
import { AlertCircle, FileText, X } from 'lucide-react'
import type { Agent } from './types'
import type { Copilot } from './useCopilot'
import type { Turn } from './copilotTypes'
import { Button, Input, Label, Textarea } from './components/ui/primitives'

export function sourceLabel(source: string) {
  return ({ 'test call': 'Test call', 'imported transcript': 'Imported transcript', simulation: 'Simulation', 'client feedback': 'User feedback' } as Record<string,string>)[source] || source
}

function parseTranscript(text: string): Turn[] {
  const turns: Turn[] = []
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    const match = line.match(/^\s*(caller|user|customer|agent|assistant|bot)\s*:\s*(.*)$/i)
    if (match) turns.push({ role: /^(caller|user|customer)$/i.test(match[1]) ? 'user' : 'assistant', text: match[2].trim() })
    else if (turns.length) turns[turns.length-1].text += `\n${line.trim()}`
    else throw new Error('Start each turn with Caller: or Agent:.')
  }
  if (turns.some(turn => !turn.text) || !turns.some(turn => turn.role === 'user') || !turns.some(turn => turn.role === 'assistant'))
    throw new Error('Include at least one nonempty Caller: turn and one nonempty Agent: turn.')
  return turns
}

export function ImportCall({ agent, copilot, onClose, onReviewed }: { agent: Agent; copilot: Copilot; onClose: () => void; onReviewed: () => void }) {
  const [name,setName] = useState('Past call')
  const [text,setText] = useState('')
  const [confirmed,setConfirmed] = useState(false)
  const [error,setError] = useState('')
  return <form aria-label="Review a past call" className="mx-4 mb-4 space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3" onSubmit={async event => {
    event.preventDefault(); setError('')
    try {
      const transcript = parseTranscript(text)
      if (await copilot.action('review-call',{ agent_id:agent.id, source:'imported transcript', name, confirmed_agent:confirmed, transcript },'Reviewing call against saved guidelines…')) {
        onReviewed(); onClose()
      }
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not read the transcript.') }
  }}>
    <div className="flex items-center justify-between"><p className="text-sm font-medium">Review a past call</p><Button type="button" variant="ghost" aria-label="Close call review" disabled={!!copilot.busy} onClick={onClose}><X/></Button></div>
    <p className="text-xs leading-5 text-slate-500">Reviewing against the saved guidelines for <span className="font-medium text-slate-700">{agent.name}</span>. To review your latest test call, use Analyze this call in the Test call drawer.</p>
    <div className="space-y-1"><Label htmlFor="review-call-name">Call name</Label><Input id="review-call-name" value={name} maxLength={120} required disabled={!!copilot.busy} onChange={event => setName(event.target.value)}/></div>
    <div className="space-y-1"><Label htmlFor="review-call-transcript">Call transcript</Label><Textarea id="review-call-transcript" placeholder={'Caller: I need to cancel my booking.\nAgent: How can I help with that?'} value={text} maxLength={50000} required disabled={!!copilot.busy} onChange={event => setText(event.target.value)} className="min-h-40"/></div>
    <label className="flex items-start gap-2 text-xs leading-5 text-slate-600"><input type="checkbox" checked={confirmed} disabled={!!copilot.busy} onChange={event => setConfirmed(event.target.checked)} className="mt-1 accent-indigo-600"/>This transcript belongs to {agent.name}.</label>
    {error && <p role="alert" className="flex items-start gap-2 text-xs leading-5 text-red-600"><AlertCircle className="mt-0.5 size-3 shrink-0"/>{error}</p>}
    <Button type="submit" disabled={!confirmed || !text.trim() || !name.trim() || copilot.locked}><FileText/>Analyze transcript</Button>
  </form>
}

export function CallReviews({ copilot }: { copilot: Copilot }) {
  const container = useRef<HTMLDivElement>(null)
  useEffect(() => { if (copilot.selectedReview) container.current?.scrollIntoView({block:'nearest'}) }, [copilot.selectedReview])
  const reviews = copilot.session?.reviews || []
  if (!reviews.length) return null
  return <div ref={container} className="space-y-3 border-t border-slate-100 p-4" aria-label="Reviewed calls">
    <p className="text-xs font-medium text-slate-500">Reviewed calls</p>
    {[...reviews].reverse().map(review => <details key={review.id} open={copilot.selectedReview === review.id} className="rounded-lg border border-slate-200 p-3">
      <summary className="cursor-pointer text-xs leading-5" onClick={event => { event.preventDefault(); copilot.setSelectedReview(copilot.selectedReview === review.id ? null : review.id) }}><span className="font-medium">{review.name}</span><span className="mt-1 block text-slate-400">{sourceLabel(review.source)} · {review.agent_name} · {review.verdict.findings.length} finding(s)</span></summary>
      <div className="mt-3 space-y-3 text-xs leading-5"><p>{review.verdict.summary}</p><div className="text-slate-500"><p className="font-medium">Expected behavior</p>{review.scenario.expected.map((check,index) => <p key={index}>• {check}</p>)}</div>
        {review.transcript.map((turn,index) => <p key={index} className={review.verdict.findings.some(finding => finding.evidence_turn === index+1) ? 'rounded bg-amber-50 p-2' : ''}><span className="font-medium text-slate-500">{index+1}. {turn.role === 'assistant' ? 'Agent' : 'Caller'}:</span> {turn.text}</p>)}
        <p className="text-slate-400">Model-assessed against saved guidelines. {review.verdict.models?.join(' → ')}</p>
      </div>
    </details>)}
  </div>
}
