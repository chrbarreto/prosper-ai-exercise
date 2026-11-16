import { useEffect, useMemo, useRef, useState } from 'react'
import type { PipecatClient } from '@pipecat-ai/client-js'
import { createCallClient } from './callClient'
import { api, type Agent } from './types'

export type TranscriptLine = { speaker: 'Caller' | 'Agent'; text: string }
export function useVoice() {
  const client = useRef<PipecatClient | null>(null)
  const audio = useRef<HTMLAudioElement | null>(null)
  const generation = useRef(0)
  const [status, setStatus] = useState<'idle' | 'connecting' | 'connected' | 'ended' | 'error'>('idle')
  const [error, setError] = useState('')
  const [muted, setMuted] = useState(false)
  const [transcript, setTranscript] = useState<TranscriptLine[]>([])
  const [callingAgent, setCallingAgent] = useState('')
  const [callingAgentId, setCallingAgentId] = useState('')
  const [isCopilot, setIsCopilot] = useState(false)
  const seenUserEvents = useRef(new Set<string>())
  const botSegments = useRef(new Map<number, number>())
  const active = status === 'connecting' || status === 'connected'
  const groupedTranscript = useMemo(() => transcript.reduce<TranscriptLine[]>((groups,line) => {
    const previous = groups.at(-1)
    if (line.speaker === 'Caller' && previous?.speaker === 'Caller')
      groups[groups.length-1] = {...previous,text:`${previous.text.trimEnd()} ${line.text.trim()}`}
    else groups.push(line)
    return groups
  },[]),[transcript])

  async function stop() {
    generation.current++
    const current = client.current
    client.current = null
    try { await current?.disconnect() } catch { /* Already disconnected by transport. */ }
    if (audio.current) { audio.current.pause(); audio.current.srcObject = null; audio.current = null }
    setStatus(previous => previous === 'error' ? 'error' : 'ended')
    setMuted(false)
  }
  async function reset() {
    await stop()
    setStatus('idle'); setError(''); setTranscript([]); setCallingAgent(''); setCallingAgentId(''); setIsCopilot(false)
  }
  useEffect(() => () => {
    generation.current++
    void client.current?.disconnect()
    if (audio.current) { audio.current.pause(); audio.current.srcObject = null }
  }, [])

  async function start(agent: Agent, extra: Record<string, string> = {}) {
    await stop()
    const attempt = ++generation.current
    setStatus('connecting'); setError(''); setMuted(false); setTranscript([]); setCallingAgent(agent.name)
    setCallingAgentId(agent.id); setIsCopilot(!!extra.copilot_session_id)
    seenUserEvents.current.clear(); botSegments.current.clear()
    try {
      const configuration = await api<{ voice_configured: boolean }>('/api/health')
      if (!configuration.voice_configured) throw new Error('Configure OPENAI_API_KEY and ELEVENLABS_API_KEY in backend/.env before calling.')
      if (attempt !== generation.current) return
      const current = createCallClient({
        onBotReady: () => { if (attempt === generation.current) setStatus('connected') },
        onDisconnected: () => { if (attempt === generation.current) { setStatus(s => s === 'error' ? 'error' : 'ended'); setMuted(false) } },
        onUserTranscript: data => {
          if (attempt !== generation.current || !data.final || !data.text.trim()) return
          const key = `${data.timestamp}:${data.text}`
          if (seenUserEvents.current.has(key)) return
          seenUserEvents.current.add(key)
          setTranscript(lines => [...lines, { speaker: 'Caller', text: data.text }])
        },
        onUserInput: data => {
          if (attempt === generation.current && data.input_type === 'chat' && data.final)
            setTranscript(lines => [...lines, { speaker: 'Caller', text: data.text }])
        },
        onBotOutput: data => {
          if (attempt !== generation.current || !data.text.trim()) return
          setTranscript(lines => {
            const index = data.segment_id === undefined ? undefined : botSegments.current.get(data.segment_id)
            if (index !== undefined) return lines.map((line, i) => i === index ? { speaker: 'Agent', text: data.text } : line)
            if (data.segment_id !== undefined) botSegments.current.set(data.segment_id, lines.length)
            return [...lines, { speaker: 'Agent', text: data.text }]
          })
        },
        onTrackStarted: (track, participant) => {
          if (attempt !== generation.current || participant?.local || track.kind !== 'audio') return
          audio.current ||= new Audio()
          audio.current.autoplay = true
          audio.current.srcObject = new MediaStream([track])
          void audio.current.play().catch(() => { if (attempt === generation.current) setError('Audio playback was blocked. End the call and try again.') })
        },
        onError: message => {
          if (attempt !== generation.current) return
          const data = message.data as { error?: string; message?: string; fatal?: boolean }
          setError(data?.error || data?.message || 'The voice service encountered an error.')
          if (data?.fatal) { setStatus('error'); void current.disconnect() }
        },
        onDeviceError: deviceError => { if (attempt === generation.current) { setError(deviceError.message || 'Allow microphone access to test this agent.'); setStatus('error') } },
      })
      client.current = current
      await current.startBotAndConnect({ endpoint: `${window.location.origin}/start`, requestData: { transport: 'webrtc', body: { agent_id: agent.id, ...extra } } })
      if (attempt === generation.current) setStatus('connected')
    } catch (reason) {
      if (attempt !== generation.current) return
      setError(reason instanceof Error ? reason.message : 'Could not connect the call.')
      setStatus('error')
      await client.current?.disconnect().catch(() => {})
    }
  }
  function toggleMute() { client.current?.enableMic(muted); setMuted(!muted) }
  async function sendText(text: string) { await client.current?.sendText(text, { run_immediately: true }) }
  return { start, stop, reset, sendText, status, active, error, muted, toggleMute, transcript, groupedTranscript, callingAgent, callingAgentId, isCopilot }
}
export type Voice = ReturnType<typeof useVoice>
