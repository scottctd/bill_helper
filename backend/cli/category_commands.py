"""Entry-category CRUD commands for the `bh` CLI.

CALLING SPEC:
    add_entry_categories_parser(subparsers, add_format_option) -> None

Inputs:
    - argparse parser collection plus authenticated CLI context
Outputs:
    - entry-category list/detail/mutation payloads
Side effects:
    - performs HTTP calls to the entry-category taxonomy API
"""

from __future__ import annotations

import argparse
from typing import Any

from pydantic import ValidationError

from backend.cli.support import CliContext, CliError, request_json
from backend.schemas_finance import TaxonomyTermCreate, TaxonomyTermUpdate


_TAXONOMY_PATH = "/taxonomies/entry_category/terms"
_LIFECYCLE_CHOICES = ("fixed", "day_to_day", "one_time")


def add_entry_categories_parser(subparsers, add_format_option) -> None:
    parser = subparsers.add_parser(
        "entry-categories",
        help="Read and directly manage entry-category taxonomy terms.",
    )
    parser.set_defaults(help_parser=parser)
    commands = parser.add_subparsers(dest="entry_categories_command")

    list_parser = commands.add_parser("list", help="List entry categories.")
    add_format_option(list_parser)
    list_parser.set_defaults(handler=_handle_list, render_key="entry_categories_list")

    get_parser = commands.add_parser("get", help="Get one entry category.")
    add_format_option(get_parser)
    get_parser.add_argument("category_ref")
    get_parser.set_defaults(handler=_handle_get, render_key="entry_categories_detail")

    create_parser = commands.add_parser("create", help="Create an entry category.")
    add_format_option(create_parser)
    create_parser.add_argument("name")
    create_parser.add_argument("--parent", default=None, help="Parent name, path, full id, or unique id prefix.")
    create_parser.add_argument("--description", default=None)
    create_parser.add_argument("--default-lifecycle", choices=_LIFECYCLE_CHOICES, default=None)
    create_parser.set_defaults(handler=_handle_create, render_key="entry_categories_detail")

    update_parser = commands.add_parser("update", help="Update an entry category.")
    add_format_option(update_parser)
    update_parser.add_argument("category_ref")
    update_parser.add_argument("--name", default=None)
    description_group = update_parser.add_mutually_exclusive_group()
    description_group.add_argument("--description", default=None)
    description_group.add_argument("--clear-description", action="store_true")
    lifecycle_group = update_parser.add_mutually_exclusive_group()
    lifecycle_group.add_argument("--default-lifecycle", choices=_LIFECYCLE_CHOICES, default=None)
    lifecycle_group.add_argument("--clear-default-lifecycle", action="store_true")
    update_parser.set_defaults(handler=_handle_update, render_key="entry_categories_detail")

    remove_parser = commands.add_parser("remove", help="Delete an entry category.")
    add_format_option(remove_parser)
    remove_parser.add_argument("category_ref")
    remove_parser.set_defaults(handler=_handle_remove, render_key="entry_categories_mutation")


def _list_terms(context: CliContext) -> list[dict[str, Any]]:
    _, payload = request_json(context, "GET", _TAXONOMY_PATH)
    if not isinstance(payload, list):
        raise CliError("Entry-category response was not a list.")
    terms = [dict(item) for item in payload if isinstance(item, dict)]
    return _with_paths(terms)


def _with_paths(terms: list[dict[str, Any]]) -> list[dict[str, Any]]:
    names_by_id = {str(term.get("id")): str(term.get("name") or "") for term in terms}
    with_paths = [
        {
            **term,
            "path": (
                f"{names_by_id.get(str(term.get('parent_term_id')), '-')}/{term.get('name')}"
                if term.get("parent_term_id")
                else term.get("name")
            ),
        }
        for term in terms
    ]
    return sorted(with_paths, key=lambda term: str(term.get("path") or ""))


