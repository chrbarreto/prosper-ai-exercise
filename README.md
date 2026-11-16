# What I have built

A local app to create, test, and improve voice agents. Each agent is a graph: nodes are conversation steps, and connections define how the conversation can move between them.

## Main features

- Create, edit, and delete agents. Each agent is saved in one JSON file.
- Edit the graph visually, or describe what you need to the Copilot by text or voice. It proposes the agent's role, call direction, conversation steps, and test scenarios.
- Make a browser test call with a live transcript, mute, and end-call controls.
- Simulate five types of caller. Watch their paths through the graph and inspect their conversations and results.
- Analyze a test call or paste a past transcript to find problems. Review a proposed fix, click **Apply**, and rerun the tests to compare results. You can also restore the previous saved version.

## General architecture

The interface uses React, TypeScript, and React Flow. A Python backend with FastAPI saves and validates agent files. `AgentBuilder` converts each JSON definition into a conversation flow run by Pipecat.

Voice calls use this path:

```text
Browser microphone → ElevenLabs speech recognition → OpenAI model
                   → ElevenLabs voice generation → Browser speaker
```

The Copilot is also an agent defined in JSON. It uses backend tools to read agents, propose changes, and run simulations. Only the user can approve a change. Simulations use the same conversation engine, with text instead of audio.

## Choices and trade-offs

JSON files keep agents easy to inspect and change, without setting up a database. This suits a local demo with one user. Saving is explicit, with automatic saving before switching agents or starting a call.

Text simulations avoid the cost of speech recognition and voice generation, but they do not test audio quality or how well speech is understood. Five caller types provide useful feedback while keeping the test set small. The Copilot attempts to reproduce a problem before proposing a fix; if it cannot, the UI says that the fix is unverified.

## Known limitations

- AI responses and test judgments can be wrong. Passing the simulations does not guarantee correct behavior in real calls.
- Conversation rules guide the model. They do not enforce every business rule in code.
- There is no login, shared editing, real telephone calling, or automatic import of production calls.
- Bookings, account changes, and human transfers are demonstrations, without real business integrations.
- AI features need API keys and internet access. Browser voice calls also need microphone permission.

## Run locally

