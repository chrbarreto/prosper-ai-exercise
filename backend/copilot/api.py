import asyncio
import json
from contextlib import asynccontextmanager
from typing import Literal

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict, Field, FiniteFloat, model_validator

import agents_api as storage
from agent_builder.validation import validate_agent
from .service import (Session, SESSIONS, get_session, COPILOT_PATH, DEFAULT_PATH, save_artifacts)
from .llm import json_completion
from .config import COPILOT_MODEL

@asynccontextmanager
async def lifespan(app):
    yield
    await asyncio.gather(*(s.runtime.close() for s in SESSIONS.values() if s.runtime), return_exceptions=True)

router = APIRouter(prefix='/api/copilot', lifespan=lifespan)

class NewSession(BaseModel):
    agent_id: str

class Message(BaseModel):
    text: str = Field(min_length=1,max_length=20000)

class Repair(BaseModel):
    issue_id: str

class CanvasPosition(BaseModel):
    model_config = ConfigDict(extra='forbid')
    x: FiniteFloat
    y: FiniteFloat

class Approval(BaseModel):
    model_config = ConfigDict(extra='forbid')
    positions: dict[str,CanvasPosition] | None = None

class CallTurn(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)
    role: Literal['user','assistant']
    text: str = Field(min_length=1,max_length=10000)

class CallReview(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)
    agent_id: str
    source: Literal['test call','imported transcript']
    name: str = Field(min_length=1,max_length=120)
    confirmed_agent: bool = False
    transcript: list[CallTurn] = Field(min_length=2,max_length=200)

    @model_validator(mode='after')
    def validate_call(self):
        if {turn.role for turn in self.transcript} != {'user','assistant'}:
            raise ValueError('Include both caller and agent turns.')
        if sum(len(turn.text) for turn in self.transcript) > 50000:
            raise ValueError('The transcript is too long. Keep it under 50,000 characters.')
        if self.source == 'imported transcript' and not self.confirmed_agent:
            raise ValueError('Confirm this transcript belongs to the selected agent.')
        return self

async def checked(operation):
    try:
        return await operation
    except HTTPException:
        raise
    except (ValueError,KeyError,TypeError) as exc:
        raise HTTPException(422,str(exc))
    except Exception as exc:
        # Do not return raw provider responses (which may contain credential fragments).
        raise HTTPException(502,f'{type(exc).__name__}: Copilot request failed. Check provider configuration and retry.')

@router.post('/sessions')
def create_session(request: NewSession):
    storage.load_agent(request.agent_id)
    for session in SESSIONS.values():
        if session.agent_id == request.agent_id:
            return session.view()
    session = Session(request.agent_id)
    SESSIONS[session.id] = session
    return session.view()

@router.get('/sessions/{sid}')
def session_state(sid: str):
    return get_session(sid).view()

@router.get('/sessions/{sid}/events')
async def events(sid: str):
    session = get_session(sid)
    async def stream():
        queue = asyncio.Queue()
        session.listeners.add(queue)
        try:
            yield 'data: '+json.dumps({'type':'state','session':session.view()})+'\n\n'
            while True:
                try:
                    event = await asyncio.wait_for(queue.get(),15)
                    yield 'data: '+json.dumps(event)+'\n\n'
                except asyncio.TimeoutError:
                    yield ': heartbeat\n\n'
        finally:
            session.listeners.discard(queue)
    return StreamingResponse(stream(),media_type='text/event-stream',headers={'Cache-Control':'no-cache','X-Accel-Buffering':'no'})

@router.post('/sessions/{sid}/messages')
async def message(sid: str, request: Message):
    return await checked(get_session(sid).message(request.text))

@router.post('/sessions/{sid}/generate')
async def generate(sid: str, request: Message):
    session = get_session(sid)
    async def operation():
        async with session.lock:
            session.messages.append({'role':'user','text':request.text})
            await session.generation(request.text)
            session.messages.append({'role':'assistant','text':'Your agent, specification, and five caller scenarios are ready for review. Click Apply to save them.'})
            await session.publish()
            return session.view()
    return await checked(operation())

