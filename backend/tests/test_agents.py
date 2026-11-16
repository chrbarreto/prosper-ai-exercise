import asyncio
from copy import deepcopy
from pathlib import Path
import sys

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from agent_builder import AgentBuilder
from agent_builder.validation import validate_agent
import agents_api


def example():
    return {"name": "Demo", "initial_node": "hello", "nodes": [
        {"name": "hello", "task_messages": [{"role": "developer", "content": "Say hello."}],
         "edges": [{"function": "finish", "description": "When ready to end.", "target": "goodbye", "properties": {"name": {"type": "string"}}, "required": ["name"]}]},
        {"name": "goodbye", "task_messages": [{"role": "developer", "content": "Say goodbye."}], "end": True},
    ]}


def test_validation_and_duplicate_names():
    data = example()
    assert not [i for i in validate_agent(data) if i["severity"] == "error"]
    data["nodes"].append(deepcopy(data["nodes"][0]))
    assert "duplicate_name" in {i["code"] for i in validate_agent(data)}
    with pytest.raises(ValueError, match="more than once"):
        AgentBuilder.from_dict(data)


def test_bad_graph_and_parameters():
    data = example()
    edge = data["nodes"][0]["edges"][0]
    edge["target"] = "missing"
    edge["required"] = ["missing"]
    edge["properties"]["broken"] = {"type": "not-a-type"}
    issues = validate_agent(data)
    assert {"unknown_target", "invalid_required", "invalid_schema"} <= {i["code"] for i in issues}
    assert all(set(i) == {"severity", "code", "message", "node", "edge", "field"} for i in issues)


def test_terminal_actions_preserved_and_end_is_last_once():
    data = example()
    actions = [{"type": "end_conversation"}, {"type": "tts_say", "text": "Thank you."}, {"type": "end_conversation"}]
    data["nodes"][1]["post_actions"] = actions
    builder = AgentBuilder.from_dict(data)
    node = builder._make_node(builder.config.nodes[1])
    assert node["post_actions"] == [{"type": "tts_say", "text": "Thank you."}, {"type": "end_conversation"}]
    assert data["nodes"][1]["post_actions"] == actions


def test_api_drafts_independent_files_and_start_body(tmp_path, monkeypatch):
    monkeypatch.setattr(agents_api, "AGENTS_DIR", tmp_path)
    app = FastAPI()
    agents_api.register_api(app)
    client = TestClient(app)
    first = client.post("/api/agents", json={"name": "First"}).json()["agent"]
    second = client.post("/api/agents", json={"name": "Second"}).json()["agent"]
    saved = client.put(f'/api/agents/{first["id"]}', json=first)
    assert saved.status_code == 200
    assert any(i["code"] == "empty_graph" for i in saved.json()["issues"])
    for agent in (first, second):
        document = {**example(), "name": agent["name"], "id": agent["id"]}
        client.put(f'/api/agents/{agent["id"]}', json=document)
        assert agents_api.builder_for_body({"agent_id": agent["id"]}).config.name == agent["name"]
    assert len(list(tmp_path.glob("*.json"))) == 2
    client.delete(f'/api/agents/{first["id"]}')
    assert client.get(f'/api/agents/{second["id"]}').status_code == 200
    assert client.get('/api/agents/not-a-file').status_code == 404
    assert client.post('/start', json={"body": {"agent_id": first["id"]}}).status_code == 404
