import React from 'react';
import { Event } from '../types';
import { getEventTokens } from '../utils/events';

interface Props {
  events: Event[];
}

export const TokenBreakdown = ({ events }: Props) => {
  const total = events.reduce((acc, e) => {
    const { modelTokens, toolTokens, thinkingTokens } = getEventTokens(e);
    acc.model_read += modelTokens.read;
    acc.model_output += modelTokens.write;
    acc.model_cache += modelTokens.cache;
    acc.tool_input += toolTokens.input;
    acc.tool_output += toolTokens.output;
    acc.thinking_input += thinkingTokens.input;
    acc.thinking_output += thinkingTokens.output;
    acc.tools += e.tokens.tools;
    acc.cache_creation += e.tokens.cache_creation;
    return acc;
  }, {
    model_read: 0, model_output: 0, model_cache: 0,
    tool_input: 0, tool_output: 0,
    thinking_input: 0, thinking_output: 0,
    tools: 0, cache_creation: 0,
  });

  const max = Math.max(
    total.model_read, total.model_output, total.model_cache,
    total.tool_input, total.tool_output,
    total.thinking_input, total.thinking_output,
    total.tools, 1,
  );

  const rows = [
    { label: 'Model Read', val: total.model_read },
    { label: 'Model Cache', val: total.model_cache },
    { label: 'Model Write', val: total.model_output },
    { label: 'Tool In', val: total.tool_input },
    { label: 'Tool Out', val: total.tool_output },
    { label: 'Thinking In', val: total.thinking_input },
    { label: 'Thinking Out', val: total.thinking_output },
    { label: 'Tools', val: total.tools },
  ];

  return (
    <div className="p-4 bg-blue-600 rounded-2xl text-white shadow-lg shadow-blue-100">
      <div className="flex items-center gap-2 text-xs font-bold mb-4 opacity-80 uppercase tracking-widest">
        Token Breakdown
      </div>
      <div className="space-y-4">
        {rows.map(row => (
          <div key={row.label}>
            <div className="flex justify-between text-[11px] mb-1 font-medium">
              <span>{row.label}</span>
              <span>{row.val.toLocaleString()}</span>
            </div>
            <div className="h-1.5 w-full bg-black/10 rounded-full overflow-hidden">
              <div
                className="h-full bg-white transition-all duration-1000"
                style={{ width: `${(row.val / max) * 100}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
