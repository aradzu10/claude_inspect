import React from 'react';
import { Bot, Settings, Terminal, User } from 'lucide-react';
import { Event } from '../types';
import { getEventSummary } from '../utils/events';
import { useSession } from '../context/SessionContext';

interface Props {
  task: Event;
}

export const HeavyTaskItem = ({ task }: Props) => {
  const { messageRefs } = useSession();
  const isAssistant = task.role_type === 'assistant';
  const isUser = task.role_type === 'user';
  const isTool = task.role_type === 'tool';

  const scrollToMessage = (uuid: string) => {
    const el = messageRefs.current[uuid];
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      el.classList.add('bg-blue-50');
      setTimeout(() => el.classList.remove('bg-blue-50'), 2000);
    }
  };

  const getIcon = () => {
    if (isAssistant) return <Bot size={12} className="text-blue-500" />;
    if (isUser) return <User size={12} className="text-gray-600" />;
    if (isTool) return <Terminal size={12} className="text-green-500" />;
    return <Settings size={12} className="text-gray-400" />;
  };

  const getColors = () => {
    if (isAssistant) return 'border-blue-100 bg-blue-50/10 hover:border-blue-300';
    if (isTool) return 'border-green-100 bg-green-50/10 hover:border-green-300';
    return 'border-gray-100 bg-white hover:border-gray-300';
  };

  const heavyScore = task.heavy_tokens_total ?? task.total_tokens;

  return (
    <div
      onClick={() => scrollToMessage(task.uuid)}
      className={`p-3 border rounded-xl shadow-sm transition-all cursor-pointer group ${getColors()}`}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          {getIcon()}
          <span className="text-[10px] font-bold text-gray-400 uppercase tracking-tight">{task.role_type}</span>
        </div>
        <span className="text-xs font-bold text-blue-600 group-hover:scale-110 transition-transform">
          {heavyScore.toLocaleString()}
        </span>
      </div>
      <div className="text-[11px] text-gray-600 line-clamp-2 leading-tight font-medium">
        {getEventSummary(task)}
      </div>
    </div>
  );
};
