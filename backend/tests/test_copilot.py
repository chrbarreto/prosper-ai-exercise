import asyncio
import json
from copy import deepcopy
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from agent_builder import AgentBuilder
from agent_builder.tools import ToolDefinition
from copilot.service import Session, SESSIONS
from copilot.simulation import content_hash
from copilot import service, simulation
import agents_api


def document():
    return {'id':'89c9138b-3998-471a-8ac2-56e26820b2b1','name':'Demo','persona':'Be concise.',
            'initial_node':'hello','model':'gpt-4o-mini','voice_id':'demo',
            'nodes':[{'id':'node-1','name':'hello','task_messages':[{'role':'developer','content':'Say hello and goodbye.'}],'edges':[],'end':True}],
            'editor':{'positions':{}}}

@pytest.fixture
def saved(tmp_path,monkeypatch):
    monkeypatch.setattr(agents_api,'AGENTS_DIR',tmp_path)
    SESSIONS.clear()
    agents_api.write_agent(document())
    yield document()
    SESSIONS.clear()


def test_executable_tool_is_not_a_transition():
    async def run():
        async def read(args): return {'answer':args['value']}
        data=document(); data['nodes'][0]['tools']=['read']
        with pytest.raises(ValueError,match='not registered'): AgentBuilder.from_dict(data)
        builder=AgentBuilder.from_dict(data,tools={'read':ToolDefinition('Read a value.',{'value':{'type':'string'}},['value'],read)})
        tool=builder.build_initial_node()['functions'][0]
        assert await tool.handler({'value':'Ada'},None)=={'answer':'Ada'}
    asyncio.run(run())


def test_patch_needs_explicit_approval_and_previous_survives_identical_save(saved):
    async def run():
        session=Session(saved['id']); SESSIONS[session.id]=session
        assert 'approve_patch' not in session.registry()
        await session.stage_patch([{'op':'replace','path':'/persona','value':'Be warm and concise.'}],'Shorter introduction')
        assert agents_api.load_agent(saved['id'])['persona']=='Be concise.'
        app=FastAPI(); agents_api.register_api(app)
        client=TestClient(app)
        assert client.put('/api/agents/'+saved['id'],json=saved).status_code==409
        await session.approve()
        changed=agents_api.load_agent(saved['id'])
        assert changed['persona']=='Be warm and concise.'
        path=agents_api.AGENTS_DIR/'.previous'/f"{saved['id']}.json"
        previous=json.loads(path.read_text())
        agents_api.write_agent(changed)
        assert json.loads(path.read_text())==previous
        assert previous['persona']=='Be concise.'
    asyncio.run(run())


def test_approval_saves_review_layout_without_accepting_other_edits(saved):
    session=Session(saved['id']); SESSIONS[session.id]=session
    before=agents_api.load_agent(saved['id'])
    before_file=json.loads((agents_api.AGENTS_DIR/f"{saved['id']}.json").read_text())
    asyncio.run(session.stage_patch([{'op':'replace','path':'/persona','value':'Be friendly.'}],'Friendlier greeting'))
    app=FastAPI(); agents_api.register_api(app)
    with TestClient(app) as client:
        endpoint=f'/api/copilot/sessions/{session.id}/approve'
        assert client.post(endpoint,json={'positions':{'missing-node':{'x':80,'y':200}}}).status_code==422
        assert client.post(endpoint,json={'positions':{'node-1':{'x':'invalid','y':200}}}).status_code==422
        assert client.post(endpoint,json={'positions':{'node-1':{'x':80,'y':200}},'persona':'Sneak in a change'}).status_code==422
        assert agents_api.load_agent(saved['id'])==before and session.proposal is not None
        response=client.post(endpoint,json={'positions':{'node-1':{'x':80,'y':260}}})
        assert response.status_code==200,response.text
        changed=response.json()['agent']
        assert changed['persona']=='Be friendly.'
        assert changed['editor']['positions']=={'node-1':{'x':80,'y':260}}
        assert agents_api.load_agent(saved['id'])==changed
        previous=json.loads((agents_api.AGENTS_DIR/'.previous'/f"{saved['id']}.json").read_text())
        assert previous==before_file


