"""Small file-backed agent API, registered on Pipecat's existing server."""
import json
import os
from pathlib import Path
from uuid import UUID, uuid4

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from agent_builder import AgentBuilder
from agent_builder.validation import AgentDocument, validate_agent

AGENTS_DIR = Path(os.environ.get("AGENTS_DIR", Path(__file__).parent / "agents"))
router = APIRouter(prefix="/api/agents")


def agent_path(agent_id: str) -> Path:
    try:
        if str(UUID(agent_id)) != agent_id:
            raise ValueError()
    except (ValueError, TypeError):
        raise HTTPException(404, "Agent not found.")
    return AGENTS_DIR / f"{agent_id}.json"


def load_agent(agent_id: str) -> dict:
    path = agent_path(agent_id)
    if not path.exists():
        raise HTTPException(404, "Agent not found.")
    try:
        return AgentDocument.model_validate_json(path.read_text()).model_dump()
    except (ValueError, OSError) as exc:
        raise HTTPException(422, f"Cannot read agent file: {exc}")


def write_agent(data: dict) -> None:
    AGENTS_DIR.mkdir(parents=True, exist_ok=True)
    path = agent_path(data['id'])
    if path.exists():
        previous = json.loads(path.read_text())
        if previous != data:
            backup = AGENTS_DIR / '.previous'
            backup.mkdir(exist_ok=True)
            (backup / path.name).write_text(json.dumps(previous, indent=2) + '\n')
    path.write_text(json.dumps(data, indent=2) + "\n")


def builder_for_body(body: dict | None) -> AgentBuilder:
    if (body or {}).get('copilot_session_id'):
        from copilot.service import get_session
        return get_session(body['copilot_session_id']).builder()
    agent_id = (body or {}).get("agent_id")
    # Only the diagnostic prebuilt client omits the ID.
    data = load_agent(agent_id) if agent_id is not None else json.loads((Path(__file__).parent / "example_flow.json").read_text())
    return AgentBuilder.from_dict(data)


def require_credentials() -> None:
    missing = [key for key in ("OPENAI_API_KEY", "ELEVENLABS_API_KEY") if not os.environ.get(key)]
    if missing:
        raise HTTPException(503, "Configure " + " and ".join(missing) + " in backend/.env before calling.")


@router.get("")
def list_agents():
    items, errors = [], []
    for path in sorted(AGENTS_DIR.glob("*.json")):
        try:
            data = load_agent(path.stem)
            issues = validate_agent(data)
            items.append({"id": data["id"], "name": data["name"], "node_count": len(data["nodes"]),
                          "errors": sum(i["severity"] == "error" for i in issues),
                          "warnings": sum(i["severity"] == "warning" for i in issues)})
        except HTTPException as exc:
            errors.append({"file": path.name, "message": str(exc.detail)})
    return {"agents": items, "errors": errors}


class CreateAgent(BaseModel):
    template: str = "blank"
    name: str | None = None


@router.post("", status_code=201)
def create_agent(request: CreateAgent):
    if request.template not in ("blank", "clinic"):
        raise HTTPException(422, "Unknown template.")
    if request.template == "clinic":
        data = json.loads((Path(__file__).parent / "example_flow.json").read_text())
    else:
        data = AgentDocument(name="Untitled agent", persona="You are a helpful voice assistant. Keep responses brief and conversational.").model_dump()
    data["id"] = str(uuid4())
    if request.name is not None:
        data["name"] = request.name
    for index, node in enumerate(data["nodes"]):
        node["id"] = str(uuid4())
        for edge in node.get("edges", []):
            edge["id"] = str(uuid4())
        data.setdefault("editor", {}).setdefault("positions", {})[node["id"]] = {"x": index * 300, "y": 120}
    data = AgentDocument.model_validate(data).model_dump()
    write_agent(data)
    return {"agent": data, "issues": validate_agent(data)}


@router.get("/{agent_id}")
def get_agent(agent_id: str):
    data = load_agent(agent_id)
    return {"agent": data, "issues": validate_agent(data)}


@router.put("/{agent_id}")
def save_agent(agent_id: str, document: AgentDocument):
    from copilot.service import is_locked
    if is_locked(agent_id):
        raise HTTPException(409, 'Apply or Reject the Copilot proposal, or wait for simulations, before editing.')
    load_agent(agent_id)
    data = document.model_dump()
    data["id"] = agent_id
    write_agent(data)
    return {"agent": data, "issues": validate_agent(data)}


@router.delete("/{agent_id}", status_code=204)
def delete_agent(agent_id: str):
    from copilot.service import is_locked
    if is_locked(agent_id):
        raise HTTPException(409, 'Apply or Reject the Copilot proposal, or wait for simulations, before deleting.')
    load_agent(agent_id)
    agent_path(agent_id).unlink()


@router.post("/{agent_id}/validate")
def validate_document(agent_id: str, document: AgentDocument):
    agent_path(agent_id)
    return {"issues": validate_agent(document.model_dump())}


def register_api(app):
    app.include_router(router)
    from copilot.api import router as copilot_router
    app.include_router(copilot_router)

    @app.get("/api/health")
    async def health():
        return {"status": "ready", "voice_configured": all(os.environ.get(k) for k in ("OPENAI_API_KEY", "ELEVENLABS_API_KEY"))}

    @app.middleware("http")
    async def validate_start(request: Request, call_next):
        # Fail visibly before WebRTC negotiation, rather than inside a background bot.
        if request.method == "POST" and request.url.path == "/start":
            try:
                payload = await request.json()
                body = payload.get("body", {})
                if not isinstance(body, dict):
                    raise HTTPException(422, "Start body must be an object.")
                builder_for_body(body)
                require_credentials()
            except HTTPException as exc:
                return JSONResponse({"detail": exc.detail}, status_code=exc.status_code)
            except (ValueError, TypeError, AttributeError) as exc:
                return JSONResponse({"detail": str(exc)}, status_code=422)
        return await call_next(request)
