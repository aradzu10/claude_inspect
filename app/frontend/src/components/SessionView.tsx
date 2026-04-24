import React, { MutableRefObject, useEffect, useMemo, useState } from 'react';
import { AlertCircle, ArrowUpRight, Clock, GitBranch, ListTree } from 'lucide-react';
import { Analysis, AnalysisConversation, AnalysisFrictionPoint, AnalysisSuggestion, Event, FinalizedAnalysis } from '../types';
import { EventView, isEventRenderable } from './EventView';
import { FrameComponent } from './FrameComponent';
import { HeavyTaskItem } from './HeavyTaskItem';
import { TokenBreakdown } from './TokenBreakdown';
import { getAnalysisMode, isFinalizedAnalysis, isLegacyAnalysis } from '../utils/analysis';

interface Props {
  events: Event[];
  analysis: Analysis | null;
  loading: boolean;
  selectedSessionId: string;
  mainContentScrollRef: MutableRefObject<HTMLDivElement | null>;
}

const getHeavyTasks = (events: Event[], analysis: Analysis | null): Event[] => {
  const visibleEventIds = analysis && isLegacyAnalysis(analysis)
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
  const [activeTab, setActiveTab] = useState<'timeline' | 'analysis'>('timeline');
  const analysisMode = getAnalysisMode(analysis);
  const hasAnalysis = analysisMode !== 'none';

  useEffect(() => {
    setActiveTab('timeline');
  }, [selectedSessionId]);

  const timelineContent = useMemo(() => {
    if (loading) {
      return (
        <div className="flex flex-col items-center justify-center h-64 text-gray-400 gap-4">
          <Clock size={32} className="animate-spin text-blue-500" />
          <div className="text-sm font-medium">Processing session logs...</div>
        </div>
      );
    }

    if (analysis && isLegacyAnalysis(analysis)) {
      return analysis.frames.map((frame, idx) => (
        <FrameComponent key={idx} frame={frame} frameIndex={idx}>
          {frame.event_uuids.map(uuid => {
            const event = events.find(e => e.uuid === uuid);
            return event ? <EventView key={uuid} event={event} /> : null;
          })}
        </FrameComponent>
      ));
    }

    return events.map(e => <EventView key={e.uuid || Math.random().toString()} event={e} />);
  }, [analysis, events, loading]);

  return (
    <div className="flex-1 flex min-h-0">
      <div ref={mainContentScrollRef} className="flex-1 overflow-y-auto px-8 pb-12 scroll-smooth">
        <div className="max-w-4xl mx-auto pt-8">
          {hasAnalysis && (
            <div className="mb-6 inline-flex rounded-full border border-gray-200 bg-white p-1">
              <button
                type="button"
                className={`px-3 py-1.5 text-xs font-semibold rounded-full ${activeTab === 'timeline' ? 'bg-gray-900 text-white' : 'text-gray-600 hover:text-gray-900'}`}
                onClick={() => setActiveTab('timeline')}
              >
                Timeline
              </button>
              <button
                type="button"
                className={`px-3 py-1.5 text-xs font-semibold rounded-full ${activeTab === 'analysis' ? 'bg-blue-600 text-white' : 'text-blue-700 hover:text-blue-900'}`}
                onClick={() => setActiveTab('analysis')}
              >
                Analysis
              </button>
            </div>
          )}

          {activeTab === 'timeline' ? (
            timelineContent
          ) : (
            <AnalysisDashboard analysis={analysis} />
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

const resolveFrameFrictionDetails = (
  frameFrictionPoints: Array<string | AnalysisFrictionPoint>,
  frictionMap: Map<string, AnalysisFrictionPoint>,
): AnalysisFrictionPoint[] => {
  const ids = frameFrictionPoints.map(fp => (typeof fp === 'string' ? fp : fp.id));
  const details = frameFrictionPoints
    .filter((fp): fp is AnalysisFrictionPoint => typeof fp === 'object')
    .map(fp => fp);
  const fromMap = ids
    .map(id => frictionMap.get(id))
    .filter((fp): fp is AnalysisFrictionPoint => Boolean(fp));

  const seen = new Set<string>();
  return [...details, ...fromMap].filter(fp => {
    if (seen.has(fp.id)) return false;
    seen.add(fp.id);
    return true;
  });
};

const renderSuggestions = (suggestions: AnalysisSuggestion[], tokenKey: 'token_estimation_save' | 'estimated_tokens_saved') => (
  <div className="space-y-3">
    {suggestions.map((suggestion) => (
      <article key={suggestion.id} className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="flex flex-wrap items-center gap-2 mb-2">
          <span className="text-[10px] rounded-full bg-gray-100 px-2 py-0.5 font-semibold uppercase tracking-wide">{suggestion.category}</span>
          <span className="text-[11px] font-mono text-gray-500">{suggestion.id}</span>
          {typeof suggestion[tokenKey] === 'number' && (
            <span className="text-[11px] text-blue-700 font-semibold">{suggestion[tokenKey]?.toLocaleString()} est. tokens saved</span>
          )}
        </div>
        {suggestion.title ? <h4 className="text-sm font-semibold text-gray-900 mb-1">{suggestion.title}</h4> : null}
        <p className="text-sm text-gray-700 whitespace-pre-wrap">{suggestion.rationale}</p>
        <pre className="mt-2 text-xs bg-gray-50 border border-gray-100 rounded-lg p-3 whitespace-pre-wrap text-gray-700">{suggestion.snippet}</pre>
        {suggestion.addresses.length > 0 ? (
          <div className="mt-2 text-xs text-gray-500">Addresses: {suggestion.addresses.join(', ')}</div>
        ) : null}
        {suggestion.merged_from && suggestion.merged_from.length > 0 ? (
          <div className="mt-1 text-xs text-gray-500">Merged from: {suggestion.merged_from.join(', ')}</div>
        ) : null}
      </article>
    ))}
  </div>
);

const ConversationCard = ({ conversation, index }: { conversation: AnalysisConversation; index: number }) => {
  const frictionMap = new Map<string, AnalysisFrictionPoint>();
  for (const frictionPoint of conversation.friction_points ?? []) {
    frictionMap.set(frictionPoint.id, frictionPoint);
  }
  for (const frame of conversation.frames) {
    for (const point of frame.friction_points ?? []) {
      if (typeof point === 'object') {
        frictionMap.set(point.id, point);
      }
    }
  }

  return (
    <section className="rounded-2xl border border-gray-200 bg-gray-50/50 p-5">
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <h3 className="text-base font-bold text-gray-900">Conversation {index + 1}</h3>
        {conversation.conversation_id ? <span className="text-[11px] font-mono text-gray-500">{conversation.conversation_id}</span> : null}
        {conversation.agent_type ? <span className="text-[10px] rounded-full bg-blue-100 px-2 py-0.5 font-semibold text-blue-800">{conversation.agent_type}</span> : null}
      </div>
      <div className="space-y-3">
        {conversation.frames.map(frame => {
          const frameFriction = resolveFrameFrictionDetails(frame.friction_points ?? [], frictionMap);
          return (
            <article key={frame.id} className="rounded-xl border border-gray-200 bg-white p-4">
              <div className="flex flex-wrap items-center gap-2 mb-1">
                <h4 className="text-sm font-semibold text-gray-900">{frame.title}</h4>
                <span className={`text-[10px] rounded-full px-2 py-0.5 font-semibold ${
                  frame.outcome === 'success' ? 'bg-green-100 text-green-700'
                    : frame.outcome === 'partial' ? 'bg-yellow-100 text-yellow-700'
                      : 'bg-red-100 text-red-700'
                }`}
                >
                  {frame.outcome}
                </span>
                <span className="text-[10px] rounded-full bg-gray-100 px-2 py-0.5 font-semibold text-gray-700">
                  {frame.health}
                </span>
                <span className="text-[11px] text-gray-500 font-mono">
                  {frame.message_range[0]}-{frame.message_range[1]}
                </span>
              </div>
              <p className="text-sm text-gray-700">{frame.goal}</p>
              {frameFriction.length > 0 && (
                <div className="mt-3 space-y-2">
                  <div className="text-xs font-semibold text-gray-800">Friction points</div>
                  {frameFriction.map(point => (
                    <div key={point.id} className="rounded-lg border border-red-100 bg-red-50/50 p-2.5">
                      <div className="text-[11px] font-mono text-red-700 mb-1">{point.id} · {point.message_range[0]}-{point.message_range[1]}</div>
                      <div className="text-xs text-red-900">{point.description}</div>
                      <div className="text-xs text-red-700 mt-1 italic">"{point.evidence_quote}"</div>
                    </div>
                  ))}
                </div>
              )}
            </article>
          );
        })}
      </div>
      {conversation.suggestions.length > 0 && (
        <div className="mt-4">
          <div className="flex items-center gap-2 text-xs font-bold text-blue-800 mb-2 uppercase tracking-wide">
            <GitBranch size={14} /> Conversation Suggestions
          </div>
          {renderSuggestions(conversation.suggestions, 'token_estimation_save')}
        </div>
      )}
    </section>
  );
};

const AnalysisDashboard = ({ analysis }: { analysis: Analysis | null }) => {
  if (!analysis) {
    return (
      <div className="rounded-2xl border border-gray-200 bg-white p-6 text-sm text-gray-600">
        No analysis available for this session.
      </div>
    );
  }

  if (isLegacyAnalysis(analysis)) {
    return (
      <div className="rounded-2xl border border-yellow-200 bg-yellow-50/40 p-6">
        <div className="text-sm font-semibold text-yellow-800 mb-1">Legacy analysis format</div>
        <p className="text-sm text-yellow-900">
          This session uses the older frame schema. Use the timeline tab to inspect frame-grouped events.
        </p>
      </div>
    );
  }

  if (!isFinalizedAnalysis(analysis)) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50/40 p-6">
        <div className="text-sm font-semibold text-red-800 mb-1">Invalid analysis format</div>
        <p className="text-sm text-red-900">The analysis payload could not be interpreted safely.</p>
      </div>
    );
  }

  const finalized: FinalizedAnalysis = analysis;
  return (
    <div className="space-y-6 pb-4">
      <section className="rounded-2xl border border-gray-200 bg-white p-5">
        <div className="text-xs font-bold text-gray-700 uppercase tracking-wide mb-2">Summary</div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="rounded-xl bg-gray-50 border border-gray-100 p-3">
            <div className="text-xs text-gray-500">Conversations</div>
            <div className="text-lg font-bold text-gray-900">{finalized.conversations.length}</div>
          </div>
          <div className="rounded-xl bg-gray-50 border border-gray-100 p-3">
            <div className="text-xs text-gray-500">Sub-agent analyses</div>
            <div className="text-lg font-bold text-gray-900">{finalized.sub_agent_analyses.length}</div>
          </div>
          <div className="rounded-xl bg-gray-50 border border-gray-100 p-3">
            <div className="text-xs text-gray-500">Global suggestions</div>
            <div className="text-lg font-bold text-gray-900">{finalized.suggestions.length}</div>
          </div>
        </div>
      </section>

      <section>
        <div className="flex items-center gap-2 text-sm font-bold text-gray-900 mb-3 uppercase tracking-wide">
          <ListTree size={15} className="text-blue-600" /> Conversations
        </div>
        <div className="space-y-4">
          {finalized.conversations.map((conversation, index) => (
            <ConversationCard key={`${conversation.conversation_id || 'conversation'}-${index}`} conversation={conversation} index={index} />
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-gray-200 bg-white p-5">
        <div className="text-sm font-bold text-gray-900 mb-3 uppercase tracking-wide">Sub-Agent Analyses</div>
        {finalized.sub_agent_analyses.length === 0 ? (
          <div className="text-sm text-gray-600">No sub-agent analyses were produced.</div>
        ) : (
          <div className="space-y-4">
            {finalized.sub_agent_analyses.map((sub, index) => (
              <article key={`${sub.agent_type}-${index}`} className="rounded-xl border border-gray-200 bg-gray-50/40 p-4">
                <div className="flex flex-wrap items-center gap-2 mb-2">
                  <span className="text-sm font-semibold text-gray-900">{sub.agent_type}</span>
                  <span className="text-[10px] rounded-full bg-blue-100 px-2 py-0.5 font-semibold text-blue-800">
                    {sub.invocation_count} invocations
                  </span>
                </div>
                <p className="text-sm text-gray-700 mb-3">{sub.inferred_purpose}</p>
                <div className="space-y-2 mb-3">
                  {(sub.shared_preamble_actions ?? []).map(action => (
                    <div key={action.id} className="rounded-lg border border-gray-200 bg-white p-2.5">
                      <div className="text-[11px] font-mono text-gray-500">{action.id} · {action.category}</div>
                      <div className="text-sm text-gray-800">{action.action}</div>
                      <div className="text-xs text-gray-600 mt-1">{action.orthogonality_rationale}</div>
                    </div>
                  ))}
                </div>
                {sub.suggestions.length > 0 ? renderSuggestions(sub.suggestions, 'token_estimation_save') : null}
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-blue-100 bg-blue-50/30 p-5">
        <div className="text-sm font-bold text-blue-900 mb-3 uppercase tracking-wide">Merged Global Suggestions</div>
        {finalized.suggestions.length > 0
          ? renderSuggestions(finalized.suggestions, 'estimated_tokens_saved')
          : <div className="text-sm text-blue-900">No merged suggestions were produced.</div>}
      </section>
    </div>
  );
};