@router.post('/sessions/{sid}/approve')
async def approve(sid: str, request: Approval | None = None):
    session = get_session(sid)
    async def operation():
        async with session.lock:
            positions = {key:value.model_dump() for key,value in request.positions.items()} if request and request.positions is not None else None
            agent = await session.approve(positions)
            session.messages.append({'role':'assistant','text':'Applied. Run the callers to measure the changed behavior.'})
            await session.publish()
            return {'agent':agent,'issues':validate_agent(agent),'session':session.view()}
    return await checked(operation())

@router.post('/sessions/{sid}/reject')
async def reject(sid: str):
    session = get_session(sid)
    async with session.lock:
        session.proposal = None
        await session.publish()
        return session.view()

@router.post('/sessions/{sid}/simulate')
async def simulate(sid: str):
    session = get_session(sid)
    async def operation():
        async with session.lock:
            result = await session.run_suite()
            return {**result,'session':session.view()}
    return await checked(operation())

@router.post('/sessions/{sid}/feedback')
async def feedback(sid: str, request: Message):
    session = get_session(sid)
    async def operation():
        async with session.lock:
            await session.add_feedback(request.text)
            return session.view()
    return await checked(operation())

@router.post('/sessions/{sid}/fix')
async def fix(sid: str, request: Repair):
    session = get_session(sid)
    async def operation():
        async with session.lock:
            session.ensure_editable()
            issue = next((i for i in session.issues if i['id']==request.issue_id),None)
            if not issue: raise ValueError('Issue not found.')
            baseline = await session.reproduce(request.issue_id)
            data = storage.load_agent(session.agent_id)
            problem = ''
            for attempt in range(2):
                proposal = await json_completion(COPILOT_MODEL,
                    '''Propose the smallest graph fix for this issue. Return JSON {"summary":string,"patch":[RFC 6902 operations]}. Preserve all IDs and unrelated settings, edges, native fields and behavior. Never change /copilot metadata, scenario expectations, or specification to make a test pass. Add or change instructions/transitions/collected fields as needed. End nodes cannot have outgoing edges. If not reproduced, describe this as a proposed improvement, not a verified fix. JSON Patch paths use array indices in nodes and task_messages. Preserve valid targets when adding or renaming nodes. Give added nodes and edges unique UUID strings. Each edge has ONE STATIC destination: a collected intent parameter cannot dynamically route. Preserve human escalation separately from billing. For verify-before-billing, rewire the EXISTING billing edge to verification (do not just add a second optional verification edge leaving a billing bypass), ask for the required fields, then transition to billing once collected; update contradictory runtime persona/instructions if necessary. Do not send human requests into billing verification or leave the caller stuck at greeting. Model and voice must remain unchanged.''',
                    {'agent':data,'issue':issue,'regression':baseline,'previous_validation_error':problem},5000)
                try:
                    await session.stage_patch(proposal['patch'],proposal['summary'],request.issue_id,reproduction=baseline)
                    return session.view()
                except (ValueError,KeyError,TypeError) as exc:
                    problem = str(exc)
                    if attempt: raise
    return await checked(operation())

@router.post('/sessions/{sid}/review-call')
async def review_call(sid: str, request: CallReview):
    session = get_session(sid)
    async def operation():
        async with session.lock:
            if request.agent_id != session.agent_id:
                raise ValueError('This call belongs to a different agent. Open that agent to review it.')
            await session.review_transcript(request.source,request.name,
                                            [turn.model_dump() for turn in request.transcript])
            return session.view()
    return await checked(operation())

@router.post('/sessions/{sid}/restore-previous')
async def restore_previous(sid: str):
    session = get_session(sid)
    async def operation():
        async with session.lock:
            session.ensure_editable()
            path = storage.AGENTS_DIR/'.previous'/f'{session.agent_id}.json'
            if not path.exists(): raise ValueError('No previous saved version is available.')
            agent = json.loads(path.read_text())
            storage.write_agent(agent)
            session.before,session.current = session.current,None
            save_artifacts(session)
            await session.publish()
            return {'agent':agent,'issues':validate_agent(agent),'session':session.view()}
    return await checked(operation())

@router.get('/definition')
def definition():
    return json.loads(COPILOT_PATH.read_text())

@router.post('/restore-default')
async def restore_default():
    COPILOT_PATH.write_text(DEFAULT_PATH.read_text())
    for session in SESSIONS.values():
        if session.runtime:
            await session.runtime.close()
            session.runtime = None
        if session.proposal and session.proposal.get('target')=='copilot': session.proposal = None
        await session.publish()
    return {'status':'restored'}