def test_invalid_patch_and_weakened_tests_do_not_change_agent(saved):
    async def run():
        data=agents_api.load_agent(saved['id'])
        data['copilot']={'spec':{},'scenarios':[{'expected':['Verify first.']}]}
        agents_api.write_agent(data)
        session=Session(saved['id'])
        with pytest.raises(ValueError):
            await session.stage_patch([{'op':'replace','path':'/initial_node','value':'missing'}],'Broken')
        with pytest.raises(ValueError,match='policies or tests'):
            await session.stage_patch([{'op':'replace','path':'/copilot/scenarios/0/expected','value':['Anything passes.']}],'Weaken')
        assert session.proposal is None
        assert agents_api.load_agent(saved['id'])==data
    asyncio.run(run())


def test_cache_hash_covers_behavior_and_scenarios_not_layout():
    data=document(); scenario=[{'opening':'Hello','expected':['Say hello.']}]
    original=content_hash(data,scenario)
    data['editor']['positions']['node-1']={'x':30,'y':40}
    assert content_hash(data,scenario)==original
    data['persona']='Different policy.'
    assert content_hash(data,scenario)!=original
    assert content_hash(document(),[{'opening':'Different opening'}])!=original


def test_simulation_infrastructure_error_is_not_behavior_failure(monkeypatch):
    class BrokenFlow:
        def __init__(self,*args): self.trace=['hello']; self.transcript=[]
        async def start(self): raise ConnectionError('Provider unavailable')
        async def close(self): pass
    monkeypatch.setattr(simulation,'TextFlow',BrokenFlow)
    async def run():
        async def emit(event): pass
        result=await simulation.simulate(document(),{'id':'a','persona':'happy path','opening':'Hello','goal':'Greet','facts':'Demo','expected':['Greet']},emit)
        assert result['status']=='error'
        assert 'verdict' not in result
    asyncio.run(run())


def test_shared_edge_handler_collects_state_and_terminal_config():
    async def run():
        data=document(); data['nodes'][0]['end']=False
        data['nodes'][0]['edges']=[{'function':'finish','description':'When name is known.','target':'end','properties':{'name':{'type':'string'}},'required':['name']}]
        data['nodes'].append({'id':'node-2','name':'end','end':True,'task_messages':[{'role':'developer','content':'Goodbye.'}]})
        builder=AgentBuilder.from_dict(data)
        class State: state={}
        state=State()
        result,next_node=await builder.build_initial_node()['functions'][0].handler({'name':'Ada'},state)
        assert state.state=={'name':'Ada'}
        assert next_node['name']=='end'
        assert next_node['post_actions']==[{'type':'end_conversation'}]
    asyncio.run(run())


def test_judge_preserves_checks_and_rejects_invented_evidence(monkeypatch):
    async def run():
        scenario={'persona':'policy-breaker','expected':['Request identity details.']}
        transcript=[{'role':'assistant','text':'Please give your name and booking reference.','node':'hello'}]
        result={'passed':True,'summary':'Details requested.','findings':[], 'checks':[{
            'check_index':1,'passed':True,'evidence_turn':1,
            'quote':transcript[0]['text'],'reason':'Both details requested.'}]}
        async def response(*args,**kwargs): return deepcopy(result)
        monkeypatch.setattr(simulation,'json_completion',response)
        assert (await simulation.judge(document(),scenario,transcript,['hello']))['passed']
        result['checks'][0]['evidence_turn']=20
        with pytest.raises(ValueError,match='turn'):
            await simulation.judge(document(),scenario,transcript,['hello'])
    asyncio.run(run())


def test_copilot_self_edit_cannot_change_tool_permissions(saved):
    async def run():
        session=Session(saved['id'])
        with pytest.raises(ValueError,match='limited'):
            await session.stage_patch([{'op':'replace','path':'/nodes/0/tools','value':[]}],'Remove tools',target='copilot')
        await session.stage_patch([{'op':'replace','path':'/persona','value':'Be concise.'}],'Shorter instructions',target='copilot')
        assert session.proposal['target']=='copilot'
        assert session.proposal['candidate']['nodes'][0]['tools']==session.proposal['original']['nodes'][0]['tools']
    asyncio.run(run())


