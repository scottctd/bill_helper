from __future__ import annotations

from datetime import date

from scripts.render_agent_system_prompt_snapshot import (
    SNAPSHOT_OMITTED,
    _build_snapshot_markdown,
    _load_render_inputs,
    _replace_agent_memory_body,
    _render_snapshot_system_prompt,
)


def test_replace_agent_memory_body_uses_omitted_placeholder() -> None:
    rendered = (
        "### Account Context\n"
        f"{SNAPSHOT_OMITTED}\n\n"
        "### Agent Memory\n"
        "Treat the following as persistent user-provided background and preferences.\n"
        "Follow it when it does not conflict with the rules above.\n"
        "- Prefers terse answers.\n"
    )
    normalized = _replace_agent_memory_body(rendered)
    assert normalized.endswith(
        "### Agent Memory\n"
        "Treat the following as persistent user-provided background and preferences.\n"
        "Follow it when it does not conflict with the rules above.\n"
        f"{SNAPSHOT_OMITTED}\n"
    )


def test_render_snapshot_system_prompt_omits_db_derived_sections() -> None:
    rendered = _render_snapshot_system_prompt(
        current_date=date(2026, 5, 31),
        timezone_name="America/Toronto",
        response_surface="app",
    )
    assert "### Entity Category Reference" in rendered
    assert "### Account Context\n<omitted>" in rendered
    assert "- merchant:" not in rendered
    assert "Scotiabank" not in rendered
    assert "### Agent Memory" in rendered
    assert "Prefers terse answers." not in rendered
    assert rendered.count(SNAPSHOT_OMITTED) == 3
    assert rendered.rstrip().endswith("<omitted>")


def test_build_snapshot_markdown_documents_omitted_db_sections() -> None:
    inputs = _load_render_inputs(
        current_date=date(2026, 5, 31),
        timezone_name="America/Toronto",
        response_surface="app",
    )
    markdown = _build_snapshot_markdown(inputs)
    assert "selected user:" not in markdown
    assert "entity category context: placeholder `<omitted>`" in markdown
    assert "account context: placeholder `<omitted>`" in markdown
    assert "agent memory: placeholder `<omitted>`" in markdown
    assert "local database state" not in markdown
