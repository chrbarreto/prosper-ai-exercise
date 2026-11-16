#
# AgentBuilder — loads a declarative agent (JSON / dict) and compiles its node
# graph into Pipecat Flows objects.
#
#   JSON  ->  AgentConfig (validated)  ->  Pipecat Flows NodeConfig graph
#
# This is the seam between "agent as data" (what the Phase 2 Composer produces)
# and "agent as a running conversation" (what bot.py executes). Keeping the
# compile + validation here means bot.py never touches the graph internals.
#

import json
from dataclasses import asdict
from pathlib import Path
from typing import Union

from loguru import logger
from jsonschema import validate as validate_json
from pipecat_flows import FlowManager, FlowsFunctionSchema, NodeConfig

from .schema import AgentConfig, Edge, Node
from .validation import validate_agent
from .tools import ToolDefinition


class AgentBuilder:
    """Builds a runnable Pipecat Flows graph from a declarative AgentConfig."""

    def __init__(self, config: AgentConfig, tools: dict[str, ToolDefinition] | None = None):
        self.config = config
        self.tools = tools or {}
        self._validate()
        self._nodes_by_name = {n.name: n for n in config.nodes}

    # ---- loading -----------------------------------------------------------
    @classmethod
    def from_dict(cls, data: dict, tools: dict[str, ToolDefinition] | None = None) -> "AgentBuilder":
        errors = [i for i in validate_agent(data) if i["severity"] == "error"]
        if errors:
            raise ValueError(" ".join(i["message"] for i in errors))
        return cls(AgentConfig.from_dict(data), tools=tools)

    @classmethod
    def from_json(cls, path: Union[str, Path]) -> "AgentBuilder":
        data = json.loads(Path(path).read_text())
        return cls.from_dict(data)

    # ---- validation --------------------------------------------------------
    def _validate(self) -> None:
        errors = [i for i in validate_agent(asdict(self.config)) if i["severity"] == "error"]
        if errors:
            raise ValueError(" ".join(i["message"] for i in errors))
        for node in self.config.nodes:
            names = [edge.function for edge in node.edges] + node.tools
            if len(names) != len(set(names)):
                raise ValueError(f"Duplicate tool name in {node.name}.")
            for name in node.tools:
                if name not in self.tools:
                    raise ValueError(f"Executable tool '{name}' is not registered for this runtime.")

    # ---- compilation -------------------------------------------------------
    def build_initial_node(self) -> NodeConfig:
        """Return the entry NodeConfig; downstream nodes are built lazily on transition."""
        return self._make_node(self._nodes_by_name[self.config.initial_node])

    def _make_node(self, node: Node) -> NodeConfig:
        node_config: NodeConfig = {
            "name": node.name,
            "role_message": node.role_message or self.config.persona,
            "task_messages": node.task_messages,
            "functions": [self._make_edge_function(edge) for edge in node.edges]
                + [self._make_tool(name) for name in node.tools],
        }
        if node.pre_actions:
            node_config["pre_actions"] = node.pre_actions
        # A terminal node must end even when other post-actions are present.
        actions = [dict(action) for action in node.post_actions]
        if node.end:
            actions = [a for a in actions if a.get("type") != "end_conversation"]
            actions.append({"type": "end_conversation"})
        if actions:
            node_config["post_actions"] = actions
        return node_config

    def _make_tool(self, name: str) -> FlowsFunctionSchema:
        tool = self.tools[name]
        async def handler(args: dict, flow_manager: FlowManager):
            validate_json(args, {'type':'object','properties':tool.properties,'required':tool.required})
            return await tool.handler(args)
        return FlowsFunctionSchema(name=name, description=tool.description,
                                   properties=tool.properties, required=tool.required, handler=handler,
                                   timeout_secs=300)

    def _make_edge_function(self, edge: Edge) -> FlowsFunctionSchema:
        async def handler(args: dict, flow_manager: FlowManager):
            # Persist what the caller gave us so later nodes can use it.
            validate_json(args, {'type':'object','properties':edge.properties,'required':edge.required})
            flow_manager.state.update(args)
            logger.info(f"[{edge.function}] -> {edge.target}")
            next_node = self._make_node(self._nodes_by_name[edge.target])
            return {"status": "success", **args}, next_node

        return FlowsFunctionSchema(
            name=edge.function,
            description=edge.description,
            properties=edge.properties,
            required=edge.required,
            handler=handler,
        )