def _resolve_term(terms: list[dict[str, Any]], category_ref: str) -> dict[str, Any]:
    normalized = category_ref.strip().lower()
    if not normalized:
        raise CliError("Missing entry-category reference.")
    exact = [
        term
        for term in terms
        if normalized
        in {
            str(term.get("id") or "").lower(),
            str(term.get("name") or "").lower(),
            str(term.get("normalized_name") or "").lower(),
            str(term.get("path") or "").lower(),
        }
    ]
    if len(exact) == 1:
        return exact[0]
    prefix = [term for term in terms if str(term.get("id") or "").lower().startswith(normalized)]
    matches = exact or prefix
    if not matches:
        raise CliError(f"Entry category '{category_ref}' not found.")
    if len(matches) > 1:
        labels = ", ".join(str(term.get("path") or term.get("name")) for term in matches[:5])
        raise CliError(f"Ambiguous entry-category reference '{category_ref}'. Matches: {labels}")
    return matches[0]


def _validate_payload(model_type, payload: dict[str, Any]) -> dict[str, Any]:
    try:
        return model_type.model_validate(payload).model_dump(mode="json", exclude_unset=True)
    except ValidationError as exc:
        details = "; ".join(
            f"{'.'.join(str(part) for part in error['loc'])}: {error['msg']}"
            for error in exc.errors(include_url=False)
        )
        raise CliError(f"Invalid entry-category arguments: {details}") from exc


def _handle_list(_args: argparse.Namespace, context: CliContext) -> Any:
    return _list_terms(context)


def _handle_get(args: argparse.Namespace, context: CliContext) -> Any:
    return _resolve_term(_list_terms(context), args.category_ref)


def _handle_create(args: argparse.Namespace, context: CliContext) -> Any:
    terms = _list_terms(context) if args.parent else []
    parent = _resolve_term(terms, args.parent) if args.parent else None
    if parent is not None and parent.get("parent_term_id") is not None:
        raise CliError("Entry categories support only one parent/child level.")
    body = _validate_payload(
        TaxonomyTermCreate,
        {
            "name": args.name,
            "description": args.description,
            "parent_term_id": parent.get("id") if parent else None,
            "default_lifecycle": args.default_lifecycle,
        },
    )
    _, payload = request_json(context, "POST", _TAXONOMY_PATH, json_body=body)
    result = dict(payload)
    result["path"] = f"{parent['name']}/{result.get('name')}" if parent else result.get("name")
    return result


def _handle_update(args: argparse.Namespace, context: CliContext) -> Any:
    terms = _list_terms(context)
    term = _resolve_term(terms, args.category_ref)
    body: dict[str, Any] = {}
    if args.name is not None:
        body["name"] = args.name
    if args.description is not None or args.clear_description:
        body["description"] = None if args.clear_description else args.description
    if args.default_lifecycle is not None or args.clear_default_lifecycle:
        body["default_lifecycle"] = None if args.clear_default_lifecycle else args.default_lifecycle
    if not body:
        raise CliError("Provide at least one update option.")
    validated = _validate_payload(TaxonomyTermUpdate, body)
    _, payload = request_json(
        context,
        "PATCH",
        f"{_TAXONOMY_PATH}/{term['id']}",
        json_body=validated,
    )
    result = dict(payload)
    parent = next((item for item in terms if item.get("id") == result.get("parent_term_id")), None)
    result["path"] = f"{parent['name']}/{result.get('name')}" if parent else result.get("name")
    return result


def _handle_remove(args: argparse.Namespace, context: CliContext) -> Any:
    term = _resolve_term(_list_terms(context), args.category_ref)
    _, payload = request_json(context, "DELETE", f"{_TAXONOMY_PATH}/{term['id']}")
    return {
        **(payload if isinstance(payload, dict) else {}),
        "deleted_id": term.get("id"),
        "deleted_path": term.get("path"),
    }