Requires Python 3.11+, [uv](https://docs.astral.sh/uv/getting-started/installation/), and Node.js 22.12+ (or 20.19+).

```bash
make install
cp backend/.env.example backend/.env
```

Fill in `OPENAI_API_KEY` and `ELEVENLABS_API_KEY` in **`backend/.env`**. A root `.env` is not used. Never put provider keys in frontend environment variables. Editing agents works without keys; calls report missing credentials.

Start the two processes in separate terminals:

```bash
make api   # API + voice runtime: http://127.0.0.1:8000
```

```bash
make ui    # Editor: http://127.0.0.1:5173
```

Open **http://127.0.0.1:5173**. Two sample agents are included: Prosper Scheduler, the original format example, and Cedar Bike Workshop, an original agent with separate repair-advice and opening-hours branches. These are demos; there is no calendar or repair-booking integration.

The frontend proxies `/api`, `/start`, `/sessions`, and `/status` to the backend. The diagnostic Pipecat client remains at `http://127.0.0.1:8000/client`; without an agent ID it uses `backend/example_flow.json`. Calls need microphone permission and internet access. The SmallWebRTC SDK uses Daily's media manager internally and loads its public media bundle from `c.daily.co`; audio uses WebRTC with the local Pipecat server.

## Edit and test an agent

1. Create a blank agent or start from the clinic scheduler. Select a profile in the sidebar to edit it.
2. Add conversation steps. Select a card to edit its instructions in the inspector. Choose a start and mark ending steps.
3. Add transitions through the inspector or by connecting the handles on two cards. Set the function name, when to take it, destination, and any collected fields.
4. Use **Save** explicitly, or let the app save before switching agents or calling. A failed save keeps the draft open for manual retry.
5. Open **Issues** to review errors and warnings. Clicking an issue selects its item. Errors block calls; warnings allow them.
6. Click **Test call**, allow microphone access, and speak. The drawer shows call state, mute/end controls, and a minimal Caller/Agent transcript.

Edges are LLM tools, not deterministic conditions: their descriptions tell the model when to move to the next node, and their parameter schemas describe the information to collect first. Tool badges on nodes and the transition inspector show the available functions. An end node preserves its post-actions and finishes with exactly one `end_conversation` action.

## Storage and call selection

Agents live in `backend/agents/<uuid>.json`. Runtime fields (`name`, `persona`, `model`, `voice_id`, `initial_node`, `nodes`) retain the starter format. Stable node/transition IDs and `editor.positions` store editor identity and layout in the same file. Existing native fields are retained when saved; only the first instruction message is exposed in the basic editor.

The library is derived from those files. Creating and deleting profiles adds and removes the corresponding files; deleting the last sample does not recreate it. `AGENTS_DIR` can point to a separate directory, as the browser test does.

A call sends `{ "transport": "webrtc", "body": { "agent_id": "<uuid>" } }` to `/start`. Pipecat forwards the body to `runner_args.body`; `bot()` loads and validates that saved agent before creating the voice pipeline. Unknown IDs and invalid graphs cannot fall back to another agent. The file is loaded once per call, so later edits apply to the next call.

Structurally valid incomplete drafts can be saved. The backend returns issues shaped as `{severity, code, message, node, edge, field}`. Validation checks starts, names, targets, tool definitions, parameter schemas, and terminal-node behavior, and warns about unreachable nodes and unfinished conversation paths. Built-in `tts_say` and `end_conversation` actions are supported; custom executable actions need registered backend handlers.

## Checks

```bash
make test-api
make build
npx --prefix frontend playwright install chromium  # once
make test-ui
```

`make test` runs the backend tests and the one browser happy path. The browser check starts isolated servers on ports 8001/5174 with temporary agent storage. It checks editing, validation, automatic saving on agent switch, persistence, correct call selection, mute controls, and transcript events. Consecutive caller speech segments share one transcript entry until the agent speaks; raw segments remain available for call review and evidence. Voice SDK/provider traffic is stubbed in that test; real microphone and provider checks remain a separate manual verification. No provider keys are needed for the automated checks.

## Layout

| Path | Responsibility |
| --- | --- |
| `frontend/src/App.tsx` | Agent library, editor orchestration, saving, Issues and call drawers. |
| `frontend/src/Graph.tsx` | React Flow canvas, node cards, and connections. |
| `frontend/src/Inspector.tsx` | Agent/node settings, transitions, and basic collected fields. |
| `frontend/src/useVoice.ts` | Pipecat SDK lifecycle, audio playback, mute, and transcript. |
| `frontend/src/components/ui/` | Local shadcn-style primitives using Radix, with Tailwind styling. |
| `backend/agents_api.py` | JSON-file CRUD, validation endpoints, and start-request preflight. |
| `backend/agent_builder/` | Declarative schema, structured validation, and Pipecat Flows compilation. |
| `backend/bot.py` | Existing WebRTC/STT/LLM/TTS pipeline, using the selected saved agent. |
| `backend/agents/` | One JSON document per agent, including the two samples. |

## Tools

React, TypeScript, Vite, React Flow, Tailwind CSS, shadcn/ui patterns with Radix primitives, lucide-react, sonner, Pipecat client JS and SmallWebRTC, FastAPI, Pydantic, jsonschema, Pipecat Flows, ElevenLabs, and OpenAI. Dependencies are locked by `frontend/package-lock.json` and `backend/uv.lock`. Tests use pytest and Playwright.

## Agent Copilot

Open an agent and click **Copilot**, or choose **Create with Copilot** from the library. Paste a brief or press **Talk** to speak it. Text mode works without microphone permission or ElevenLabs; voice mode uses the existing voice pipeline.

The Copilot is defined in `backend/copilot.json`, using the same agent schema and `AgentBuilder` as the agents it edits. Nodes can now reference executable tools separately from transition edges. Trusted backend handlers supply `get_agent`, `create_agent_from_spec`, `apply_patch`, `run_simulations`, and `list_issues`. Tools operate on the selected target; approval is deliberately not a model tool.

1. **Brief → agent.** Extract the agent’s business role, the human participant’s role, inbound/outbound call direction, intents, fields, policies, escalation rules, tone, and assumptions, then generate a graph and five scenario definitions. Review shows who initiates the call; an unspecified direction defaults to an explicitly stated inbound assumption. Generated personas identify both participants and the initiator. Node prompts are agent instructions with explicit Say/Ask/Wait wording, rather than dialogue to continue; a shared generated instruction envelope reinforces this even for standalone speech examples. Every scenario checks role consistency and reliance on actual human replies. These instructions guide model behavior; they are not a deterministic consent gate. Inspect the proposed specification and field-level diff; click Apply to save. Generation validates through `AgentBuilder` and can repair malformed output before showing it.
2. **Five callers.** Happy path, confused, rushed, off-topic, and policy-breaker callers run concurrently through real audio-free Pipecat pipelines. Each has its own FlowManager, context, and collected state. SSE events move numbered persona dots along actual node transitions. Click a dot or result card to inspect its transcript.
3. **Issues.** The judge evaluates the frozen expected checks derived from the specification against the transcript and node trace. An adversarial caller’s goal is not the expected agent behavior. Findings cite real transcript turns. After ending a test call, click **Analyze this call** in the Test call drawer. For an external call, choose **Review a call**, paste speaker-labelled dialogue, and confirm it belongs to the named agent. Both paths derive applicable checks from that agent’s saved specification and instructions. Reviews retain the transcript, expected behavior, assessment, and source even when no issue is found. Browser/imported transcripts do not contain authoritative node traces, so findings cite turns without inventing node attribution. **View call** opens the supporting transcript from an issue.
4. **Issue → regression → patch.** Click Fix on an issue. The Copilot replays a generated regression against the saved agent before staging a minimal JSON Patch. The review says whether the failure was reproduced. If not, the proposal is an improvement, not a verified repair.
5. **Apply → rerun.** Click Apply, then Simulate calls. Compare the same five scenarios and retained regressions before/after. A new-policy regression can improve while the original five remain unchanged; both are shown. Service errors are separate from behavioral failures, not counted as passes.

Proposal generation shows an immediate working state in the composer and a centered spinner over the canvas for the full request, including agents with existing nodes and generation triggered over voice. Proposal previews reserve space for transition labels and allow node dragging, with **Fit graph** and **Readable view** controls. Apply saves the proposed conversation together with the preview layout, including any nodes moved during review. Reject leaves the saved layout unchanged. Manual conversation edits and target switching are paused while a proposal is pending or simulations are running. **Restore previous version** restores the document before the last changed save; identical saves do not replace that backup. **Restore Copilot** reloads the protected default. Copilot self-edits are limited to its persona and conversation instructions, with normal proposal approval; tool permissions and approval enforcement are backend-controlled.

Agent specification and scenarios stay in the agent JSON under `copilot`. Reviewed calls, run artifacts and retained regressions live under `backend/agents/.copilot/`; one previous saved document is kept under `.previous/`. These local artifacts are ignored by Git. Simulation results are cached in memory using a single hash of agent runtime content and scenario inputs; infrastructure-error runs are not cached. Ordinary requests handle commands; one SSE stream per active session carries simulation updates. There is no job framework or deployment system. The synthetic clinic transcripts in `backend/fixtures/production_calls.json` are offline clinic-demo fixtures only; the application never loads them into arbitrary agents. Legacy mock-complaint findings are excluded when loading saved sessions.

### Configuration

Set these optional values in `backend/.env` and restart the backend:

| Variable | Default | Purpose |
| --- | --- | --- |
| `COPILOT_MODEL` | `gpt-4o` | Build graphs and propose edits. |
| `CALLER_MODEL` | `gpt-4o-mini` | Play the five callers and generate regressions. |
| `JUDGE_MODEL` | `gpt-4o-mini` | First-pass evaluation with a fixed rubric. |
| `JUDGE_REVIEW_MODEL` | Copilot model (`gpt-4o`) | Independently review flagged or malformed judgments; empty disables review. |
| `SIM_MAX_TURNS` | `8` | Maximum caller turns per conversation. |
| `SIM_CONCURRENCY` | `5` | Concurrent simulation conversations. |
| `SIM_MAX_RUNS` | `10` | Suite/reproduction requests per session. |

The agent under test uses its own configured model. Simulation speech is text-only: no STT/TTS charges, but both callers and target agents make LLM requests, plus generation and judging. A run can involve many short requests; model selection matters. The live rehearsal exposed mini misgrading negated requirements. Flagged or malformed judgments therefore receive an independent review by the configured review model against the same frozen checks. This adds a model call for those outcomes; each result records which models judged it. Judge results are assessments, not ground truth, and a five-persona suite does not establish production readiness. Configurable concurrency demonstrates extensibility, not proven scale.


## Future work

Deliberately deferred:

- Proposal conflict hashes, revision history, multi-user editing, and per-agent write serialization.
- Background autosave, retry/backoff, and tab-close warnings; save-before-switch/call is included.
- Job IDs, queues, distributed execution, selective replay, and large-scale simulation infrastructure.
- Sophisticated deterministic behavioral checks and attribution-confidence classification; the judge cites logged evidence and traces.
- A new automated Copilot browser journey; focused backend tests and a rehearsed live demo cover this phase.
- Import/export, duplicate, undo/redo, MiniMap, and global keyboard shortcuts.
- Full JSON Schema editing and visual editing of additional native actions/messages.
- Authentication, hosting/deployment, automated production-call ingestion (manual transcript import is included), telephony, calendar integrations, and mobile layouts.
