"""Executable tool definitions; runtime handlers are injected by trusted code."""
from dataclasses import dataclass
from typing import Awaitable, Callable

@dataclass
class ToolDefinition:
    description: str
    properties: dict
    required: list[str]
    handler: Callable[[dict], Awaitable[dict]]
