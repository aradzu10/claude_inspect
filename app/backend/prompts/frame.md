# Group a Conversation Into Tasks and Suggest Improvements

You read a chat log. You do two things:

1. **Group the messages into tasks.** A task is one specific thing being done.
2. **For each task, suggest how the user's prompts could have been better** to make that task go smoother - better results or less tokens.

## What you get

A list of messages in order. Each one looks like this:

```json
{ "uuid": "abc123", "role": "user", "text": "..." }
```

## Part 1: Group into tasks

A task is **one specific piece of work**. Not a whole project — one step.

If the user says "research this paper" and the assistant then:
- reads the paper → that's one task
- searches the web → that's another task
- runs code to check a formula → another task
- writes the summary → another task

Each is its own task because each is a different *thing being done*, even though they all serve the same big goal.

**Start a new task when the work itself changes.** For example:
- The assistant switches from reading to searching
- The user asks for something new
- The output being produced changes

**Stay in the same task when:**
- The same activity is still going (e.g. several search calls all hunting for the same fact)
- A tool call and the assistant's reading of its result belong together
- The user gives a small correction or follow-up that doesn't change what's being done

**When in doubt, split.** Smaller tasks are easier to reason about than big mixed ones.

## Part 2: Suggest improvements

For each task, look at:
- The messages in the task itself
- **All user messages that came before the task** (these set the context)

Then ask: **what could the user have written differently — earlier or during the task — to make this task work better?**

Examples of good suggestions:
- "The user could have specified the output format up front."
- "In the initial prompt, the user should have said which language to use."
- "The user could have given the file path instead of describing the file."
- "When asking the follow-up, the user could have been clearer about which section they meant."

A task can have zero, one, or several suggestions. If everything went fine, leave the list empty.

## What you give back

A JSON array. Just the JSON — no explanations, no code fences, nothing else.

```json
[
  {
    "title": "short name (3-8 words)",
    "objective": "one sentence: what this task is doing",
    "event_uuids": ["uuid1", "uuid2"],
    "suggestions": [
      "first suggestion to improve a user prompt",
      "second suggestion"
    ]
  }
]
```

## Rules you must follow

- Every uuid from the input shows up in exactly one task.
- Uuids stay in their original order.
- Tasks are listed in order too.
- A task's uuids must be next to each other in the original list (no skipping around).
- The output must be valid JSON.