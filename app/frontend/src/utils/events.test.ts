import { describe, expect, it } from 'vitest';
import { getEventSummary, getEventTokens, isCompactionBoundary } from './events';
import { Event, TokenUsage } from '../types';

const zeroTokens: TokenUsage = {
  input: 0, output: 0, thinking: 0, tools: 0, cache_creation: 0, cache_read: 0,
};

const makeEvent = (overrides: Partial<Event> = {}): Event => ({
  uuid: 'u1',
  type: 'event',
  timestamp: '2024-01-01T00:00:00Z',
  role_type: 'assistant',
  tokens: { ...zeroTokens },
  total_tokens: 0,
  ...overrides,
});

describe('getEventSummary', () => {
  it('describes an assistant tool_use by tool name', () => {
    const event = makeEvent({
      message: { content: [{ type: 'tool_use', name: 'Bash', input: {} }] },
    });
    expect(getEventSummary(event)).toBe('Tool: Bash');
  });

  it('appends the description when the assistant tool call has one', () => {
    const event = makeEvent({
      message: { content: [{ type: 'tool_use', name: 'Bash', input: { description: 'list files' } }] },
    });
    expect(getEventSummary(event)).toBe('Tool: Bash — list files');
  });

  it('uses a special format for Agent tool calls', () => {
    const event = makeEvent({
      message: { content: [{ type: 'tool_use', name: 'Agent', input: { description: 'explore' } }] },
    });
    expect(getEventSummary(event)).toBe('Tool: Agent - explore');
  });

  it('falls back to text content when there is no tool call', () => {
    const event = makeEvent({
      message: { content: [{ type: 'text', text: 'hello world' }] },
    });
    expect(getEventSummary(event)).toBe('hello world');
  });

  it('returns "Assistant Message" when there is no text or tool', () => {
    const event = makeEvent({ message: { content: [] } });
    expect(getEventSummary(event)).toBe('Assistant Message');
  });

  it('returns a result identifier for tool events', () => {
    const event = makeEvent({
      role_type: 'tool',
      message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_01abcdef' }] },
    });
    expect(getEventSummary(event)).toBe('Result: toolu');
  });

  it('returns a generic label for tool events without an id', () => {
    const event = makeEvent({
      role_type: 'tool',
      message: { content: [] },
    });
    expect(getEventSummary(event)).toBe('Tool Result');
  });

  it('describes system file attachments', () => {
    const event = makeEvent({
      role_type: 'system',
      attachment: { type: 'file', filename: 'a.txt' },
    });
    expect(getEventSummary(event)).toBe('System: File a.txt');
  });
});

describe('getEventTokens', () => {
  it('uses explicit model_tokens when present', () => {
    const event = makeEvent({
      model_tokens: { read: 5, cache: 6, write: 7 },
      tool_tokens: { input: 1, output: 2 },
      thinking_tokens: { input: 3, output: 4 },
    });
    const t = getEventTokens(event);
    expect(t.modelTokens).toEqual({ read: 5, cache: 6, write: 7 });
    expect(t.toolTokens).toEqual({ input: 1, output: 2 });
    expect(t.thinkingTokens).toEqual({ input: 3, output: 4 });
  });

  it('falls back to legacy tokens fields', () => {
    const event = makeEvent({
      tokens: { ...zeroTokens, input: 10, output: 20, cache_read: 30, thinking: 40 },
    });
    const t = getEventTokens(event);
    expect(t.modelTokens).toEqual({ read: 10, cache: 30, write: 20 });
    expect(t.toolTokens).toEqual({ input: 0, output: 0 });
    expect(t.thinkingTokens).toEqual({ input: 0, output: 40 });
  });
});

describe('isCompactionBoundary', () => {
  it('returns true when the explicit flag is set', () => {
    expect(isCompactionBoundary(makeEvent({ is_compaction_boundary: true }))).toBe(true);
  });

  it('returns true for system messages containing the compaction marker', () => {
    const event = makeEvent({
      role_type: 'system',
      content: 'Conversation compacted due to context limit',
    });
    expect(isCompactionBoundary(event)).toBe(true);
  });

  it('returns false for normal events', () => {
    expect(isCompactionBoundary(makeEvent())).toBe(false);
  });

  it('returns false for non-system messages with compaction text', () => {
    expect(isCompactionBoundary(makeEvent({
      role_type: 'user',
      content: 'Conversation compacted',
    }))).toBe(false);
  });
});