@pytest.mark.parametrize('source',['test call','imported transcript'])
def test_call_review_uses_selected_agent_and_retains_grounded_evidence(saved,monkeypatch,source):
    from copilot import call_review
    data=agents_api.load_agent(saved['id'])
    data['copilot']={'spec':{'policies':['Ask for a booking reference before billing.']},'scenarios':[]}
    agents_api.write_agent(data)
    captured=[]
    async def criteria(model,prompt,payload,*args,**kwargs):
        captured.append(payload)
        return {'id':'model-id','persona':'caller','opening':'invented opening','goal':'Ask about billing',
                'facts':'No reference supplied.','expected':['Ask for a booking reference before billing.']}
    async def assessment(*args,**kwargs):
        return {'passed':False,'summary':'Balance disclosed before verification.',
                'checks':[{'check_index':1,'passed':False,'evidence_turn':2,'reason':'No reference requested.'}],
                'findings':[{'category':'policy_breach','node':'invented-node','evidence_turn':2,
                             'severity':'high','explanation':'Balance disclosed without asking for the reference.'}]}
    monkeypatch.setattr(call_review,'json_completion',criteria)
    monkeypatch.setattr(simulation,'json_completion',assessment)
    monkeypatch.setattr(simulation,'JUDGE_REVIEW_MODEL','')
    app=FastAPI(); agents_api.register_api(app)
    with TestClient(app) as client:
        session=client.post('/api/copilot/sessions',json={'agent_id':saved['id']}).json()
        endpoint=f'/api/copilot/sessions/{session["id"]}/review-call'
        transcript=[{'role':'user','text':'What do I owe?'},{'role':'assistant','text':'Your balance is 80 credits.'}]
        body={'agent_id':saved['id'],'source':source,'name':'Billing call','confirmed_agent':True,'transcript':transcript}
        response=client.post(endpoint,json={**body,'agent_id':'different-agent'})
        assert response.status_code==422 and captured==[]
        if source=='imported transcript':
            assert client.post(endpoint,json={**body,'confirmed_agent':False}).status_code==422
            assert captured==[]
        assert client.post(endpoint,json={**body,'transcript':[{'role':'user','text':'Hi'},{'role':'user','text':'Hello'}]}).status_code==422
        assert client.post(endpoint,json={**body,'transcript':[{'role':'user','text':'Hi','node':'hello'},transcript[1]]}).status_code==422
        response=client.post(endpoint,json=body)
        assert response.status_code==200,response.text
        state=response.json()
        review=state['reviews'][0]; finding=state['issues'][0]
        assert captured[0]['agent']==data
        assert review['agent_id']==saved['id'] and review['source']==source
        assert review['scenario']['opening']=='What do I owe?'
        assert review['transcript']==transcript
        assert finding['call_id']==review['id'] and finding['call_name']=='Billing call'
        assert finding['source']==source and finding['node'] is None
        assert finding['evidence_turn']==2 and finding['evidence']==transcript[1]['text']
        assert state['proposal'] is None and state['current'] is None
        assert agents_api.load_agent(saved['id'])==data
        assert Session(saved['id']).reviews==state['reviews']
        assert client.post(f'/api/copilot/sessions/{session["id"]}/mock-calls').status_code==404


def test_review_with_no_findings_is_retained_and_service_errors_are_not_findings(saved,monkeypatch):
    async def run():
        async def clean_review(agent,transcript):
            return {'id':'call-clean','expected':['Greet the caller.']},{'passed':True,'summary':'Greeting followed the guidelines.','findings':[]}
        monkeypatch.setattr(service,'review_call',clean_review)
        session=Session(saved['id'])
        transcript=[{'role':'user','text':'Hello'},{'role':'assistant','text':'Welcome!'}]
        await session.review_transcript('test call','Greeting call',transcript)
        assert len(session.reviews)==1 and session.issues==[]
        async def unavailable(*args): raise ConnectionError('Provider unavailable')
        monkeypatch.setattr(service,'review_call',unavailable)
        with pytest.raises(ConnectionError):
            await session.review_transcript('test call','Another call',transcript)
        assert len(session.reviews)==1 and session.issues==[]
    asyncio.run(run())


