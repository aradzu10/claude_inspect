import React, { MutableRefObject } from 'react';
import { AlertCircle, ArrowUpRight, Clock } from 'lucide-react';
import { Analysis, Event } from '../types';
import { EventView, isEventRenderable } from './EventView';
import { FrameComponent } from './FrameComponent';
import { HeavyTaskItem } from './HeavyTaskItem';
import { TokenBreakdown } from './TokenBreakdown';

interface Props {
  events: Event[];
  analysis: Analysis | null;
  loading: boolean;
  selectedSessionId: string;
  mainContentScrollRef: MutableRefObject<HTMLDivElement | null>;
}

const getHeavyTasks = (events: Event[], analysis: Analysis | null): Event[] => {
  const visibleEventIds = analysis
    ? new Set(analysis.frames.flatMap((frame) => frame.event_uuids))
    : null;
  return [...events]
    .filter(e => (e.heavy_tokens_total ?? e.total_tokens) > 0)
    .filter(e => visibleEventIds ? visibleEventIds.has(e.uuid) : true)
    .filter(isEventRenderable)
    .sort((a, b) => (b.heavy_tokens_total ?? b.total_tokens) - (a.heavy_tokens_total ?? a.total_tokens))
    .slice(0, 10);
};

const exportAnalysis = (analysis: Analysis, selectedSessionId: string) => {
  const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(analysis, null, 2));
  const downloadAnchorNode = document.createElement('a');
  downloadAnchorNode.setAttribute('href', dataStr);
  downloadAnchorNode.setAttribute('download', `analysis-${selectedSessionId}.json`);
  document.body.appendChild(downloadAnchorNode);
  downloadAnchorNode.click();
  downloadAnchorNode.remove();
};

export const SessionView = ({ events, analysis, loading, selectedSessionId, mainContentScrollRef }: Props) => {
  const heavyTasks = getHeavyTasks(events, analysis);

  return (
    <div className="flex-1 flex min-h-0">
      <div ref={mainContentScrollRef} className="flex-1 overflow-y-auto px-8 pb-12 scroll-smooth">
        <div className="max-w-4xl mx-auto pt-12">
          {loading ? (
            <div className="flex flex-col items-center justify-center h-64 text-gray-400 gap-4">
              <Clock size={32} className="animate-spin text-blue-500" />
              <div className="text-sm font-medium">Processing session logs...</div>
            </div>
          ) : analysis ? (
            analysis.frames.map((frame, idx) => (
              <FrameComponent key={idx} frame={frame} frameIndex={idx}>
                {frame.event_uuids.map(uuid => {
                  const event = events.find(e => e.uuid === uuid);
                  return event ? <EventView key={uuid} event={event} /> : null;
                })}
              </FrameComponent>
            ))
          ) : (
            events.map(e => <EventView key={e.uuid || Math.random().toString()} event={e} />)
          )}
        </div>
      </div>
      <aside className="w-80 border-l border-gray-100 p-6 overflow-y-auto bg-gray-50/30">
        <div className="space-y-8">
          <div>
            <div className="flex items-center gap-2 text-sm font-bold text-gray-900 mb-4 uppercase tracking-wider">
              <AlertCircle size={16} className="text-blue-600" /> Heavy Tasks
            </div>
            <div className="space-y-3">
              {heavyTasks.map(task => (
                <HeavyTaskItem key={task.uuid} task={task} />
              ))}
            </div>
          </div>

          <TokenBreakdown events={events} />

          {analysis && (
            <button
              onClick={() => exportAnalysis(analysis, selectedSessionId)}
              className="w-full py-3 bg-gray-900 hover:bg-black text-white rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all shadow-md active:scale-95"
            >
              <ArrowUpRight size={14} /> Export Framed Session
            </button>
          )}
        </div>
      </aside>
    </div>
  );
};
