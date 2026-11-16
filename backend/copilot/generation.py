"""Generation instructions and explicit conversational roles for generated agents."""
from copy import deepcopy

from .models import Specification

GENERATION_PROMPT = '''You build executable voice-agent graphs from client guidelines. Return ONE JSON object with keys spec, agent, scenarios, summary.
Spec: {agent_role:string,human_role:string,call_direction:"inbound"|"outbound",intents:[strings],fields:[strings],policies:[strings],escalation_rules:[strings],tone:string,assumptions:[strings]}.
Identify the agent's concrete business role and the human participant's role. Outbound means the AGENT initiates the business call and the human receives it; inbound means the HUMAN initiates and the agent answers. This is call context, not a telephony integration. Follow the brief and existing business context. If unspecified, assume inbound and state that assumption explicitly.
Agent: {name,persona,model,voice_id,initial_node,nodes:[{name,task_messages:[{role:"developer",content:string}],edges:[{function,description,target,properties:{field:{type:"string",description:string}},required:[field]}],end:boolean}]}.
Write a specific persona for the business role, who the human is, and who initiated the call. Replace a generic starter persona such as "You are a helpful voice assistant". Speak ONLY as the agent; never impersonate the human, produce both sides of a dialogue, invent human agreement, or continue after a question as if the human answered.
Every task_messages entry is a DEVELOPER INSTRUCTION to the agent, never a conversation transcript or standalone first dialogue line. Use directives: Greet, Say, Ask, Explain, Wait. Quoted spoken examples must be explicitly introduced with Say or Ask. After a question, explicitly wait for the real human's reply before taking response-dependent transitions. Transition descriptions must require actual human input for agreement, intent and collected facts; never infer these from the node prompt itself. Do not use user/assistant task-message roles or multi-speaker scripts. Preserve this perspective in all nodes, including any role_message overrides and terminal nodes.
BAD opening task: "Hello, I'm calling from the veterinarian clinic to confirm your appointment. Would you like to confirm?"
GOOD opening task: "As the clinic employee, introduce yourself and explain that you are calling to confirm the recipient's appointment. Ask whether they want to confirm, cancel or reschedule, then stop and wait for their actual reply. Do not confirm on their behalf."
Scenarios: exactly five, one for each supplied persona, each {id:string,persona:string,opening:string,goal:string,facts:string,expected:[explicit checks]}. These personas always play the HUMAN, including the recipient in outbound calls. opening is the human's first reply after the agent greeting, never the agent's own opening line. The expected list is the grading contract: include applicable client policies, successful behavior or appropriate refusal/escalation. Check role consistency and that agreement comes from actual human input. An adversarial human's goal is NOT the expected agent behavior. Include fictional facts needed to finish; exercise meaningful different behaviors or branches.
Use valid JSON Schema for collected fields, function names with letters/digits/underscores, real target node names, one start and appropriate endings. Every edge has ONE STATIC target: a collected intent enum DOES NOT select a destination. Give distinct intents separate edges with distinct targets, especially human escalation versus billing. An edge with no collected fields uses properties:{} and required:[]. Required names MUST be keys in properties. Every non-start node should be reachable. End nodes have no outgoing edges. Keep the graph small (4-8 nodes), spoken prompts concise, and avoid fixed appointment offers for cancellation/rescheduling. Explain assumptions instead of inventing business facts. Absence of a requirement is not a policy forbidding it. No executable tools, custom actions or real external integrations. Preserve model/voice settings unless requested, unrelated existing behavior and stable node/edge IDs. Summary states that spec and tests will be replaced visibly.'''

REPAIR_PROMPT = '''Repair this generated voice-agent bundle. Return the complete JSON object with spec, agent, scenarios, summary. Fix every reported error without changing client requirements. Spec must include nonempty agent_role, human_role and call_direction (inbound or outbound), and the normal intents, fields, policies, escalation_rules, tone, assumptions. Keep agent and human roles distinct and preserve the call initiator. Persona must identify the agent's business role and the human's role. Node task_messages must be developer instructions (Greet/Say/Ask/Wait), not user or assistant messages or standalone dialogue. Quoted speech must be attributed to the agent. Wait for actual human input before response-dependent transitions. Never generate both sides of a conversation. Every required collected field must have a matching edge.properties key. Use exactly the five supplied persona strings with unique scenario IDs; these personas play the human even in outbound calls. Scenarios need string opening/goal/facts and a list of expected checks. Do not add executable tools or actions.'''

TURN_TAKING = '''Speak only as the agent in the business role defined above. The other participant is a real human; never write or speak their lines or invent their replies, intent, agreement or details. Node tasks are instructions addressed to you, not dialogue already spoken by either participant. Execute them from your own role. After asking a question, stop and wait for a real human reply. Take a response-dependent transition only when actual human input satisfies its condition. Your own words and quoted node examples are never evidence of human consent.'''

NODE_PREFIX = 'Instructions for the voice agent, not conversation history:\n'
NODE_SUFFIX = '\n\nCarry out this task as the agent. If it contains standalone spoken wording, say that wording yourself; do not answer it as the human. Questions require waiting for a real human reply. Never supply the human response yourself.'


def prepare_agent(data: dict, spec: Specification) -> dict:
    """Make role/turn-taking boundaries explicit even if the model emits bare speech."""
    agent = deepcopy(data)
    direction = ('You initiated this outbound call; the human is the recipient.'
                 if spec.call_direction == 'outbound'
                 else 'The human initiated this inbound call; you are answering it.')
    identity = f'Your role: {spec.agent_role}.\nThe human participant\'s role: {spec.human_role}.\n{direction}'

    def persona(text):
        if not isinstance(text,str):
            raise ValueError('Generated persona and node role overrides must be instruction text.')
        return f'{text.strip()}\n\n{identity}\n\n{TURN_TAKING}'.strip()

    agent['persona'] = persona(agent.get('persona',''))
    for node in agent.get('nodes',[]):
        if node.get('role_message'):
            node['role_message'] = persona(node['role_message'])
        for message in node.get('task_messages',[]):
            if message.get('role') != 'developer':
                raise ValueError('Generated node tasks must use developer instructions, not user/assistant dialogue.')
            content = message.get('content')
            if not isinstance(content,str) or not content.strip():
                raise ValueError('Generated node tasks must contain nonempty instruction text.')
            if not content.startswith(NODE_PREFIX):
                message['content'] = NODE_PREFIX + content.strip() + NODE_SUFFIX
    return agent


def role_expectation(spec: Specification) -> str:
    return f'The agent speaks only as {spec.agent_role} to the human ({spec.human_role}), waits for actual human replies when asking questions, and never invents human agreement or plays both sides.'
