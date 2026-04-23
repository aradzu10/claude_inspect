export const get_content_text = (content: any): string => {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map(p => {
      if (typeof p === 'string') return p;
      if (p.text) return p.text;
      if (p.thinking) return p.thinking;
      if (p.type === 'tool_result') return get_content_text(p.content);
      if (p.type === 'tool_use') return `Tool Call: ${p.name}`;
      return JSON.stringify(p);
    }).join(' ');
  }
  if (typeof content === 'object' && content !== null) {
    if (content.type === 'file') return `File: ${content.displayPath || content.filename}`;
    if (content.type === 'tool_result') return get_content_text(content.content);
    return JSON.stringify(content);
  }
  return '';
};
