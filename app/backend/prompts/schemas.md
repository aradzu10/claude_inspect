# Schemas

Four JSON file types flow through this system.

IDs (for frames, friction points, shared preamble actions, suggestions) are unique across the entire run. Friction point IDs and shared preamble action IDs share one namespace, so `addresses` lists can contain either kind of ID without a type tag.

## `session.json` — parser output (one per conversation)

One file per conversation. The main conversation gets its own file. Each sub-agent invocation gets its own file. Sub-agent invocations inside the main conversation appear in the main file as a single message with `role: sub_agent_invocation` — the parent only sees the input and the output summary, not the sub-agent's internal messages.

```json
{
  "conversation_id": "<unique id for this conversation>",
  "agent_type": "main | <sub-agent type name>",
  "messages": [
    {
      "idx": 0,
      "role": "system",
      "content": "<system prompt content>"
    },
    {
      "idx": 1,
      "role": "user",
      "content": "<user message>"
    },
    {
      "idx": 2,
      "role": "assistant",
      "content": "<assistant reply>",
      "tool_calls": [
        { "name": "<tool name>", "input": { "<param>": "<value>" }, "output": "<tool output text>" }
      ]
    },
    {
      "idx": 3,
      "role": "tool_result",
      "tool_call_id": "<call id>",
      "content": "<tool output>"
    },
    {
      "idx": 4,
      "role": "sub_agent_invocation",
      "agent_type": "<sub-agent type>",
      "conversation_id": "<sub-agent conversation id>",
      "description": "<sub-agent description>",
      "prompt": "<sub-agent prompt>",
      "output_summary": "<summary returned to parent>"
    }
  ]
}
```

Notes:
- `role` values: `system`, `user`, `assistant`, `tool_result`, `sub_agent_invocation`.
- Multiple `system` messages may appear at any position.
- Sub-agent invocations in the parent carry `description`, `prompt`, and `output_summary`.

## `conversation_analysis.json` — conversation analyzer output (one per conversation)

```json
{
  "conversation_id": "<id>",
  "agent_type": "<type>",
  "frames": [
    {
      "id": "<frame id>",
      "title": "<short description>",
      "goal": "<what this frame was trying to achieve>",
      "outcome": "success | partial | failed | abandoned",
      "message_range": [<start_idx>, <end_idx>],
      "health": "green | yellow | red",
      "friction_points": [
        {
          "id": "<friction point id>",
          "message_range": [<start_idx>, <end_idx>],
          "description": "<what happened in this sub-span>",
          "evidence_quote": "<quote from the messages in the range>"
        }
      ]
    }
  ],
  "suggestions": [
    {
      "id": "<suggestion id>",
      "category": "add | fix | refactor",
      "title": "<short description>",
      "addresses": ["<friction point id>"],
      "rationale": "<why this suggestion follows from the evidence>",
      "snippet": "<text to paste into a prompt, or a script/tool description>",
      "evidence": { "<key>": "<value>" },
      "token_estimation_save": <integer>
    }
  ]
}
```

`evidence` keys by `category`:

- `add`:
  - `searched_prompt_for` — list of terms searched in `system` messages
  - `found_in_prompt` — boolean
- `fix`:
  - `existing_instruction` — quoted instruction from a `system` message
  - `why_ignored_hypothesis` — one-sentence explanation
  - `proposed_rewrite` — revised instruction text
- `refactor`:
  - `evidence` may be omitted; the rationale carries the reasoning

## `subagent_analysis.json` — sub-agent analyzer output (one per agent type)

```json
{
  "agent_type": "<sub-agent type>",
  "inferred_purpose": "<one sentence describing what this sub-agent exists to do>",
  "invocation_count": <integer>,
  "conversation_ids": ["<id>", "<id>"],
  "shared_preamble_actions": [
    {
      "id": "<shared preamble action id>",
      "action": "<description of the repeated action>",
      "appeared_in": [
        { "conversation_id": "<id>", "message_range": [<start_idx>, <end_idx>] }
      ],
      "category": "environment | project_context | convention",
      "orthogonality_rationale": "<why the information this action produces is stable across invocations>"
    }
  ],
  "suggestions": [
    {
      "id": "<suggestion id>",
      "category": "add | fix | refactor",
      "title": "<short description>",
      "addresses": ["<shared preamble action id>"],
      "rationale": "<why this suggestion follows from the evidence>",
      "snippet": "<text to paste into a prompt, or a script/tool description>",
      "token_estimation_save": <integer>
    }
  ]
}
```

## `analysis.json` — finalizer output (one per run)

```json
{
  "conversations": [
    { "conversation_id": "<id>", "agent_type": "<type>", "frames": [/* ... */], "suggestions": [/* ... */] }
  ],
  "sub_agent_analyses": [
    { "agent_type": "<type>" }
  ],
  "suggestions": [
    {
      "id": "<suggestion id>",
      "category": "add | fix | refactor",
      "title": "<short description>",
      "addresses": ["<id>", "<id>"],
      "rationale": "<combined rationale>",
      "snippet": "<combined snippet>",
      "evidence": { "<key>": "<value>" },
      "estimated_tokens_saved": <integer>,
      "merged_from": ["<input suggestion id>"]
    }
  ]
}
```

Notes:
- `addresses` IDs resolve to a friction point (in some entry of `conversations[]`) or a shared preamble action (in some entry of `sub_agent_analyses[]`).
- `merged_from` appears only when the finalizer combined multiple input suggestions.
- `estimated_tokens_saved` is the sum of the `token_estimation_save` values from the merged input suggestions.
- `token_estimation_save` is added by the driver code after analyzer outputs are written, before finalizer runs.
