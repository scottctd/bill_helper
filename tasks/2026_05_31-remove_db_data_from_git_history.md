# Remove DB-Derived Data from Git History

## Status

- Proposed
- Interim mitigation landed in `1b4bfe5` (`feat(cli): add bh dashboard reads and omit DB data from prompt snapshot`)

## Priority

- High for privacy / repo hygiene if this repository is shared, published, or cloned outside a single trusted machine
- Lower urgency if the repo has never left local disk and no remotes contain the leaked commits

## Summary

Local database state has been committed into git-tracked generated docs, especially
`docs/features/system_prompt_example.md`. The snapshot renderer previously loaded real
account context, entity-category rows, and user-memory items from the developer's SQLite DB
and wrote them into a committed markdown file.

We fixed forward generation (`scripts/render_agent_system_prompt_snapshot.py` now emits
`<omitted>` placeholders and no longer reads the database), but **historical commits still
contain the leaked content** until the history is rewritten or the repo is replaced.

This task tracks identifying every leak, scrubbing git history, and adding guardrails so it
cannot recur.

## Known leak vector (confirmed)

| Source | Mechanism | Example leaked fields |
|--------|-----------|------------------------|
| `docs/features/system_prompt_example.md` | `render_agent_system_prompt_snapshot.py` called `build_current_user_context()` and `build_entity_category_context()` against the local DB | account names, account markdown notes, entity-category taxonomy rows, example user-memory bullets |
| `bill_helper.db` (if ever committed) | untracked/local DB file copied or force-added | full ledger, accounts, entries, agent threads |

Pre-mitigation snapshot content included strings like `Scotiabank Debit`, `Scotiabank Credit`,
and account-specific markdown notes under `### Account Context`.

## In-scope for history scrub

1. **`docs/features/system_prompt_example.md` across all commits**
   - Replace DB-derived sections with the current `<omitted>` placeholder shape, or drop the file from older commits if it did not exist yet.
2. **Any other generated docs that ever pulled from the local DB**
   - Audit commits touching `docs/features/system_prompt_example.md`, `docs/features/agent_billing_assistant.md` embedded cheat-sheet blocks (if ever rendered from DB-backed prompt state), and similar generated artifacts.
3. **`bill_helper.db` or other SQLite files**
   - Confirm with `git log --all -- bill_helper.db` and repo-wide blob search; purge if present.
4. **Accidental commits of `.env`, auth tokens, or workspace config with real credentials**
   - Out of scope for the original prompt leak, but include in the same history audit pass.

## Out of scope (intentional non-secrets)

These mention institution names by design and are **not** DB leaks:

- `scripts/seed_defaults.py`, benchmark fixtures, test literals (`Scotiabank` in tests)
- `scripts/bank_download/README.md` (Scotiabank automation docs)
- Synthetic/example data explicitly authored for tests or demos

Do not rewrite history solely to remove those unless a separate hygiene goal requires it.

## Interim mitigation (done)

- `scripts/render_agent_system_prompt_snapshot.py` no longer opens the database.
- Account context, entity category reference, and agent memory render as `<omitted>`.
- `backend/tests/test_render_agent_system_prompt_snapshot.py` asserts no DB-derived strings appear in regenerated output.

**This does not remove data already pushed or present in older commits.**

## Proposed work

### 1. Inventory leaks

```bash
# Commits that touched the prompt snapshot
git log --oneline -- docs/features/system_prompt_example.md

# Search history for known leak markers (extend list after first pass)
git log -S 'Scotiabank Debit' --oneline -- docs/features/system_prompt_example.md
git log -S 'notes_markdown:' --oneline -- docs/features/system_prompt_example.md
git log -S 'Prefers terse answers' --oneline -- docs/features/system_prompt_example.md

# DB files ever tracked
git log --all --oneline -- bill_helper.db '*.db' '*.sqlite' '*.sqlite3'
```

Record:
- first offending commit SHA
- whether `origin/main` (or other remotes) contain the leak
- list of unique sensitive strings to verify removal

### 2. Choose rewrite strategy

**Option A — `git filter-repo` (preferred)**

- Rewrite only affected paths (`docs/features/system_prompt_example.md`, any DB files).
- Replace file contents in historical commits with the sanitized placeholder version, or remove the path until it was intentionally introduced.

**Option B — BFG Repo-Cleaner**

- Useful if deleting specific files entirely (e.g. `bill_helper.db`) from all history.

**Option C — Fresh repo / orphan branch**

- Acceptable for a prototype with few collaborators: new root commit, no history carry-over.

Document the chosen approach and the exact commands in this task before execution.

### 3. Execute rewrite

- Take a full backup clone before rewriting.
- Rewrite locally; verify with searches above (should return no hits for sensitive markers).
- Force-push only after all collaborators agree (`git push --force-with-lease`).
- Invalidate old clone checkouts; everyone re-clones or hard-resets.

### 4. Post-rewrite verification

- [ ] `git log -S 'Scotiabank Debit' -- docs/features/system_prompt_example.md` returns nothing
- [ ] `git log --all -- bill_helper.db` returns nothing (or only sanitized commits if file must remain)
- [ ] Regenerate snapshot: `uv run python scripts/render_agent_system_prompt_snapshot.py`
- [ ] `uv run pytest backend/tests/test_render_agent_system_prompt_snapshot.py -q`
- [ ] `uv run python scripts/check_docs_sync.py`

### 5. Prevention (same work item or immediate follow-up)

- [ ] **Pre-commit / CI guard**: fail if `docs/features/system_prompt_example.md` contains patterns like `accounts_count:`, real-looking account note blocks, or lacks three `<omitted>` placeholders in the user-context section.
- [ ] **Ensure `bill_helper.db` stays ignored** — confirm `.gitignore` covers `*.db` / project DB paths; add if missing.
- [ ] **Document rule in `AGENTS.md` / `docs/documentation_system.md`**: generated docs must never embed local DB state; snapshot script is the canonical sanitizer.
- [ ] **Optional**: stop committing `system_prompt_example.md` entirely; publish it as a CI artifact instead (larger doc workflow change).

## Acceptance criteria

- No commit in `main` history contains developer-specific account names, account notes, or user-memory text sourced from a local DB inside tracked docs.
- No SQLite database files remain in git history unless explicitly required and sanitized.
- Regeneration pipeline and tests enforce placeholder output going forward.
- Collaborators (if any) have migrated to the rewritten history.

## Risks

- **History rewrite is destructive** for open PRs and local branches; coordinate before force-push.
- **Missed leak paths** if other scripts once wrote DB output into docs — the inventory step must be thorough.
- **GitHub/GitLab cache** may retain blobs briefly after force-push; treat rotated secrets as compromised if any were leaked.

## Related files

- `scripts/render_agent_system_prompt_snapshot.py`
- `docs/features/system_prompt_example.md`
- `backend/services/agent/user_context.py`
- `backend/services/agent/message_history_content.py` (`build_entity_category_context`)
- `backend/tests/test_render_agent_system_prompt_snapshot.py`
- `scripts/check_docs_sync.py`
- `AGENTS.md` (regeneration requirement for prompt snapshot)

## References

- Mitigation commit: `1b4bfe5`
- Completed related work: `tasks/completed/2026_03_15-system_prompt_refactor.md`
