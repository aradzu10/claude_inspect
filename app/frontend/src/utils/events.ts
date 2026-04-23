import { Event } from '../types';
import { get_content_text } from './content';
import { trimText } from './text';

export const getEventSummary = (event: Event): string => {
  if (event.role_type === 'assistant') {
    const content = event.message?.content;
    const parts = Array.isArray(content) ? content : (content ? [content] : []);
    const tool = parts.find((p: any) => p.type === 'tool_use');
    if (tool) {
      const toolName = tool.name || 'Unknown';
      const description = typeof tool.input?.description === 'string' ? tool.input.description : '';
      if (String(toolName).toLowerCase() === 'agent') {
        if (description) {
          return `Tool: Agent - ${trimText(description, 90)}`;
        }
        return `Tool: Agent`;
      }
      if (description) {
        return `Tool: ${toolName} — ${trimText(description, 90)}`;
      }
      return `Tool: ${toolName}`;
    }
    const text = parts.find((p: any) => p.type === 'text')?.text;
    return text || 'Assistant Message';
  }
  if (event.role_type === 'tool') {
    const content = event.message?.content;
    const parts = Array.isArray(content) ? content : (content ? [content] : []);
    const result = parts.find((p: any) => p.type === 'tool_result');
    if (result && result.tool_use_id) return `Result: ${result.tool_use_id.split('_')[0]}`;
    return 'Tool Result';
  }
  if (event.role_type === 'system') {
    if (event.attachment?.type === 'file') return `System: File ${event.attachment.filename}`;
    return 'System Message';
  }
  return get_content_text(event.message?.content || event.attachment || '');
};

export const getEventTokens = (event: Event) => {
  const modelTokens = event.model_tokens || {
    read: event.tokens.input,
    cache: event.tokens.cache_read,
    write: event.tokens.output,
  };
  const toolTokens = event.tool_tokens || { input: 0, output: 0 };
  const thinkingTokens = event.thinking_tokens || { input: 0, output: event.tokens.thinking || 0 };
  return { modelTokens, toolTokens, thinkingTokens };
};

export const isCompactionBoundary = (event: Event): boolean => {
  return Boolean(
    event.is_compaction_boundary
    || (event.role_type === 'system'
      && typeof event.content === 'string'
      && event.content.includes('Conversation compacted'))
  );
};
