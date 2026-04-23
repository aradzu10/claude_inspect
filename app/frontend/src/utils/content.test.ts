import { describe, expect, it } from 'vitest';
import { get_content_text } from './content';

describe('get_content_text', () => {
  it('returns strings as-is', () => {
    expect(get_content_text('hello')).toBe('hello');
  });

  it('joins string arrays with spaces', () => {
    expect(get_content_text(['a', 'b', 'c'])).toBe('a b c');
  });

  it('extracts text from text parts', () => {
    expect(get_content_text([{ type: 'text', text: 'hi' }, { type: 'text', text: 'there' }])).toBe('hi there');
  });

  it('extracts thinking strings from thinking parts', () => {
    expect(get_content_text([{ type: 'thinking', thinking: 'pondering' }])).toBe('pondering');
  });

  it('labels tool_use parts with the tool name', () => {
    expect(get_content_text([{ type: 'tool_use', name: 'Bash' }])).toBe('Tool Call: Bash');
  });

  it('recursively extracts text from tool_result parts', () => {
    expect(get_content_text([{ type: 'tool_result', content: [{ type: 'text', text: 'result-text' }] }]))
      .toBe('result-text');
  });

  it('describes file objects by their display path', () => {
    expect(get_content_text({ type: 'file', displayPath: 'path/to/x.ts' })).toBe('File: path/to/x.ts');
  });

  it('falls back to filename when displayPath is missing', () => {
    expect(get_content_text({ type: 'file', filename: 'x.ts' })).toBe('File: x.ts');
  });

  it('JSON-stringifies unknown objects', () => {
    expect(get_content_text({ foo: 'bar' })).toBe('{"foo":"bar"}');
  });

  it('returns empty string for null/undefined', () => {
    expect(get_content_text(null)).toBe('');
    expect(get_content_text(undefined)).toBe('');
  });
});
