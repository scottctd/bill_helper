# Email Agent Interface

## Status

- Proposed
- Design converged
- Implementation-ready after the agent backend exposes steering

## Summary

Add email as a first-class conversational transport for Bill Helper.

The complete interaction stays inside email:

- one email conversation maps to one Bill Helper agent thread
- an allowlisted user starts a thread by emailing the Bill Helper intake address
- replies continue or steer that thread
- attachments and forwarded email content become agent input
- after finishing work, the agent emails its response and the complete list of proposals needing review
- a reply containing only `approve` approves all currently pending proposals represented by the latest review-summary email
- any other reply is normal user input for the agent
- approval results, including per-item failures, are emailed back to the user

There is no temporary review website, approval link, or email-specific proposal lifecycle. The
transport uses the existing agent thread, run, proposal, review, and fault-isolated batch approval
behavior.

## Relationship To Automatic Email Ingestion

This task is separate from `tasks/2026_03_13-email_ingestion.md`.

- This task adds an interactive email transport. The user deliberately emails or replies to Bill
  Helper and receives agent responses by email.
- The automatic email-ingestion task connects Gmail and Outlook accounts, scans mailboxes, and
  creates import candidates without requiring the user to send a message to the agent.

The two features may later share MIME parsing, attachment handling, normalized email models, and
provider adapters, but they must remain separate workflows.

## Goals

- Make Bill Helper usable from the user's existing email clients on iOS, desktop, and web.
- Treat an email conversation as a durable agent conversation.
- Support text, forwarded content, images, PDFs, and other attachment types already accepted by the
  agent API.
- Return complete, readable agent responses and proposal summaries by email.
- Allow explicit all-pending approval with an exact `approve` reply.
- Preserve the existing review gate: the agent may create proposals but cannot approve them.
- Support multiple concurrent email conversations without mixing their agent threads or approvals.
- Use future agent steering when a reply arrives while the conversation's run is active.

## Non-Goals

- No email review website or approval links.
- No per-item email buttons or structured email forms.
- No natural-language approval.
- No attempt to approve from phrases such as `looks good`, `yes`, or `go ahead`.
- No new proposal statuses or email-specific proposal lifecycle.
- No atomic all-or-nothing batch approval.
- No automatic mailbox scanning or connected-account synchronization.
- No broad malicious-content or prompt-injection defense in the first implementation.
- No replacement for the existing web UI as the detailed ledger and recovery surface.

## Locked Decisions

1. One email conversation maps to one Bill Helper agent thread.
2. Only allowlisted sender addresses may start or continue conversations.
3. Standard email reply headers plus an opaque reply token identify the conversation.
4. The user-facing sender remains a friendly Bill Helper address.
5. A normal reply is agent input and never approves proposals.
6. The only email approval command is a newly written body containing exactly `approve` after
   normalization.
7. `approve` applies only to the latest review-summary email in that conversation.
8. Approval uses the existing fault-isolated batch approval behavior. Successful items remain
   applied when other items fail.
9. The agent cannot approve proposals.
10. After every completed agent run, the transport sends a complete current proposal summary rather
    than an incremental diff.
11. Replies received during an active run steer that run once steering is supported.

## User Experience

### Start A Conversation

The user sends or forwards an email to:

```text
Bill Helper <assistant@example.com>
```

If the sender is allowlisted, Bill Helper:

1. creates a new agent thread
2. converts the newly written email body, forwarded content, and supported attachments into a user
   message
3. starts an agent run
4. sends the completed agent response as an email reply

Each new top-level email starts a separate agent thread.

### Continue Or Modify

Any reply whose newly written body is not exactly `approve` is normal user input.

Examples:

```text
Use the existing Groceries tag for the Costco entry.
```

```text
Reject the Netflix proposal. It was reimbursed by work.
```

```text
The second attachment belongs to a different transaction.
```

If no run is active, the reply starts a new run in the mapped agent thread. If a run is active, the
reply steers the current work when steering is available.

The reply itself does not mutate review state or approve anything. Proposal behavior remains owned
by the existing agent tools and review services.

### Receive A Review Summary

After an agent run finishes, the reply email contains:

- the agent's terminal response
- a complete list of currently pending proposals relevant to the conversation
- enough detail to understand each proposal without opening another interface
- a clear instruction to reply with only `approve` to approve all listed pending proposals
- a clear instruction to reply normally to request corrections or reject specific proposals

Example:

