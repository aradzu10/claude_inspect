import React, { useState } from 'react';
import { Activity, Bot } from 'lucide-react';
import { Frame } from '../types';
import { useSession } from '../context/SessionContext';

interface Props {
  frame: Frame;
  frameIndex: number;
  children: React.ReactNode;
}

export const FrameComponent = ({ frame, frameIndex, children }: Props) => {
  const { events, updateFrameSuggestion } = useSession();
  const [isSuggestionExpanded, setIsSuggestionExpanded] = useState(false);
  const [localSuggestion, setLocalSuggestion] = useState(frame.suggestion);

  const totalTokens = frame.event_uuids.reduce((acc, uuid) => {
    const event = events.find(e => e.uuid === uuid);
    return acc + (event?.total_tokens || 0);
  }, 0);

  return (
    <div className="mb-16 last:mb-0">
      <div className="sticky top-16 z-20 bg-white/95 backdrop-blur-sm py-4 border-b border-gray-100 flex items-center justify-between mb-8">
        <div className="flex-1">
          <h2 className="text-xl font-bold text-gray-900 flex items-center gap-3">
            <div className="bg-blue-600 text-white text-[10px] w-5 h-5 flex items-center justify-center rounded-md font-mono">
              {frameIndex + 1}
            </div>
            {frame.title}
            <span className="text-xs font-mono text-gray-400 font-normal">
              ({frame.event_uuids.length} events • {totalTokens.toLocaleString()} tokens)
            </span>
          </h2>
          <p className="text-sm text-gray-500 mt-1">{frame.objective}</p>
        </div>

        <button
          onClick={() => setIsSuggestionExpanded(!isSuggestionExpanded)}
          className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold transition-all ${
            isSuggestionExpanded
              ? 'bg-blue-50 text-blue-600'
              : 'bg-gray-50 text-gray-600 hover:bg-gray-100'
          }`}
        >
          <Activity size={14} />
          {isSuggestionExpanded ? 'Close Suggestions' : 'Token Suggestions'}
        </button>
      </div>

      {isSuggestionExpanded && (
        <div className="mb-8 p-6 bg-blue-50 rounded-2xl border border-blue-100 animate-in fade-in slide-in-from-top-4 duration-300">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-bold text-blue-900 flex items-center gap-2 italic">
              <Bot size={16} /> How to reduce tokens in this frame
            </h3>
            <span className="text-[10px] font-bold text-blue-400 uppercase tracking-widest">
              Editable Suggestion
            </span>
          </div>
          <textarea
            value={localSuggestion}
            onChange={(e) => {
              setLocalSuggestion(e.target.value);
              updateFrameSuggestion(frameIndex, e.target.value);
            }}
            className="w-full bg-white/50 border border-blue-200 rounded-xl p-4 text-sm text-blue-800 focus:outline-none focus:ring-2 focus:ring-blue-400/50 min-h-[100px] resize-y shadow-inner"
            placeholder="Enter suggestions here..."
          />
        </div>
      )}

      <div className="pl-8 border-l-2 border-gray-50">
        {children}
      </div>
    </div>
  );
};
