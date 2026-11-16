"""Runtime checks shared by the editor API and the flow compiler."""
from collections import Counter
import re
from typing import Any

from jsonschema import Draft202012Validator, SchemaError
from pydantic import BaseModel, ConfigDict, Field


class EdgeDocument(BaseModel):
    model_config = ConfigDict(extra="allow", strict=True)
    id: str = ""
    function: str = ""
    description: str = ""
    target: str = ""
    properties: dict[str, Any] = Field(default_factory=dict)
    required: list[str] = Field(default_factory=list)


class NodeDocument(BaseModel):
    model_config = ConfigDict(extra="allow", strict=True)
    id: str = ""
    name: str = ""
    task_messages: list[dict[str, Any]] = Field(default_factory=list)
    role_message: str | None = None
    edges: list[EdgeDocument] = Field(default_factory=list)
    pre_actions: list[dict[str, Any]] = Field(default_factory=list)
    post_actions: list[dict[str, Any]] = Field(default_factory=list)
    end: bool = False
    tools: list[str] = Field(default_factory=list)


class AgentDocument(BaseModel):
    model_config = ConfigDict(extra="allow", strict=True)
    id: str = ""
    name: str = "Untitled agent"
    persona: str = ""
    model: str = "gpt-4o"
    voice_id: str = "21m00Tcm4TlvDq8ikWAM"
    initial_node: str = ""
    nodes: list[NodeDocument] = Field(default_factory=list)
    editor: dict[str, Any] = Field(default_factory=dict)


class Issue(BaseModel):
    severity: str
    code: str
    message: str
    node: str | None = None
    edge: str | None = None
    field: str | None = None


def validate_agent(data: dict) -> list[dict]:
    """Accept incomplete documents for saving; report what prevents a call."""
    doc = AgentDocument.model_validate(data)
    issues: list[Issue] = []

    def add(code, message, node=None, edge=None, field=None, severity="error"):
        issues.append(Issue(severity=severity, code=code, message=message,
                            node=node, edge=edge, field=field))

    for field in ("name", "model", "voice_id"):
        if not getattr(doc, field).strip():
            add("missing_setting", f"Enter an agent {field.replace('_', ' ')}.", field=field)
    if not doc.nodes:
        add("empty_graph", "Add your first node before calling.")
    names = [n.name for n in doc.nodes]
    for name, count in Counter(names).items():
        if count > 1:
            for node in (n for n in doc.nodes if n.name == name):
                add("duplicate_name", f"Node name '{name}' is used more than once.", node.id or name, field="name")
    if not doc.initial_node or doc.initial_node not in names:
        add("invalid_start", "Choose an existing node as the start.", field="initial_node")
    ids = [n.id for n in doc.nodes if n.id] + [e.id for n in doc.nodes for e in n.edges if e.id]
    if len(ids) != len(set(ids)):
        add("duplicate_id", "Nodes and transitions must have unique IDs.")
    for node in doc.nodes:
        nid = node.id or node.name
        if not node.name.strip():
            add("missing_node_name", "Enter a node name.", nid, field="name")
        if not any(str(m.get("content", "")).strip() for m in node.task_messages):
            add("empty_instructions", "Give this step conversation instructions.", nid, field="instructions", severity="warning")
        for message in node.task_messages:
            if message.get("role") not in ("system", "developer", "user", "assistant") or not isinstance(message.get("content"), str):
                add("invalid_message", "Instructions must contain a supported role and text content.", nid, field="instructions")
        if node.end and node.edges:
            add("terminal_edges", "End nodes cannot have outgoing transitions.", nid, field="end")
        if not node.end and not node.edges:
            add("dead_end", "This step has no transitions and does not end the call.", nid, severity="warning")
        functions = Counter(e.function for e in node.edges)
        for index, edge in enumerate(node.edges):
            eid = edge.id or f"{nid}:{index}"
            if not re.fullmatch(r"[a-zA-Z0-9_-]{1,64}", edge.function):
                add("invalid_function", "Use 1–64 letters, numbers, underscores or hyphens for the function name.", nid, eid, "function")
            elif functions[edge.function] > 1:
                add("duplicate_function", "Each outgoing function name must be unique within this node.", nid, eid, "function")
            if not edge.description.strip():
                add("missing_description", "Describe when the agent should take this transition.", nid, eid, "description")
            if edge.target not in names:
                add("unknown_target", "Choose an existing destination node.", nid, eid, "target")
            if any(key not in edge.properties for key in edge.required):
                add("invalid_required", "Every required field must exist in collected fields.", nid, eid, "properties")
            try:
                Draft202012Validator.check_schema({"type": "object", "properties": edge.properties, "required": edge.required})
                if any(not key.strip() for key in edge.properties):
                    raise ValueError("Collected fields need names.")
            except (SchemaError, ValueError) as exc:
                message = exc.message if isinstance(exc, SchemaError) else str(exc)
                add("invalid_schema", f"Invalid collected fields: {message}", nid, eid, "properties")
        for field in ("pre_actions", "post_actions"):
            for action in getattr(node, field):
                kind = action.get("type")
                if kind not in ("tts_say", "end_conversation"):
                    add("unsupported_action", f"Unsupported {field} action: {kind!r}.", nid, field=field)
                elif kind == "tts_say" and not isinstance(action.get("text"), str):
                    add("invalid_action", "A tts_say action needs text.", nid, field=field)
    if doc.nodes and not any(n.end for n in doc.nodes):
        add("no_end", "Add an end node so the agent can finish the call.", severity="warning")
    reachable: set[str] = set()
    pending = [doc.initial_node]
    by_name = {n.name: n for n in doc.nodes}
    while pending:
        name = pending.pop()
        if name in reachable or name not in by_name:
            continue
        reachable.add(name)
        pending.extend(e.target for e in by_name[name].edges)
    for node in doc.nodes:
        if node.name not in reachable:
            add("unreachable", "This node cannot be reached from the start.", node.id or node.name, severity="warning")
    return [issue.model_dump() for issue in issues]
