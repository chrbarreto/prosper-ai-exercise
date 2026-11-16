import json
from typing import Literal
from pydantic import BaseModel, Field, field_validator

class Scenario(BaseModel):
    id: str
    persona: str
    opening: str
    goal: str
    facts: str
    expected: list[str] = Field(min_length=1)

    @field_validator('facts', mode='before')
    @classmethod
    def facts_as_text(cls, value):
        return json.dumps(value) if isinstance(value, (dict, list)) else value

class Specification(BaseModel):
    agent_role: str = Field(min_length=1)
    human_role: str = Field(min_length=1)
    call_direction: Literal['inbound','outbound']
    intents: list[str]
    fields: list[str]
    policies: list[str]
    escalation_rules: list[str]
    tone: str
    assumptions: list[str]

class Finding(BaseModel):
    category: str
    node: str | None = None
    evidence_turn: int = Field(ge=1)
    severity: str
    explanation: str

class Criterion(BaseModel):
    check_index: int = Field(ge=1)
    passed: bool
    evidence_turn: int = Field(ge=1)
    reason: str

class Verdict(BaseModel):
    passed: bool
    summary: str
    findings: list[Finding]
    checks: list[Criterion]
