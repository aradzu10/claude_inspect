import React, { useEffect, useRef, useState } from 'react';
import {
  Activity,
  ArrowUpRight,
  Bot,
  ChevronDown,
  ChevronUp,
  Clock,
  FileEdit,
  FileText,
  Settings,
  Terminal,
  User,
} from 'lucide-react';
import { Event } from '../types';
import { getBasename, trimText } from '../utils/text';
import { nudgeIntoViewIfPartiallyVisible } from '../utils/scroll';
import { getEventTokens, isCompactionBoundary } from '../utils/events';
import { useSession } from '../context/SessionContext';
import { ExpandableContent } from './ExpandableContent';
import { renderContent } from './ContentRenderer';

interface ToolBlockProps {
  part: any;
  hooks?: any[];
  output?: any;
  subagent_id?: string;
}

export const ToolBlock = ({ part, hooks, output, subagent_id }: ToolBlockProps) => {
  const { subagentLogs, fetchSubagentLogs, setActiveSubagentId, mainContentScrollRef } = useSession();
  const [isExpanded, setIsExpanded] = useState(false);
  const [isStickyActive, setIsStickyActive] = useState(false);
  const [isToolHeaderStuck, setIsToolHeaderStuck] = useState(false);
  const [isFullLogHeaderStuck, setIsFullLogHeaderStuck] = useState(false);
  const fullLogSectionRef = useRef<HTMLDivElement>(null);
  const fullLogHeaderRef = useRef<HTMLDivElement>(null);
  const toolBlockRef = useRef<HTMLDivElement>(null);
  const toolHeaderRef = useRef<HTMLDivElement>(null);
  const stickyActivationTimerRef = useRef<number | null>(null);
  const collapseTimerRef = useRef<number | null>(null);
  const [toolHeaderHeight, setToolHeaderHeight] = useState(56);
  const [showFullLog, setShowFullLog] = useState(false);
  const agentId = subagent_id || part.subagent_id || part.input?.agent_id;

  const toggleExpanded = () => {
    if (stickyActivationTimerRef.current) {
      window.clearTimeout(stickyActivationTimerRef.current);
      stickyActivationTimerRef.current = null;
    }
    if (collapseTimerRef.current) {
      window.clearTimeout(collapseTimerRef.current);
      collapseTimerRef.current = null;
    }

    if (isExpanded) {
      setIsStickyActive(false);
      setIsToolHeaderStuck(false);
      setIsFullLogHeaderStuck(false);

      const shouldScrollBack = isToolHeaderStuck || isFullLogHeaderStuck;
      if (!shouldScrollBack) {
        setIsExpanded(false);
        return;
      }

      const container = mainContentScrollRef.current;
      const block = toolBlockRef.current;
      if (container && block) {
        const containerRect = container.getBoundingClientRect();
        const blockRect = block.getBoundingClientRect();
        const blockTop = blockRect.top - containerRect.top + container.scrollTop;
        const targetTop = Math.max(0, blockTop - 12);
        container.scrollTo({ top: targetTop, behavior: 'smooth' });
        collapseTimerRef.current = window.setTimeout(() => {
          setIsExpanded(false);
          collapseTimerRef.current = null;
        }, 220);
      } else {
        setIsExpanded(false);
      }
      return;
    }

    setIsExpanded(true);
    setIsStickyActive(false);
    requestAnimationFrame(() => {
      if (toolHeaderRef.current) {
        nudgeIntoViewIfPartiallyVisible(mainContentScrollRef.current, toolHeaderRef.current, { topOffset: 0, maxAboveNudge: 2000 });
      }
      stickyActivationTimerRef.current = window.setTimeout(() => {
        setIsStickyActive(true);
        stickyActivationTimerRef.current = null;
      }, 260);
    });
  };

  const getToolSummary = () => {
    const name = part.name?.toLowerCase() || '';
    if (name === 'read' || name === 'read_file') {
      return getBasename(part.input.file_path || part.input.path || '');
    }
    if (name === 'edit' || name === 'multiedit' || name === 'multi_edit') {
      return getBasename(part.input.file_path || part.input.path || '');
    }
    if (name === 'write' || name === 'write_file') {
      return getBasename(part.input.file_path || part.input.path || '');
    }
    if (name === 'shell' || name === 'run_shell_command' || name === 'bash') {
      return part.input.description || trimText(part.input.command || '', 100);
    }
    if (name === 'agent') {
      return part.input.description || 'Agent Call';
    }
    if (name === 'glob') {
      return part.input.pattern || '';
    }
    return part.name;
  };

  const renderReadRange = (input: any) => {
    const viewRange = input?.view_range;
    if (Array.isArray(viewRange) && viewRange.length === 2) {
      return (
        <div className="text-[10px] text-blue-700 bg-blue-100/60 border border-blue-200 rounded px-2 py-0.5 font-mono">
          lines {viewRange[0]}–{viewRange[1] === -1 ? 'end' : viewRange[1]}
        </div>
      );
    }
    if (typeof input?.offset === 'number' || typeof input?.limit === 'number') {
      return (
        <div className="text-[10px] text-blue-700 bg-blue-100/60 border border-blue-200 rounded px-2 py-0.5 font-mono">
          offset {input?.offset ?? 0}, limit {input?.limit ?? 'default'}
        </div>
      );
    }
    if (typeof input?.start_line === 'number' || typeof input?.end_line === 'number') {
      return (
        <div className="text-[10px] text-blue-700 bg-blue-100/60 border border-blue-200 rounded px-2 py-0.5 font-mono">
          lines {input?.start_line ?? '?'}–{input?.end_line ?? '?'}
        </div>
      );
    }
    return null;
  };

  const renderToolInput = () => {
    const name = part.name?.toLowerCase() || '';
    if (name === 'read' || name === 'read_file') {
      return (
        <div className="space-y-2">
          <div className="text-blue-700 font-medium flex items-center gap-2 font-mono text-xs bg-blue-50/50 p-2 rounded border border-blue-100/50 break-all whitespace-pre-wrap">
            <FileText size={14} /> {part.input.file_path || part.input.path}
          </div>
          {renderReadRange(part.input)}
        </div>
      );
    }
    if (name === 'edit' || name === 'multiedit' || name === 'multi_edit') {
      const edits = Array.isArray(part.input.edits)
        ? part.input.edits
        : [{ old_string: part.input.old_string, new_string: part.input.new_string, replace_all: part.input.replace_all }];
      return (
        <div className="space-y-2">
          <div className="text-orange-700 font-medium flex items-center gap-2 font-mono text-xs bg-orange-50/50 p-2 rounded border border-orange-100/50 break-all whitespace-pre-wrap">
            <FileEdit size={14} /> {part.input.file_path || part.input.path}
          </div>
          {edits.map((edit: any, idx: number) => (
            <div key={idx} className="border border-orange-100 rounded-lg overflow-hidden bg-orange-50/20">
              <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-orange-700 bg-orange-100/50 flex items-center justify-between">
                <span>Edit {edits.length > 1 ? `#${idx + 1}` : ''}</span>
                <span className="font-mono">{edit?.replace_all ? 'replace_all=true' : 'replace_all=false'}</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 p-2">
                <div>
                  <div className="text-[10px] text-gray-500 font-semibold mb-1">Find</div>
                  <ExpandableContent maxHeight={140}>
                    <pre className="text-[11px] bg-white p-2 rounded border border-gray-100 overflow-x-auto font-mono text-gray-800 whitespace-pre-wrap break-all">
                      {edit?.old_string || '(empty)'}
                    </pre>
                  </ExpandableContent>
                </div>
                <div>
                  <div className="text-[10px] text-gray-500 font-semibold mb-1">Replace with</div>
                  <ExpandableContent maxHeight={140}>
                    <pre className="text-[11px] bg-white p-2 rounded border border-gray-100 overflow-x-auto font-mono text-gray-800 whitespace-pre-wrap break-all">
                      {edit?.new_string || '(empty)'}
                    </pre>
                  </ExpandableContent>
                </div>
              </div>
            </div>
          ))}
        </div>
      );
    }
    if (name === 'write' || name === 'write_file') {
      return (
        <div className="space-y-2">
          <div className="text-orange-700 font-medium flex items-center gap-2 font-mono text-xs bg-orange-50/50 p-2 rounded border border-orange-100/50 break-all whitespace-pre-wrap">
            <FileEdit size={14} /> {part.input.file_path || part.input.path}
          </div>
          {renderReadRange(part.input)}
          <ExpandableContent maxHeight={200}>
            <pre className="text-[11px] bg-gray-50 p-3 rounded border border-gray-100 overflow-x-auto font-mono text-gray-800 shadow-inner whitespace-pre-wrap break-all">
              {part.input.content}
            </pre>
          </ExpandableContent>
        </div>
      );
    }
    if (name === 'shell' || name === 'run_shell_command' || name === 'bash') {
      return (
        <div className="space-y-2">
          {part.input.description && (
            <div className="text-sm text-gray-700 font-semibold mb-2 border-l-4 border-blue-500 pl-3 py-1 bg-blue-50/30 rounded-r whitespace-pre-wrap">
              {part.input.description}
            </div>
          )}
          <div className="bg-gray-900 text-green-400 p-3 rounded-lg font-mono text-xs border border-gray-800 flex items-center gap-2 shadow-inner whitespace-pre-wrap break-all">
            <span className="opacity-50 font-bold">$</span> {part.input.command}
          </div>
        </div>
      );
    }
    if (name === 'agent') {
      return (
        <div className="space-y-2">
          {part.input.description && (
            <div className="text-sm text-gray-700 font-semibold mb-2 border-l-4 border-purple-500 pl-3 py-1 bg-purple-50/30 rounded-r whitespace-pre-wrap">
              {part.input.description}
            </div>
          )}
          {part.input.prompt && renderContent({
            type: 'file',
            filename: 'agent_prompt.md',
            displayPath: 'Agent Prompt',
            content: part.input.prompt,
          })}
          {part.input.agent_id && (
            <div className="text-[10px] text-gray-400 font-mono">Continuing Agent ID: {part.input.agent_id}</div>
          )}
        </div>
      );
    }
    return <pre className="text-gray-800 overflow-x-auto text-xs bg-gray-50 p-3 rounded-lg border border-gray-100 font-mono whitespace-pre-wrap break-all">{JSON.stringify(part.input, null, 2)}</pre>;
  };

  const renderToolOutput = (out: any) => {
    if (!out) return null;

    const globResult = out.toolUseResult?.filenames || out.toolUseResult?.output;
    if (globResult && Array.isArray(globResult)) {
      return (
        <div className="space-y-1">
          {globResult.map((f: string) => (
            <div key={f} className="text-[11px] font-mono text-green-700 flex items-center gap-2 break-all whitespace-pre-wrap">
              <FileText size={12} className="opacity-50" /> {f}
            </div>
          ))}
        </div>
      );
    }

    const resultBody = out.content || out.message?.content || out.toolUseResult?.content || out.toolUseResult || out.attachment;

    if (out.type === 'tool_result' && out.content) {
      return renderContent(out.content, true);
    }

    return renderContent(resultBody, true);
  };

  useEffect(() => {
    if (!isExpanded || !toolHeaderRef.current) return;
    setToolHeaderHeight(Math.ceil(toolHeaderRef.current.getBoundingClientRect().height));
  }, [isExpanded, showFullLog]);

  useEffect(() => {
    if (agentId && !subagentLogs[agentId]) {
      fetchSubagentLogs(agentId);
    }
  }, [agentId]);

  useEffect(() => {
    if (!isExpanded || !isStickyActive) {
      setIsToolHeaderStuck(false);
      return;
    }

    const onScroll = () => {
      const headerEl = toolHeaderRef.current;
      const blockEl = toolBlockRef.current;
      if (!headerEl || !blockEl) {
        setIsToolHeaderStuck(false);
        return;
      }

      const scrollContainer = mainContentScrollRef.current;
      const containerTop = scrollContainer ? scrollContainer.getBoundingClientRect().top : 0;
      const headerRect = headerEl.getBoundingClientRect();
      const blockRect = blockEl.getBoundingClientRect();
      const stuckAtTop = Math.abs(headerRect.top - containerTop) <= 1.5;
      const hasScrollableContent = (blockRect.bottom - containerTop) > (headerRect.height + 1);
      setIsToolHeaderStuck(stuckAtTop && hasScrollableContent);
    };

    const scrollContainer = mainContentScrollRef.current;
    const target: EventTarget = scrollContainer || window;
    onScroll();
    target.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      target.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, [isExpanded, isStickyActive]);

  useEffect(() => {
    if (!isExpanded || !showFullLog || !isStickyActive) {
      setIsFullLogHeaderStuck(false);
      return;
    }

    const onScroll = () => {
      const headerEl = fullLogHeaderRef.current;
      const sectionEl = fullLogSectionRef.current;
      if (!headerEl || !sectionEl) {
        setIsFullLogHeaderStuck(false);
        return;
      }

      const scrollContainer = mainContentScrollRef.current;
      const containerTop = scrollContainer ? scrollContainer.getBoundingClientRect().top : 0;
      const stickyTop = containerTop + toolHeaderHeight;
      const headerRect = headerEl.getBoundingClientRect();
      const sectionRect = sectionEl.getBoundingClientRect();
      const stuckAtTop = Math.abs(headerRect.top - stickyTop) <= 1.5;
      const hasScrollableContent = (sectionRect.bottom - stickyTop) > (headerRect.height + 1);
      setIsFullLogHeaderStuck(stuckAtTop && hasScrollableContent);
    };

    const scrollContainer = mainContentScrollRef.current;
    const target: EventTarget = scrollContainer || window;
    onScroll();
    target.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      target.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, [isExpanded, showFullLog, isStickyActive, toolHeaderHeight]);

  useEffect(() => {
    return () => {
      if (stickyActivationTimerRef.current) {
        window.clearTimeout(stickyActivationTimerRef.current);
      }
      if (collapseTimerRef.current) {
        window.clearTimeout(collapseTimerRef.current);
      }
    };
  }, []);

  const preHooks = hooks?.filter(h => h.attachment?.hookEvent === 'PreToolUse' || h.hookEvent === 'PreToolUse' || h.attachment?.hookName?.includes('Pre')) || [];
  const postHooks = hooks?.filter(h => h.attachment?.hookEvent === 'PostToolUse' || h.hookEvent === 'PostToolUse' || h.attachment?.hookName?.includes('Post')) || [];

  const renderHook = (h: any) => {
    let details = null;
    try {
      const stdout = h.stdout || h.attachment?.stdout;
      if (stdout) {
        const parsed = JSON.parse(stdout);
        if (parsed.hookSpecificOutput?.updatedInput) {
          details = (
            <div className="mt-2 p-2 bg-black/5 rounded text-[10px] font-mono">
              <div className="text-gray-400 mb-1 uppercase font-bold text-[9px]">Updated Input:</div>
              <div className="text-gray-700 whitespace-pre-wrap break-all">{JSON.stringify(parsed.hookSpecificOutput.updatedInput, null, 2)}</div>
            </div>
          );
        }
      }
    } catch (e) {}

    return (
      <div key={h.uuid || Math.random()} className="text-[11px] bg-blue-50/30 text-blue-700 px-3 py-2 rounded-lg border border-blue-100/50 flex flex-col">
        <span className="flex items-center gap-2 font-medium">
          <Settings size={12} className="opacity-50" /> {h.hookName || h.attachment?.hookName}
        </span>
        {details}
      </div>
    );
  };

  return (
    <div
      ref={toolBlockRef}
      className={`my-4 border border-gray-200 shadow-sm bg-white group ring-1 ring-black/5 ${
        isExpanded
          ? `${isToolHeaderStuck ? 'rounded-t-none' : 'rounded-t-xl'} rounded-b-none overflow-visible`
          : 'rounded-xl overflow-hidden'
      }`}
    >
      <div
        ref={toolHeaderRef}
        className={`bg-gray-50/80 ${isToolHeaderStuck ? 'rounded-t-none' : 'rounded-t-xl'} px-4 py-3 border-b border-gray-200 flex items-center justify-between cursor-pointer hover:bg-gray-100 transition-colors ${isExpanded && isStickyActive ? 'sticky top-0 z-20 backdrop-blur-sm' : ''}`}
        onClick={toggleExpanded}
      >
        <div className="flex items-center gap-3 min-w-0">
          <div className="bg-white p-1.5 rounded-lg border border-gray-200 shadow-sm shrink-0">
            {part.name?.toLowerCase() === 'agent' ? <Bot size={14} className="text-purple-500" /> : <Terminal size={14} className="text-blue-500" />}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">{part.name}</span>
            </div>
            <div className="text-sm font-bold text-gray-700 truncate max-w-[500px] break-all">
              {getToolSummary()}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {hooks && hooks.length > 0 && (
            <span className="px-2 py-0.5 bg-blue-50 text-blue-600 rounded-full text-[10px] font-bold uppercase border border-blue-100">
              {hooks.length}
            </span>
          )}
          {output && (
            <div className="bg-green-500 w-2 h-2 rounded-full shadow-sm shadow-green-200 animate-pulse"></div>
          )}
          {isExpanded ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
        </div>
      </div>

      {isExpanded && (
        <div className="p-4 space-y-4 animate-in fade-in slide-in-from-top-1 duration-200">
          {preHooks.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-[10px] font-bold text-gray-400 uppercase tracking-tight flex items-center gap-2">
                <Activity size={10} /> Pre-Tool Hooks
              </div>
              <div className="flex flex-col gap-1">
                {preHooks.map(renderHook)}
              </div>
            </div>
          )}

          <div className="space-y-2">
            <div className="text-[10px] font-bold text-gray-400 uppercase tracking-tight flex items-center gap-2">
              <ArrowUpRight size={10} /> Arguments
            </div>
            {renderToolInput()}
          </div>

          {output && part.name?.toLowerCase() !== 'agent' && (
            <div className="space-y-2">
              <div className="text-[10px] font-bold text-gray-400 uppercase tracking-tight flex items-center gap-2">
                <Terminal size={10} /> Output
              </div>
              <div className="bg-gray-50/30 rounded-lg border border-gray-100 overflow-hidden">
                <div className="p-3">
                  {renderToolOutput(output)}
                </div>
              </div>
            </div>
          )}

          {postHooks.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-[10px] font-bold text-gray-400 uppercase tracking-tight flex items-center gap-2">
                <Activity size={10} /> Post-Tool Hooks
              </div>
              <div className="flex flex-col gap-1">
                {postHooks.map(renderHook)}
              </div>
            </div>
          )}

          {agentId && (
            <div className="space-y-4 pt-4 border-t border-gray-100">
              <div className="space-y-2">
                <div className="text-[10px] font-bold text-purple-600 uppercase tracking-tight flex items-center gap-2">
                  <Bot size={10} /> Final Agent Output
                </div>
                <div className="bg-purple-50/30 rounded-lg border border-purple-100 overflow-hidden p-3">
                  {(() => {
                    if (!subagentLogs[agentId]) {
                      return <div className="text-xs text-gray-400 italic">Loading final output...</div>;
                    }
                    const logs = subagentLogs[agentId];
                    const lastAssistant = [...logs].reverse().find(e => e.role_type === 'assistant');
                    if (lastAssistant) {
                      return renderContent(lastAssistant.message?.content);
                    }
                    return <div className="text-xs text-gray-400 italic">No assistant output found.</div>;
                  })()}
                </div>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowFullLog(!showFullLog);
                  }}
                  className="flex-1 flex items-center justify-center gap-2 py-3 bg-white text-blue-600 border border-blue-200 rounded-xl text-xs font-bold hover:bg-blue-50 transition-all shadow-sm group"
                >
                  <Activity size={14} className="group-hover:animate-pulse" />
                  {showFullLog ? 'Hide Full Conversation' : 'View Full Sub-agent Conversation'}
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); setActiveSubagentId(agentId); }}
                  className="px-4 flex items-center justify-center bg-white text-gray-600 border border-gray-200 rounded-xl text-xs font-bold hover:bg-gray-50 transition-all shadow-sm"
                  title="Open in Modal"
                >
                  <ArrowUpRight size={14} />
                </button>
              </div>

              {showFullLog && (
                <div
                  ref={fullLogSectionRef}
                  className={`bg-gray-50/50 border border-gray-100 animate-in fade-in duration-300 overflow-visible ${isFullLogHeaderStuck ? 'rounded-t-none' : 'rounded-t-xl'} rounded-b-xl`}
                >
                  <div
                    ref={fullLogHeaderRef}
                    className={`sticky z-30 bg-white/95 backdrop-blur-sm border-b border-gray-100 px-4 py-3 flex items-center justify-between ${isFullLogHeaderStuck ? 'rounded-t-none' : 'rounded-t-xl'}`}
                    style={{ top: `${toolHeaderHeight}px` }}
                  >
                    <div className="text-xs font-bold text-gray-600 uppercase tracking-wider">Full Conversation</div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        const container = mainContentScrollRef.current;
                        const section = fullLogSectionRef.current;
                        if (!container || !section) return;
                        const containerTop = container.getBoundingClientRect().top;
                        const sectionTop = section.getBoundingClientRect().top;
                        container.scrollBy({
                          top: sectionTop - containerTop - toolHeaderHeight,
                          behavior: 'smooth',
                        });
                      }}
                      className="text-[11px] font-semibold text-blue-600 hover:text-blue-700"
                    >
                      Jump to Start
                    </button>
                  </div>
                  <div className="p-6 space-y-6">
                    {subagentLogs[agentId]?.map(e => <EventView key={e.uuid || Math.random().toString()} event={e} isNested />)}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

interface EventViewProps {
  event: Event;
  isNested?: boolean;
}

export const EventView = ({ event, isNested = false }: EventViewProps) => {
  const { messageRefs } = useSession();
  const isAssistant = event.role_type === 'assistant';
  const isUser = event.role_type === 'user';
  const isTool = event.role_type === 'tool';

  const contentParts = event.message?.content;
  const parts = Array.isArray(contentParts) ? contentParts : (contentParts ? [contentParts] : []);
  const toolUses = isAssistant ? parts.filter((p: any) => p.type === 'tool_use') : [];

  const getIcon = () => {
    if (isAssistant) return <Bot size={18} className="text-blue-600" />;
    if (isUser) return <User size={18} className="text-gray-700" />;
    if (isTool) return <Terminal size={18} className="text-green-600" />;
    return <Settings size={18} className="text-gray-400" />;
  };

  const getLabel = () => {
    if (isAssistant) return 'Assistant';
    if (isUser) return 'User';
    if (isTool) return 'Tool';
    return 'System';
  };

  const thinking = isAssistant && Array.isArray(event.message?.content)
    ? event.message?.content.find((p: any) => p.type === 'thinking')?.thinking
    : null;

  const rawContent = event.message
    ? renderContent(event.message.content)
    : event.attachment
      ? renderContent(event.attachment)
      : event.content
        ? renderContent(event.content)
        : null;

  const content = rawContent;
  const compactionBoundary = isCompactionBoundary(event);

  if (!content && toolUses.length === 0 && !thinking) return null;

  const { modelTokens, toolTokens, thinkingTokens } = getEventTokens(event);
  const totalTokenSum = modelTokens.read + modelTokens.cache + modelTokens.write
    + toolTokens.input + toolTokens.output + thinkingTokens.input + thinkingTokens.output;

  return (
    <div
      key={event.uuid || Math.random().toString()}
      ref={el => { if (event.uuid) messageRefs.current[event.uuid] = el; }}
      className={`mb-8 border-b pb-8 transition-colors ${compactionBoundary ? 'border-amber-300 bg-amber-50/40 rounded-xl px-4 pt-4' : 'border-gray-100'} ${isNested ? 'opacity-80 scale-[0.98] origin-top' : ''}`}
    >
      <div className="flex items-start gap-4">
        <div className={`mt-1 p-2 rounded-full ${isAssistant ? 'bg-blue-50' : 'bg-gray-50'}`}>
          {getIcon()}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-3">
              <span className="font-semibold text-gray-900">{getLabel()}</span>
              {compactionBoundary && (
                <span className="text-[10px] font-bold uppercase tracking-wider bg-amber-100 text-amber-800 border border-amber-300 px-2 py-0.5 rounded-full">
                  Conversation Compacted
                </span>
              )}
              <span className="text-xs text-gray-400 font-mono">
                {event.timestamp ? new Date(event.timestamp).toLocaleTimeString() : 'N/A'}
              </span>
              {totalTokenSum > 0 && (
                <div className="flex gap-2 items-center bg-gray-50 px-2 py-0.5 rounded border border-gray-100 flex-wrap">
                  <span className="text-[9px] text-gray-500 font-mono">
                    Model Read: <span className="font-bold">{modelTokens.read.toLocaleString()}</span>
                  </span>
                  <span className="text-[9px] text-green-600 font-mono border-l border-gray-200 pl-2">
                    Model Cache: <span className="font-bold">{modelTokens.cache.toLocaleString()}</span>
                  </span>
                  <span className="text-[9px] text-blue-500 font-mono border-l border-gray-200 pl-2">
                    Model Write: <span className="font-bold">{modelTokens.write.toLocaleString()}</span>
                  </span>
                  {(toolTokens.input + toolTokens.output) > 0 && (
                    <>
                      <span className="text-[9px] text-purple-600 font-mono border-l border-gray-200 pl-2">
                        Tool In: <span className="font-bold">{toolTokens.input.toLocaleString()}</span>
                      </span>
                      <span className="text-[9px] text-pink-600 font-mono border-l border-gray-200 pl-2">
                        Tool Out: <span className="font-bold">{toolTokens.output.toLocaleString()}</span>
                      </span>
                    </>
                  )}
                  {(thinkingTokens.input + thinkingTokens.output) > 0 && (
                    <>
                      <span className="text-[9px] text-amber-700 font-mono border-l border-gray-200 pl-2">
                        Thinking In: <span className="font-bold">{thinkingTokens.input.toLocaleString()}</span>
                      </span>
                      <span className="text-[9px] text-amber-900 font-mono border-l border-gray-200 pl-2">
                        Thinking Out: <span className="font-bold">{thinkingTokens.output.toLocaleString()}</span>
                      </span>
                    </>
                  )}
                </div>
              )}
            </div>
            <div className="text-[10px] text-gray-300 font-mono uppercase tracking-widest truncate max-w-[150px]">
              {event.uuid ? event.uuid.split('-')[0] : event.agentId ? `AGENT: ${event.agentId.split('-')[0]}` : 'N/A'}
            </div>
          </div>

          {thinking && (
            <div className="mb-4 border border-gray-100 rounded-xl overflow-hidden bg-gray-50/20">
              <div className="px-3 py-1.5 bg-gray-50 border-b border-gray-100 text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                Thinking
              </div>
              <ExpandableContent maxHeight={220}>
                <div className="p-3 whitespace-pre-wrap text-gray-700 leading-relaxed text-sm break-words">
                  {thinking}
                </div>
              </ExpandableContent>
            </div>
          )}

          <div className="text-gray-800 leading-relaxed text-[15px]">
            {content}
          </div>

          {toolUses.map((part: any, idx: number) => (
            <ToolBlock
              key={idx}
              part={part}
              hooks={part.hooks}
              output={part.output}
              subagent_id={part.subagent_id}
            />
          ))}
        </div>
      </div>
    </div>
  );
};

export const isEventRenderable = (event: Event): boolean => {
  const isAssistant = event.role_type === 'assistant';
  const contentParts = event.message?.content;
  const parts = Array.isArray(contentParts) ? contentParts : (contentParts ? [contentParts] : []);
  const toolUses = isAssistant ? parts.filter((p: any) => p.type === 'tool_use') : [];
  const thinking = isAssistant && Array.isArray(event.message?.content)
    ? event.message?.content.find((p: any) => p.type === 'thinking')?.thinking
    : null;
  const rawContent = event.message
    ? renderContent(event.message.content)
    : event.attachment
      ? renderContent(event.attachment)
      : event.content
        ? renderContent(event.content)
        : null;
  return Boolean(rawContent || toolUses.length > 0 || thinking);
};

export const SubagentLoadingIndicator = () => (
  <div className="h-full flex flex-col items-center justify-center text-gray-400 gap-4">
    <Clock size={32} className="animate-spin text-blue-500" />
    <p className="text-sm font-medium italic">Loading conversation log...</p>
  </div>
);