```text
I prepared 3 proposals:

1. Create expense: Costco, CAD 84.20, 2026-06-06, Groceries
2. Create expense: Netflix, CAD 22.59, 2026-06-05, Entertainment
3. Add tag: recurring

Reply with only:

approve

to approve all pending proposals listed above. Reply with normal instructions to make changes.
```

### Approve

An approval reply is accepted only when all of these are true:

- the sender is allowlisted
- the message maps to a known Bill Helper email conversation
- the newly written body normalizes exactly to `approve`
- the reply references the latest review-summary email for the conversation
- no agent run is active for the conversation
- the referenced summary still has pending proposals to approve

The approval command calls the existing fault-isolated batch approval workflow for the pending
proposal identifiers represented by that summary.

After approval, Bill Helper sends a result email containing:

- successfully approved and applied items
- failed items
- the reason for each failure
- instructions to reply normally if the agent should fix failed items and prepare them for another
  approval attempt

Partial success is expected and accepted. Successfully applied proposals are not rolled back solely
because another proposal failed.

Repeated delivery of the same approval email must be idempotent and must not apply an item twice.

### Approval Failure Recovery

If some proposals fail, the user replies naturally, for example:

```text
Fix the failed Costco proposal by using the existing Groceries tag.
```

That reply starts or steers agent work. After the agent finishes, Bill Helper sends a new complete
review summary. The user may then reply with `approve` again.

## Conversation And Message Identity

### Visible Addresses

Keep the visible sender friendly:

```text
From: Bill Helper <assistant@example.com>
```

Use an opaque per-conversation reply address:

```text
Reply-To: Bill Helper <reply+7Hk92x@example.com>
```

Normal email clients primarily display the friendly name, so the tokenized address should not
create meaningful UX clutter.

### Identity Rules

- The opaque reply token is the authoritative mapping to the Bill Helper agent thread.
- `Message-ID`, `In-Reply-To`, and `References` identify message relationships and the exact review
  summary being answered.
- Subjects are presentation only and must not be authoritative identifiers.
- Tokens must be random, opaque, stored hashed, and must not expose database identifiers.
- A single agent thread may have many inbound messages, outbound messages, and agent runs.
- Provider event identifiers and internet `Message-ID` values must be deduplicated.

These rules allow several email conversations to be active without mixing messages or approvals.

## Inbound Message Classification

For each accepted inbound email:

1. verify the provider webhook or delivery source
2. resolve and verify the allowlisted sender
3. deduplicate the provider event and email `Message-ID`
4. resolve an existing conversation or create a new one
5. extract the newly written body separately from quoted history and signatures
6. classify the message as exact `approve` or normal agent input
7. route it to batch approval, a new run, or active-run steering

Approval normalization may:

- trim surrounding whitespace
- compare case-insensitively
- ignore the quoted prior conversation and common automatically appended signature content

Approval normalization must not:

- accept `approve` when other newly written words are present
- accept attachments with an approval command
- infer approval from natural language

When approval classification is uncertain, treat the email as normal agent input rather than
approval.

## Agent Execution And Steering

The target behavior depends on agent steering:

- a reply received with no active run starts a new run in the mapped agent thread
- a reply received during an active run becomes a new user message and steers the current work
- the transport sends a response email only after the resulting work reaches a terminal state
- each terminal response includes the complete current review summary

Until steering exists, an initial implementation may queue replies received during an active run.
It must not start concurrent runs for the same email conversation.

Email is asynchronous, so the transport does not attempt to reproduce token-by-token streaming.
Operational status updates should only be sent when they are actionable, such as a terminal failure
that requires another user reply.

## Review Semantics

The email transport must use existing review behavior:

- proposals remain review-gated
- the agent cannot approve proposals
- natural-language replies do not approve proposals
- batch approval is fault-isolated and may partially succeed
- failed proposals and reasons are returned to the user
- the user may ask the agent to fix failures and approve again later

The email transport must not add proposal statuses, reinterpret proposal statuses, or make proposal
state depend on email-delivery state.

The latest review-summary message is email transport state, not proposal state. An `approve` reply
to an older summary is rejected, and Bill Helper responds with the latest complete review summary.

## Proposed Transport State

Keep email transport persistence separate from agent and proposal persistence.

### `email_conversations`

- `id`
- `owner_user_id`
- `agent_thread_id`
- `reply_token_hash`
- `created_at`
- `updated_at`

### `email_messages`

- `id`
- `conversation_id`
- `direction`
- `provider_event_id` nullable
- `internet_message_id`
- `in_reply_to_message_id` nullable
- `agent_run_id` nullable
- `message_kind`: `user_input | agent_response | review_summary | approval_command | approval_result`
- delivery status and timestamps

### Latest Review Summary

