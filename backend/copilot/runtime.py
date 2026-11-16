"""Audio-free Pipecat conversations, sharing compilation and handlers with voice."""
import asyncio
import os
from collections.abc import Awaitable, Callable

from pipecat.frames.frames import (ErrorFrame, FunctionCallInProgressFrame, FunctionCallResultFrame,
    LLMFullResponseEndFrame, LLMFullResponseStartFrame, LLMMessagesAppendFrame, LLMTextFrame, TTSSpeakFrame)
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.worker import PipelineWorker
from pipecat.processors.frame_processor import FrameProcessor
from pipecat.processors.aggregators.llm_context import LLMContext
from pipecat.processors.aggregators.llm_response_universal import LLMContextAggregatorPair
from pipecat.services.openai.llm import OpenAILLMService
from pipecat.workers.runner import WorkerRunner
from pipecat_flows import FlowManager
from agent_builder import AgentBuilder


class TextFlow:
    def __init__(self, builder: AgentBuilder, emit: Callable[[dict], Awaitable[None]] | None = None):
        self.builder, self.emit = builder, emit
        self.node = builder.config.initial_node
        self.trace = [self.node]
        self.transcript: list[dict] = []
        self.ended = False
        self.error = None
        self.responses = asyncio.Queue()
        self.text = ''
        self.settle_task = None
        self.sequence = 0
        self.calls = 0
        self.request_lock = asyncio.Lock()

    async def start(self):
        llm = OpenAILLMService(api_key=os.environ['OPENAI_API_KEY'],
                              settings=OpenAILLMService.Settings(model=self.builder.config.model, max_tokens=3000 if self.builder.tools else 600))
        self.pair = LLMContextAggregatorPair(LLMContext())
        owner = self
        class Capture(FrameProcessor):
            async def process_frame(self, frame, direction):
                await super().process_frame(frame, direction)
                if isinstance(frame, ErrorFrame):
                    owner.error = frame.error
                    owner.responses.put_nowait('')
                if isinstance(frame, LLMFullResponseStartFrame):
                    owner.calls += 1
                    if owner.calls > 12:
                        owner.error = 'Tool continuation limit exceeded.'
                        owner.responses.put_nowait('')
                        await owner.worker.cancel()
                        return
                if isinstance(frame, (LLMTextFrame, TTSSpeakFrame)):
                    owner.text += frame.text
                await self.push_frame(frame, direction)
                current = owner.manager.current_node
                if current and current != owner.node:
                    previous, owner.node = owner.node, current
                    owner.trace.append(current)
                    if owner.emit:
                        await owner.emit({'type':'node_entered','node':current,'previous':previous})
                if isinstance(frame, (LLMFullResponseStartFrame, LLMFullResponseEndFrame, LLMTextFrame, FunctionCallInProgressFrame, FunctionCallResultFrame)):
                    owner.sequence += 1
                    if owner.settle_task:
                        owner.settle_task.cancel()
                    if isinstance(frame, (LLMFullResponseEndFrame, FunctionCallResultFrame)):
                        owner.settle_task = asyncio.create_task(owner._settle(owner.sequence))
        self.worker = PipelineWorker(Pipeline([self.pair.user(),llm,Capture(),self.pair.assistant()]),
                                     enable_rtvi=False,idle_timeout_secs=None)
        self.manager = FlowManager(llm=llm,context_aggregator=self.pair,worker=self.worker)
        @self.worker.event_handler('on_pipeline_started')
        async def started(worker,frame):
            await self.manager.initialize(self.builder.build_initial_node())
            if self.emit:
                await self.emit({'type':'node_entered','node':self.node,'previous':None})
        @self.worker.event_handler('on_pipeline_error')
        async def error(worker,frame):
            self.error = frame.error
            await self.responses.put('')
        @self.worker.event_handler('on_pipeline_finished')
        async def finished(worker,frame):
            self.ended = True
            if self.text:
                await self.responses.put(self.text)
                self.text = ''
        runner = WorkerRunner(handle_sigint=False)
        await runner.add_workers(self.worker)
        self.task = asyncio.create_task(runner.run())
        return await self._response()

    async def _settle(self, sequence):
        await asyncio.sleep(0.15)
        while self.pair.assistant().has_function_calls_in_progress:
            await asyncio.sleep(0.05)
        if sequence == self.sequence and self.text:
            text, self.text = self.text, ''
            await self.responses.put(text)

    async def _response(self):
        text = await self.responses.get()
        if self.error:
            raise RuntimeError(self.error)
        if text:
            turn = {'role':'assistant','text':text,'node':self.node}
            self.transcript.append(turn)
            if self.emit:
                await self.emit({'type':'turn','turn':turn})
        return text or ''

    async def send(self, text):
        async with self.request_lock:
            if self.ended:
                return ''
            self.calls = 0
            turn = {'role':'user','text':text,'node':self.node}
            self.transcript.append(turn)
            if self.emit:
                await self.emit({'type':'turn','turn':turn})
            await self.worker.queue_frames([LLMMessagesAppendFrame(messages=[{'role':'user','content':text}],run_llm=True)])
            return await self._response()

    async def close(self):
        if self.settle_task:
            self.settle_task.cancel()
        if hasattr(self,'task') and not self.task.done():
            await self.worker.cancel()
            await asyncio.wait_for(self.task,10)
