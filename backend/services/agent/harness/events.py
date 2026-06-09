# CALLING SPEC:
# - Purpose: event sink protocol and fan-out for harness operational events.
# - Inputs: HarnessEvent instances from harness coordinator and step executor.
# - Outputs: published events to subscribers; CollectingEventSink for tests.
# - Side effects: subscriber-defined persistence or streaming.
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Protocol

from backend.services.agent.harness.contracts import HarnessEvent


class EventSink(Protocol):
    def publish(self, event: HarnessEvent) -> None: ...


@dataclass
class FanOutEventSink:
    sinks: list[EventSink]

    def publish(self, event: HarnessEvent) -> None:
        for sink in self.sinks:
            sink.publish(event)


@dataclass
class CollectingEventSink:
    events: list[HarnessEvent] = field(default_factory=list)

    def publish(self, event: HarnessEvent) -> None:
        self.events.append(event)


class NullEventSink:
    def publish(self, event: HarnessEvent) -> None:
        return None