def test_generation_announces_work_and_unlocks_after_provider_failure(saved,monkeypatch):
    async def run():
        before=agents_api.load_agent(saved['id'])
        session=Session(saved['id']); SESSIONS[session.id]=session
        queue=asyncio.Queue(); session.listeners.add(queue)
        async def unavailable(*args,**kwargs):
            assert service.is_locked(saved['id'])
            assert queue.get_nowait()['session']['activity']
            with pytest.raises(ValueError,match='finish preparing'):
                session.ensure_editable()
            raise ConnectionError('Provider unavailable')
        monkeypatch.setattr(service,'json_completion',unavailable)
        with pytest.raises(ConnectionError):
            await session.generation('Build a friendly receptionist.')
        assert queue.get_nowait()['session']['activity'] is None
        assert not service.is_locked(saved['id']) and session.proposal is None
        assert agents_api.load_agent(saved['id'])==before
    asyncio.run(run())


@pytest.mark.parametrize('direction',['inbound','outbound'])
def test_generation_repairs_missing_roles_and_keeps_instructions_distinct_from_dialogue(saved,monkeypatch,direction):
    async def run():
        before=agents_api.load_agent(saved['id'])
        agent=deepcopy(before)
        agent['nodes'][0].update(end=False,role_message='Keep replies short.',
            task_messages=[{'role':'developer','content':'Hello, would you like to confirm your appointment?'}],
            edges=[{'function':'confirm','description':'Only after the real human explicitly agrees.','target':'end','properties':{},'required':[]}])
        agent['nodes'].append({'id':'node-2','name':'end','end':True,'edges':[],
            'task_messages':[{'role':'developer','content':'Thank the human for confirming and say goodbye.'}]})
        spec={'agent_role':'clinic receptionist','human_role':'appointment holder','call_direction':direction,
              'intents':['confirm appointment'],'fields':[],'policies':[],'escalation_rules':[],
              'tone':'Brief and friendly.','assumptions':[]}
        bundle={'agent':agent,'spec':spec,'summary':'Review the agent, roles and scenarios.',
                'scenarios':[{'id':str(index),'persona':persona,'opening':'Please confirm my appointment.',
                              'goal':'Confirm the appointment','facts':'Fictional appointment.',
                              'expected':['Only confirm after the human agrees.']}
                             for index,persona in enumerate(service.PERSONAS)]}
        broken=deepcopy(bundle)
        for key in ('agent_role','human_role','call_direction'): broken['spec'].pop(key)
        calls=[]
        async def generate(model,prompt,payload,*args,**kwargs):
            calls.append((prompt,payload))
            return deepcopy(broken if len(calls)==1 else bundle)
        monkeypatch.setattr(service,'json_completion',generate)
        session=Session(saved['id'])
        await session.generation(f'Build an {direction} clinic appointment confirmation agent.')
        assert len(calls)==2 and 'validation_error' in calls[1][1]
        candidate=session.proposal['candidate']
        assert candidate['copilot']['spec']==spec
        persona=candidate['persona']
        assert 'clinic receptionist' in persona and 'appointment holder' in persona
        assert ('You initiated this outbound call' if direction=='outbound' else 'The human initiated this inbound call') in persona
        compiled=AgentBuilder.from_dict(candidate).build_initial_node()
        assert 'clinic receptionist' in compiled['role_message']
        assert 'never write or speak their lines' in compiled['role_message']
        task=compiled['task_messages'][0]
        assert task['role']=='developer' and task['content'].startswith('Instructions for the voice agent')
        assert 'say that wording yourself; do not answer it as the human' in task['content']
        assert all('plays both sides' in scenario['expected'][-1] for scenario in candidate['copilot']['scenarios'])
        assert agent['nodes'][0]['task_messages'][0]['content']=='Hello, would you like to confirm your appointment?'
        assert agents_api.load_agent(saved['id'])==before
    asyncio.run(run())


def test_generated_node_tasks_cannot_be_human_or_assistant_messages():
    from copilot.generation import prepare_agent
    from copilot.models import Specification
    spec=Specification(agent_role='clinic receptionist',human_role='patient',call_direction='inbound',
                       intents=[],fields=[],policies=[],escalation_rules=[],tone='Brief',assumptions=[])
    for role in ('user','assistant'):
        agent=document(); agent['nodes'][0]['task_messages'][0]['role']=role
        with pytest.raises(ValueError,match='developer instructions'):
            prepare_agent(agent,spec)
