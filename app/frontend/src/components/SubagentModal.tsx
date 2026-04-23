import React from 'react';
import { Activity, X } from 'lucide-react';
import { useSession } from '../context/SessionContext';
import { EventView, SubagentLoadingIndicator } from './EventView';

interface Props {
  agentId: string;
  onClose: () => void;
}

export const SubagentModal = ({ agentId, onClose }: Props) => {
  const { subagentLogs } = useSession();
  const logs = subagentLogs[agentId];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-end bg-black/40 backdrop-blur-md" onClick={onClose}>
      <div
        className="w-[900px] h-full bg-white shadow-2xl flex flex-col animate-in slide-in-from-right duration-300"
        onClick={e => e.stopPropagation()}
      >
        <div className="h-16 border-b border-gray-100 px-6 flex items-center justify-between shrink-0 bg-gray-50/50">
          <div className="flex items-center gap-3">
            <div className="bg-blue-600 p-1.5 rounded-lg shadow-sm shadow-blue-200">
              <Activity size={18} className="text-white" />
            </div>
            <div>
              <h2 className="font-bold text-gray-900">Sub-agent Conversation</h2>
              <p className="text-[10px] text-gray-500 font-mono tracking-tighter">{agentId}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-200 rounded-full transition-colors text-gray-500"
          >
            <X size={20} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-12 bg-white">
          <div className="max-w-3xl mx-auto">
            {logs ? (
              logs.map(e => <EventView key={e.uuid || Math.random().toString()} event={e} isNested />)
            ) : (
              <SubagentLoadingIndicator />
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
