import type { Agent } from './types'
export type Finding = { id: string; category: string; node: string | null; evidence_turn?: number; severity: string; explanation: string; evidence: string; source: string; status: string; call_name?: string; call_id?: string }
export type Scenario = { id: string; persona: string; opening: string; goal: string; facts: string; expected: string[] }
export type Turn = { role: string; text: string; node?: string }
export type CallReview = { id: string; agent_id: string; agent_name: string; source: string; name: string; transcript: Turn[]; scenario: Scenario; verdict: NonNullable<SimulationResult['verdict']> }
export type SimulationResult = { scenario: Scenario; status: 'passed' | 'failed' | 'error'; stop_reason?: string; error?: string; transcript: Turn[]; trace: string[]; verdict?: { passed: boolean; summary: string; findings: Finding[]; models?: string[]; reviewed?: boolean } }
export type Suite = { results: SimulationResult[]; passed: number; failed: number; errors: number }
export type Proposal = { summary: string; original: Agent; candidate: Agent; patch: { op: string; path: string; value?: unknown }[]; changes: { id: string; name: string; change: string }[]; kind: string; target?: string; test_changes: boolean; reproduction?: { status: string; result: SimulationResult } | null }
export type CopilotSession = { id: string; agent_id: string; proposal: Proposal | null; issues: Finding[]; reviews: CallReview[]; current: Suite | null; before: Suite | null; regressions: Scenario[]; regression_baselines: Record<string, {status: string; result: SimulationResult}>; messages: { role: string; text: string }[]; running: boolean; runs: number; max_runs: number; activity?: string | null }
export type Marker = { id: string; label: string; node: string; previous?: string; status: string; tick: number; turns: Turn[] }