Store the latest review-summary email identifier for each conversation, either on
`email_conversations` or through a query over `email_messages`.

The review-summary message must retain the exact pending proposal identifiers it presented. This
allows an `approve` reply to approve that represented set without treating email state as proposal
state.

Request and configuration models must reject unknown fields unless a specific provider payload
adapter requires otherwise.

## Architecture Boundaries

Use a top-level `email/` transport package parallel to `telegram/`.

Recommended ownership:

```text
email/
├── config.py                 # transport configuration only
├── webhook.py                # provider webhook HTTP translation
├── provider.py               # provider-specific send/receive adapter
├── mime.py                   # deterministic MIME/body/attachment parsing
├── identity.py               # conversation and message identity resolution
├── approval_command.py       # exact approve-command classification
├── message_handler.py        # inbound message routing recipe
├── response_renderer.py      # agent and review-summary email rendering
├── state.py                  # email transport persistence
└── bill_helper_api.py        # thin backend/harness and review adapter
```

Rules:

- webhook modules own HTTP translation only
- provider adapters own provider payload and delivery translation
- deterministic MIME parsing, identity resolution, and command classification remain standalone
  tested helpers
- the message handler remains a slim recipe-style coordinator
- the agent harness owns execution and steering behavior
- review services own proposal approval and apply behavior
- the email transport owns email identity, routing, rendering, and delivery state only

Do not copy the Telegram transport wholesale. Promote genuinely shared backend-client behavior into
one canonical transport support module when implementing email.

## Configuration

Expected configuration includes:

- inbound email domain or address
- outbound sender address and friendly name
- provider API credentials
- provider webhook verification secret
- allowlisted sender addresses
- backend authentication configuration
- optional reply-token domain or routing prefix

The default must deny all inbound users until an allowlist is configured.

## Reliability

- Deduplicate inbound provider events and internet message IDs.
- Make outbound sends retryable and record delivery failures.
- Make approval command handling idempotent.
- Ignore or separately record bounces, delivery-status notifications, and automatic replies.
- Prevent concurrent runs for one email conversation.
- Preserve attachments and message-to-run links for auditability.
- Log failures with conversation, message, run, and provider context without logging sensitive email
  bodies or attachment contents.

## Security Boundary

V1 trusts allowlisted users as the source of instructions.

Minimum controls:

- verify inbound provider webhooks
- default-deny non-allowlisted senders
- validate the resolved sender before accepting input or approval
- keep reply tokens opaque and hashed
- never approve from an ambiguous message
- never allow the agent itself to invoke approval
- do not log credentials, email bodies, financial data, or attachment contents

Broader malicious-content and prompt-injection defenses are explicitly deferred.

## Implementation Order

1. Choose one inbound/outbound email provider and add provider webhook verification.
2. Add email transport state and deterministic conversation/message identity helpers.
3. Add allowlist enforcement, MIME parsing, attachment extraction, and deduplication.
4. Route new emails and normal replies into agent threads and runs.
5. Render and send terminal agent responses with complete proposal summaries.
6. Add exact `approve` classification and existing fault-isolated batch approval integration.
7. Send approval-result emails with successful and failed item details.
8. Integrate active-run steering when the harness exposes it; queue active-run replies until then.
9. Add retries, bounce handling, delivery-state visibility, and operational documentation.

## Verification

Add focused tests for:

- allowlisted and denied senders
- new email to new agent thread mapping
- reply to existing thread mapping
- multiple concurrent email conversations
- provider event and `Message-ID` deduplication
- body extraction with quoted history and signatures
- exact `approve` normalization
- near misses such as `approve please`, `yes`, and an approval email with attachments
- approval reply to the latest review summary
- rejection of approval replies to older summaries
- fault-isolated approval result rendering
- failed-item recovery through a normal user reply
- active-run reply queueing or steering
- outbound retry and idempotency behavior

Run the repository's backend and architecture verification gates when implementation begins.

## Acceptance Criteria

- An allowlisted user can start multiple independent agent conversations by email.
- Replies reliably continue the correct Bill Helper agent thread.
- Supported attachments reach the agent through the existing attachment flow.
- A completed agent run produces an email with its response and a complete current proposal summary.
- A reply containing only `approve` approves the pending proposals represented by the latest summary.
- Natural-language replies never approve proposals.
- Partial approval success is preserved and clearly reported by email.
- The user can reply naturally to ask the agent to fix failed proposals and later approve again.
- Replies during active work steer the run when steering is available, without concurrent runs in
  one conversation.
- No approval website, approval link, or email-specific proposal state is introduced.
