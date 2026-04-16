import React, { useState, useEffect, useRef } from 'react';
import { 
  Search, 
  Terminal, 
  User, 
  Bot, 
  Cpu, 
  Settings, 
  ChevronRight, 
  ChevronDown, 
  ChevronUp,
  Activity,
  History,
  AlertCircle,
  FileText,
  FileEdit,
  ArrowUpRight,
  Clock,
  X,
  Folder
} from 'lucide-react';

interface TokenUsage {
  input: number;
  output: number;
  thinking: number;
  tools: number;
  cache_creation: number;
  cache_read: number;
}

interface ModelTokenUsage {
  read: number;
  cache: number;
  write: number;
}

interface ToolTokenUsage {
  input: number;
  output: number;
}

interface ThinkingTokenUsage {
  input: number;
  output: number;
}

interface Event {
  uuid: string;
  type: string;
  timestamp: string;
  role_type: string;
  message?: any;
  attachment?: any;
  content?: any;
  tokens: TokenUsage;
  model_tokens?: ModelTokenUsage;
  tool_tokens?: ToolTokenUsage;
  thinking_tokens?: ThinkingTokenUsage;
  total_tokens: number;
  subagent_id?: string;
  agentId?: string;
  tool_output?: any;
  hooks?: any[];
  is_compaction_boundary?: boolean;
  heavy_tokens_total?: number;
}

interface Session {
  id: string;
  title: string;
  path: string;
  size_mb: number;
  mtime?: number;
  project_name?: string;
  project_short_name?: string;
}

interface ProjectGroup {
  id: string;
  name: string;
  short_name: string;
  sessions: Session[];
  latest_mtime?: number;
}

interface SessionsResponse {
  recent_sessions: Session[];
  projects: ProjectGroup[];
}

interface Frame {
  title: string;
  objective: string;
  suggestion: string;
  event_uuids: string[];
}

interface Analysis {
  frames: Frame[];
}

function App() {
  const [recentSessions, setRecentSessions] = useState<Session[]>([]);
  const [projects, setProjects] = useState<ProjectGroup[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedProjects, setExpandedProjects] = useState<Record<string, boolean>>({});
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(false);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [analysisProgress, setAnalysisProgress] = useState<string | null>(null);
  const [subagentLogs, setSubagentLogs] = useState<Record<string, Event[]>>({});
  const [activeSubagentId, setActiveSubagentId] = useState<string | null>(null);
  const messageRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const analysisEventSourceRef = useRef<EventSource | null>(null);
  const pendingSubagentFetchesRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const query = searchQuery.trim();
    const url = query ? `/api/sessions?q=${encodeURIComponent(query)}` : '/api/sessions';
    fetch(url)
      .then(res => res.json())
      .then((data: SessionsResponse) => {
        setRecentSessions(Array.isArray(data?.recent_sessions) ? data.recent_sessions : []);
        const nextProjects = Array.isArray(data?.projects) ? data.projects : [];
        setProjects(nextProjects);
        setExpandedProjects(prev => {
          const next = { ...prev };
          for (const project of nextProjects) {
            if (next[project.id] === undefined) {
              next[project.id] = false;
            }
          }
          return next;
        });
      });
  }, [searchQuery]);

  useEffect(() => {
    if (selectedSessionId) {
      setLoading(true);
      setAnalysis(null);
      setAnalysisProgress(null);

      const controller = new AbortController();
      const signal = controller.signal;

      Promise.all([
        fetch(`/api/session/${selectedSessionId}/analysis`, { signal })
          .then(res => (res.ok ? res.json() : null))
          .catch(() => null),
        fetch(`/api/session/${selectedSessionId}`, { signal }).then(res => {
          if (!res.ok) {
            throw new Error('Failed to load session');
          }
          return res.json();
        })
      ])
        .then(([analysisData, sessionData]) => {
          setAnalysis(analysisData);
          setEvents(Array.isArray(sessionData) ? sessionData : []);
        })
        .catch((error) => {
          if (error.name !== 'AbortError') {
            setEvents([]);
          }
        })
        .finally(() => {
          if (!signal.aborted) {
            setLoading(false);
          }
        });

      return () => controller.abort();
    }
  }, [selectedSessionId]);

  useEffect(() => {
    if (analysisEventSourceRef.current) {
      analysisEventSourceRef.current.close();
      analysisEventSourceRef.current = null;
    }
  }, [selectedSessionId]);

  useEffect(() => {
    return () => {
      if (analysisEventSourceRef.current) {
        analysisEventSourceRef.current.close();
        analysisEventSourceRef.current = null;
      }
    };
  }, []);

  const triggerAnalysis = async () => {
    if (!selectedSessionId) return;
    const sessionId = selectedSessionId;

    if (analysisEventSourceRef.current) {
      analysisEventSourceRef.current.close();
      analysisEventSourceRef.current = null;
    }

    setAnalysisProgress("Starting...");
    try {
      const analyzeResponse = await fetch(`/api/session/${sessionId}/analyze`, { method: 'POST' });
      if (!analyzeResponse.ok) {
        setAnalysisProgress("Error: Failed to start analysis");
        return;
      }
    } catch {
      setAnalysisProgress("Error: Failed to start analysis");
      return;
    }
    
    const eventSource = new EventSource(`/api/session/${sessionId}/analysis/stream`);
    analysisEventSourceRef.current = eventSource;
    let notStartedCount = 0;
    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data);
      setAnalysisProgress(data.status);
      if (data.status === "Not started") {
        notStartedCount += 1;
      } else {
        notStartedCount = 0;
      }

      if (notStartedCount >= 20) {
        setAnalysisProgress("Error: Analysis did not start");
        eventSource.close();
        if (analysisEventSourceRef.current === eventSource) {
          analysisEventSourceRef.current = null;
        }
        return;
      }

      if (data.status === "Completed") {
        fetch(`/api/session/${sessionId}/analysis`)
          .then(res => (res.ok ? res.json() : null))
          .then(data => {
            if (data && Array.isArray(data.frames)) {
              setAnalysis(data);
            } else {
              setAnalysis(null);
              setAnalysisProgress("Error: Invalid analysis response");
            }
          });
        eventSource.close();
        if (analysisEventSourceRef.current === eventSource) {
          analysisEventSourceRef.current = null;
        }
      } else if (data.status.startsWith("Error")) {
        eventSource.close();
        if (analysisEventSourceRef.current === eventSource) {
          analysisEventSourceRef.current = null;
        }
      }
    };
    eventSource.onerror = () => {
      eventSource.close();
      if (analysisEventSourceRef.current === eventSource) {
        analysisEventSourceRef.current = null;
      }
    };
  };

  const updateFrameSuggestion = (frameIndex: number, newSuggestion: string) => {
    if (!analysis) return;
    const newAnalysis = { ...analysis };
    newAnalysis.frames[frameIndex].suggestion = newSuggestion;
    setAnalysis(newAnalysis);
    
    // Auto-save
    fetch(`/api/session/${selectedSessionId}/analysis`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newAnalysis)
    });
  };

  const fetchSubagentLogs = (agentId: string) => {
    if (!selectedSessionId || subagentLogs[agentId] || pendingSubagentFetchesRef.current.has(agentId)) return;
    pendingSubagentFetchesRef.current.add(agentId);
    fetch(`/api/subagent/${selectedSessionId}/${agentId}`)
      .then(res => (res.ok ? res.json() : []))
      .then(data => {
        setSubagentLogs(prev => ({ ...prev, [agentId]: Array.isArray(data) ? data : [] }));
      })
      .catch(() => {
        setSubagentLogs(prev => ({ ...prev, [agentId]: [] }));
      })
      .finally(() => {
        pendingSubagentFetchesRef.current.delete(agentId);
      });
  };

  const scrollToMessage = (uuid: string) => {
    const el = messageRefs.current[uuid];
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      el.classList.add('bg-blue-50');
      setTimeout(() => el.classList.remove('bg-blue-50'), 2000);
    }
  };

  const trimText = (text: string, limit: number, fromLeft = false) => {
    if (!text || text.length <= limit) return text;
    if (fromLeft) return '...' + text.slice(-(limit - 3));
    return text.slice(0, limit - 3) + '...';
  };

  const compactProjectPath = (projectPath: string, limit: number) => {
    if (!projectPath) return '';
    const normalized = projectPath.replace(/\/+$/, '');
    if (normalized.length <= limit) return normalized;

    const parts = normalized.split('/').filter(Boolean);
    if (parts.length === 0) return trimText(normalized, limit, true);

    let tail = parts[parts.length - 1];
    if (tail.length + 4 > limit) {
      return trimText(tail, limit, true);
    }

    for (let i = parts.length - 2; i >= 0; i--) {
      const candidate = `${parts[i]}/${tail}`;
      if (candidate.length + 4 > limit) break;
      tail = candidate;
    }

    return `.../${tail}`;
  };

  const formatSessionDateTime = (mtime?: number) => {
    if (!mtime) return '';
    const date = new Date(mtime * 1000);
    const dd = String(date.getDate()).padStart(2, '0');
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const yy = String(date.getFullYear()).slice(-2);
    const hh = String(date.getHours()).padStart(2, '0');
    const min = String(date.getMinutes()).padStart(2, '0');
    return `${dd}/${mm}/${yy} ${hh}:${min}`;
  };

  const selectSession = (sessionId: string, projectId?: string) => {
    setSelectedSessionId(sessionId);
    setRecentSessions(prev => {
      const allSessions = [...prev, ...projects.flatMap(project => project.sessions)];
      const selected = allSessions.find(session => session.id === sessionId);
      if (!selected) return prev;
      const deduped = [selected, ...prev.filter(session => session.id !== sessionId)];
      return deduped.slice(0, 20);
    });
    if (projectId) {
      setExpandedProjects(prev => ({ ...prev, [projectId]: true }));
    }
    fetch(`/api/session/${sessionId}/recent`, { method: 'POST' }).catch(() => null);
  };

  const selectedSession =
    recentSessions.find(s => s.id === selectedSessionId)
    || projects.flatMap(project => project.sessions).find(s => s.id === selectedSessionId)
    || null;
  const selectedProjectName = selectedSession?.project_name || '';

  const ExpandableContent = ({ children, maxHeight = 300, initiallyExpanded = false }: { children: React.ReactNode, maxHeight?: number, initiallyExpanded?: boolean }) => {
    const [isExpanded, setIsExpanded] = useState(initiallyExpanded);
    const contentRef = useRef<HTMLDivElement>(null);
    const [showButton, setShowButton] = useState(false);

    useEffect(() => {
      if (contentRef.current && contentRef.current.scrollHeight > maxHeight) {
        setShowButton(true);
      }
    }, [children, maxHeight]);


    return (
      <div className="relative">
        <div 
          ref={contentRef}
          className={`overflow-hidden transition-all duration-300 ${isExpanded ? 'max-h-[600px] overflow-y-auto' : ''}`}
          style={{ maxHeight: isExpanded ? '600px' : maxHeight }}
        >
          {children}
        </div>
        {showButton && (
          <button 
            onClick={() => {
              if (isExpanded && contentRef.current) {
                contentRef.current.scrollTop = 0;
              }
              setIsExpanded(!isExpanded);
            }}
            className="w-full py-2 mt-1 text-xs font-semibold text-gray-500 hover:text-gray-800 bg-gray-50/80 backdrop-blur-sm border border-gray-100 rounded-lg flex items-center justify-center gap-1 transition-colors sticky bottom-0 z-10"
          >
            {isExpanded ? (
              <><ChevronUp size={14} /> Show Less</>
            ) : (
              <><ChevronDown size={14} /> Show More ({contentRef.current?.scrollHeight}px)</>
            )}
          </button>
        )}
      </div>
    );
  };

  const SubagentModal = ({ agentId, onClose }: { agentId: string, onClose: () => void }) => {
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
                logs.map(e => renderEvent(e, true))
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-gray-400 gap-4">
                  <Clock size={32} className="animate-spin text-blue-500" />
                  <p className="text-sm font-medium italic">Loading conversation log...</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  };

  const ToolBlock = ({ part, hooks, output, subagent_id }: { part: any, hooks?: any[], output?: any, subagent_id?: string }) => {
    const [isExpanded, setIsExpanded] = useState(false);
    const fullLogSectionRef = useRef<HTMLDivElement>(null);

    const getBasename = (path: string) => {
      if (!path) return '';
      return path.split('/').pop() || path;
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
              content: part.input.prompt
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

      // Handle glob-like array results
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

      // Handle standard tool result parts or full events
      const resultBody = out.content || out.message?.content || out.toolUseResult?.content || out.toolUseResult || out.attachment;
      
      // If it's a tool_result type part, render its content
      if (out.type === 'tool_result' && out.content) {
        return renderContent(out.content, true);
      }

      return renderContent(resultBody, true);
    };

    const [showFullLog, setShowFullLog] = useState(false);
    const agentId = subagent_id || part.subagent_id || part.input?.agent_id;
    useEffect(() => {
      if (agentId && !subagentLogs[agentId]) {
        fetchSubagentLogs(agentId);
      }
    }, [agentId]);

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
      <div className="my-4 border border-gray-200 rounded-xl overflow-hidden shadow-sm bg-white group ring-1 ring-black/5">
        <div 
          className={`bg-gray-50/80 px-4 py-3 border-b border-gray-200 flex items-center justify-between cursor-pointer hover:bg-gray-100 transition-colors ${isExpanded ? 'sticky top-0 z-20 backdrop-blur-sm' : ''}`}
          onClick={() => setIsExpanded(!isExpanded)}
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
                  <div ref={fullLogSectionRef} className="bg-gray-50/50 rounded-xl border border-gray-100 animate-in fade-in duration-300 overflow-hidden">
                    <div className="sticky top-0 z-10 bg-white/95 backdrop-blur-sm border-b border-gray-100 px-4 py-3 flex items-center justify-between">
                      <div className="text-xs font-bold text-gray-600 uppercase tracking-wider">Full Conversation</div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          fullLogSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                        }}
                        className="text-[11px] font-semibold text-blue-600 hover:text-blue-700"
                      >
                        Jump to Start
                      </button>
                    </div>
                    <div className="p-6 space-y-6">
                      {subagentLogs[agentId]?.map(e => renderEvent(e, true))}
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

    const renderContent = (content: any, isInsideTool = false): React.ReactNode => {
    if (!content) return null;

    if (typeof content === 'string') {
      let cleaned = content
        .replace(/<local-command-caveat>[\s\S]*?<\/local-command-caveat>/g, '')
        .replace(/<task-notification>[\s\S]*?<\/task-notification>/g, '')
        .replace(/<command-name>[\s\S]*?<\/command-name>/g, '')
        .replace(/<local-command-stdout>[\s\S]*?<\/local-command-stdout>/g, '')
        .trim();

      if (!cleaned) return null;

      return (
        <ExpandableContent maxHeight={400} initiallyExpanded={isInsideTool}>
          <div className="whitespace-pre-wrap text-gray-800 leading-relaxed break-words">{cleaned}</div>
        </ExpandableContent>
      );
    }

    if (typeof content === 'object' && content !== null && !Array.isArray(content)) {
      if (content.type === 'file') {
        const fileContent = typeof content.content === 'object' 
          ? (content.content.file?.content || content.content.content) 
          : content.content;

        return (
          <div className="my-2 border border-gray-200 rounded-lg overflow-hidden shadow-sm">
            <div className="bg-gray-50 px-3 py-2 border-b border-gray-200 flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-medium text-gray-700">
                <FileText size={14} className="text-gray-400 shrink-0" /> 
                <span className="break-all whitespace-pre-wrap">{content.displayPath || content.filename}</span>
              </div>
            </div>
            <ExpandableContent maxHeight={300}>
              <pre className="p-3 text-[11px] font-mono whitespace-pre-wrap bg-white overflow-x-auto text-gray-800 break-words">
                {fileContent}
              </pre>
            </ExpandableContent>
          </div>
        );
      }

      if (content.type === 'deferred_tools_delta') {
        return (
          <div className="my-2 p-3 bg-blue-50/30 border border-blue-100 rounded-lg">
            <div className="text-[10px] font-bold text-blue-600 uppercase mb-2">Tools Available</div>
            <div className="flex flex-wrap gap-1.5">
              {content.addedNames.map((n: string) => (
                <span key={n} className="px-2 py-0.5 bg-white border border-blue-100 text-blue-700 rounded text-[10px] font-mono">{n}</span>
              ))}
            </div>
          </div>
        );
      }
      if (content.type === 'skill_listing') {
        return (
          <div className="my-2 p-3 bg-purple-50/30 border border-purple-100 rounded-lg">
            <div className="text-[10px] font-bold text-purple-600 uppercase mb-2">Skills Available ({content.skillCount})</div>
            <pre className="text-[11px] font-mono text-gray-700 whitespace-pre-wrap">{content.content}</pre>
          </div>
        );
      }
      if (Array.isArray(content.content)) {
        return renderContent(content.content);
      }
    }
    
    if (Array.isArray(content)) {
      const rendered: React.ReactNode[] = content.map((part, i) => {
        if (typeof part === 'string') return renderContent(part);
        if (part.type === 'text') {
          return renderContent(part.text);
        }
        if (part.type === 'thinking') return null; 
        if (part.type === 'tool_use') return null; 
        if (part.type === 'tool_result') {
           return renderContent(part.content);
        }
        return <div key={i} className="text-xs text-gray-400 italic">[{part.type} content]</div>;
      }).filter(Boolean);
      
      return rendered.length > 0 ? <div className="space-y-4">{rendered}</div> : null;
    }
    return <div className="text-xs text-gray-400 italic font-mono">{JSON.stringify(content)}</div>;
  };

  const FrameComponent = ({ frame, frameIndex, children }: { frame: Frame, frameIndex: number, children: React.ReactNode }) => {
    const [isSuggestionExpanded, setIsSuggestionExpanded] = useState(false);
    const [localSuggestion, setLocalSuggestion] = useState(frame.suggestion);
    
    // Sum tokens for this frame
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

  const renderEvent = (event: Event, isNested = false): React.ReactNode => {
    const isAssistant = event.role_type === 'assistant';
    const isUser = event.role_type === 'user';
    const isTool = event.role_type === 'tool';
    const isSystem = event.role_type === 'system';

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

    const rawContent = event.message ? (
      renderContent(event.message.content)
    ) : event.attachment ? (
      renderContent(event.attachment)
    ) : event.content ? (
      renderContent(event.content)
    ) : null;

    const content = rawContent;
    const isCompactionBoundary = Boolean(
      event.is_compaction_boundary
      || (event.role_type === 'system'
        && typeof event.content === 'string'
        && event.content.includes('Conversation compacted'))
    );

    if (!content && toolUses.length === 0 && !thinking) return null;

    const subId = event.subagent_id || event.tool_output?.subagent_id;
    const modelTokens = event.model_tokens || {
      read: event.tokens.input,
      cache: event.tokens.cache_read,
      write: event.tokens.output,
    };
    const toolTokens = event.tool_tokens || { input: 0, output: 0 };
    const thinkingTokens = event.thinking_tokens || { input: 0, output: event.tokens.thinking || 0 };

    return (
      <div 
        key={event.uuid || Math.random().toString()} 
        ref={el => { if (event.uuid) messageRefs.current[event.uuid] = el; }}
        className={`mb-8 border-b pb-8 transition-colors ${isCompactionBoundary ? 'border-amber-300 bg-amber-50/40 rounded-xl px-4 pt-4' : 'border-gray-100'} ${isNested ? 'opacity-80 scale-[0.98] origin-top' : ''}`}
      >
        <div className="flex items-start gap-4">
          <div className={`mt-1 p-2 rounded-full ${isAssistant ? 'bg-blue-50' : 'bg-gray-50'}`}>
            {getIcon()}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-3">
                <span className="font-semibold text-gray-900">{getLabel()}</span>
                {isCompactionBoundary && (
                  <span className="text-[10px] font-bold uppercase tracking-wider bg-amber-100 text-amber-800 border border-amber-300 px-2 py-0.5 rounded-full">
                    Conversation Compacted
                  </span>
                )}
                <span className="text-xs text-gray-400 font-mono">
                  {event.timestamp ? new Date(event.timestamp).toLocaleTimeString() : 'N/A'}
                </span>
                {(modelTokens.read + modelTokens.cache + modelTokens.write + toolTokens.input + toolTokens.output + thinkingTokens.input + thinkingTokens.output) > 0 && (
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

  const getEventSummary = (event: Event) => {
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
    return get_content_text(event.message?.content || event.attachment || "");
  };

  const HeavyTaskItem = ({ task }: { task: Event }) => {
    const isAssistant = task.role_type === 'assistant';
    const isUser = task.role_type === 'user';
    const isTool = task.role_type === 'tool';
    
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

  const isEventRenderable = (event: Event) => {
    const isAssistant = event.role_type === 'assistant';
    const contentParts = event.message?.content;
    const parts = Array.isArray(contentParts) ? contentParts : (contentParts ? [contentParts] : []);
    const toolUses = isAssistant ? parts.filter((p: any) => p.type === 'tool_use') : [];
    const thinking = isAssistant && Array.isArray(event.message?.content)
      ? event.message?.content.find((p: any) => p.type === 'thinking')?.thinking
      : null;
    const rawContent = event.message ? (
      renderContent(event.message.content)
    ) : event.attachment ? (
      renderContent(event.attachment)
    ) : event.content ? (
      renderContent(event.content)
    ) : null;
    return Boolean(rawContent || toolUses.length > 0 || thinking);
  };

  const getHeavyTasks = () => {
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

  return (
    <div className="flex h-screen bg-white text-gray-900 font-sans antialiased">
      <aside className="w-80 border-r border-gray-100 flex flex-col bg-gray-50/50">
        <div className="p-6 border-b border-gray-100 bg-white">
          <button
            onClick={() => {
              setSelectedSessionId(null);
              setActiveSubagentId(null);
            }}
            className="flex items-center gap-3 mb-6"
          >
            <div className="bg-blue-600 p-2 rounded-lg shadow-sm shadow-blue-200">
              <Terminal className="text-white" size={20} />
            </div>
            <h1 className="font-bold text-lg tracking-tight">Claude Inspect</h1>
          </button>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
            <input 
              className="w-full pl-10 pr-4 py-2 bg-gray-100 border-none rounded-lg text-sm focus:ring-2 focus:ring-blue-500/20 placeholder:text-gray-500" 
              placeholder="Search projects or sessions..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <div>
            <div className="px-3 mb-2 text-[10px] font-bold text-gray-400 uppercase tracking-widest">Recent Sessions</div>
            <div className="space-y-1">
              {recentSessions.map(s => (
                <button
                  key={`recent-${s.id}`}
                  onClick={() => selectSession(s.id)}
                  className={`w-full text-left px-4 py-3 rounded-xl transition-all duration-200 group ${
                    selectedSessionId === s.id
                      ? 'bg-white shadow-sm border border-gray-100'
                      : 'hover:bg-white/50 border border-transparent'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className={`text-sm font-medium ${selectedSessionId === s.id ? 'text-blue-600' : 'text-gray-700'}`}>
                      {s.title ? trimText(s.title, 25) : (s.id ? s.id.split('-')[0] : 'Unknown')}
                    </span>
                    <span className="text-[10px] text-gray-400 font-mono">{s.size_mb.toFixed(1)} MB</span>
                  </div>
                  <div className="text-[11px] text-gray-400 font-mono truncate">{s.id}</div>
                  <div className="text-[10px] text-gray-400">{formatSessionDateTime(s.mtime)}</div>
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="px-3 mb-2 text-[10px] font-bold text-gray-400 uppercase tracking-widest">Projects</div>
            <div className="space-y-1">
              {projects.map(project => (
                <div key={project.id} className="rounded-xl border border-transparent hover:border-gray-100">
                  <button
                    onClick={() => setExpandedProjects(prev => ({ ...prev, [project.id]: !prev[project.id] }))}
                    className="w-full text-left px-3 py-2 rounded-xl flex items-center gap-2 min-w-0 hover:bg-white/60 transition-colors"
                  >
                    {expandedProjects[project.id] ? (
                      <ChevronDown size={14} className="text-gray-500 shrink-0" />
                    ) : (
                      <ChevronRight size={14} className="text-gray-500 shrink-0" />
                    )}
                    <span
                      className="text-sm font-semibold text-gray-700 block flex-1 min-w-0 overflow-hidden whitespace-nowrap"
                      title={project.name}
                    >
                      {compactProjectPath(project.name, 34)}
                    </span>
                  </button>
                  {expandedProjects[project.id] && (
                    <div className="pl-6 pr-2 pb-2">
                      <div className="border-t border-gray-200 my-1"></div>
                      <div className="space-y-1">
                      {project.sessions.map(session => (
                        <button
                          key={`${project.id}-${session.id}`}
                          onClick={() => selectSession(session.id, project.id)}
                          className={`w-full text-left px-3 py-2 rounded-lg transition-all ${
                            selectedSessionId === session.id
                              ? 'bg-white border border-gray-100 shadow-sm'
                              : 'hover:bg-white/60 border border-transparent'
                          }`}
                        >
                          <div className={`text-sm font-medium ${selectedSessionId === session.id ? 'text-blue-600' : 'text-gray-700'} truncate`}>
                            {session.title}
                          </div>
                          <div className="text-[10px] text-gray-400 font-mono truncate">{session.id}</div>
                          <div className="text-[10px] text-gray-400">{formatSessionDateTime(session.mtime)}</div>
                        </button>
                      ))}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </aside>

      <main className="flex-1 flex flex-col min-w-0 bg-white">
        {selectedSessionId ? (
          <>
            <header className="min-h-16 py-2 border-b border-gray-100 px-8 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 shrink-0 bg-white/80 backdrop-blur-sm sticky top-0 z-10">
              <div className="min-w-0 pr-2">
                <div className="flex flex-col min-w-0">
                  <div className="text-sm font-semibold text-gray-900 flex items-start gap-2 min-w-0 mb-1" title={selectedProjectName}>
                    <Folder size={16} className="text-gray-400 shrink-0 mt-0.5" />
                    <span className="block w-full min-w-0 break-all overflow-hidden">{selectedProjectName}</span>
                  </div>
                  <div className="text-sm font-semibold text-gray-900 flex items-center gap-2">
                    <History size={16} className="text-gray-400" />
                    Session: {selectedSession?.title || selectedSessionId}
                  </div>
                  {selectedSession?.mtime ? (
                    <div className="text-sm font-semibold text-gray-900 flex items-center gap-2 mt-1">
                      <Clock size={16} className="text-gray-400" />
                      {formatSessionDateTime(selectedSession.mtime)}
                    </div>
                  ) : null}
                </div>
              </div>
              <div className="flex items-center gap-4 shrink-0">
                <div className="flex items-center gap-1 text-xs text-gray-500 bg-gray-100 px-2.5 py-1.5 rounded-full font-medium">
                  <Cpu size={14} /> Total Events: {events.length}
                </div>
                {analysisProgress ? (
                  <div className="flex items-center gap-2 text-xs font-semibold text-blue-600 animate-pulse">
                    <Clock size={14} /> {analysisProgress}
                  </div>
                ) : (
                  <button 
                    onClick={triggerAnalysis}
                    className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-1.5 rounded-full text-xs font-bold transition-all shadow-md shadow-blue-100 active:scale-95"
                  >
                    <Activity size={14} /> {analysis ? 'Re-Analyze Session' : 'Analyze Session'}
                  </button>
                )}
              </div>
              </header>

              <div className="flex-1 flex min-h-0">
              <div className="flex-1 overflow-y-auto px-8 py-12 scroll-smooth">
                <div className="max-w-4xl mx-auto">
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
                          return event ? renderEvent(event) : null;
                        })}
                      </FrameComponent>
                    ))
                  ) : (
                    events.map(e => renderEvent(e))
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
                      {getHeavyTasks().map(task => (
                        <HeavyTaskItem key={task.uuid} task={task} />
                      ))}
                    </div>
                  </div>

                  <div className="p-4 bg-blue-600 rounded-2xl text-white shadow-lg shadow-blue-100">
                    <div className="flex items-center gap-2 text-xs font-bold mb-4 opacity-80 uppercase tracking-widest">
                      Token Breakdown
                    </div>
                    {(() => {
                      const total = events.reduce((acc, e) => {
                        const modelTokens = e.model_tokens || {
                          read: e.tokens.input,
                          cache: e.tokens.cache_read,
                          write: e.tokens.output,
                        };
                        const toolTokens = e.tool_tokens || { input: 0, output: 0 };
                        const thinkingTokens = e.thinking_tokens || { input: 0, output: e.tokens.thinking || 0 };
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
                      }, { model_read: 0, model_output: 0, model_cache: 0, tool_input: 0, tool_output: 0, thinking_input: 0, thinking_output: 0, tools: 0, cache_creation: 0 });
                      
                      const max = Math.max(total.model_read, total.model_output, total.model_cache, total.tool_input, total.tool_output, total.thinking_input, total.thinking_output, total.tools, 1);
                      
                      return (
                        <div className="space-y-4">
                          {[
                            { label: 'Model Read', val: total.model_read, color: 'bg-white/20' },
                            { label: 'Model Cache', val: total.model_cache, color: 'bg-white/20' },
                            { label: 'Model Write', val: total.model_output, color: 'bg-white/20' },
                            { label: 'Tool In', val: total.tool_input, color: 'bg-white/20' },
                            { label: 'Tool Out', val: total.tool_output, color: 'bg-white/20' },
                            { label: 'Thinking In', val: total.thinking_input, color: 'bg-white/20' },
                            { label: 'Thinking Out', val: total.thinking_output, color: 'bg-white/20' },
                            { label: 'Tools', val: total.tools, color: 'bg-white/20' },
                          ].map(row => (
                            <div key={row.label}>
                              <div className="flex justify-between text-[11px] mb-1 font-medium">
                                <span>{row.label}</span>
                                <span>{row.val.toLocaleString()}</span>
                              </div>
                              <div className="h-1.5 w-full bg-black/10 rounded-full overflow-hidden">
                                <div 
                                  className={`h-full bg-white transition-all duration-1000`} 
                                  style={{ width: `${(row.val / max) * 100}%` }}
                                />
                              </div>
                            </div>
                          ))}
                        </div>
                      );
                    })()}
                  </div>

                  {analysis && (
                    <button 
                      onClick={() => {
                        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(analysis, null, 2));
                        const downloadAnchorNode = document.createElement('a');
                        downloadAnchorNode.setAttribute("href",     dataStr);
                        downloadAnchorNode.setAttribute("download", `analysis-${selectedSessionId}.json`);
                        document.body.appendChild(downloadAnchorNode);
                        downloadAnchorNode.click();
                        downloadAnchorNode.remove();
                      }}
                      className="w-full py-3 bg-gray-900 hover:bg-black text-white rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all shadow-md active:scale-95"
                    >
                      <ArrowUpRight size={14} /> Export Framed Session
                    </button>
                  )}
                </div>
              </aside>
            </div>
          </>
        ) : (
          <div className="flex-1 overflow-y-auto px-8 py-10 bg-gray-50/30">
            <div className="max-w-5xl mx-auto">
              <div className="mb-6">
                <h2 className="text-xl font-bold text-gray-900">Projects</h2>
                <p className="text-sm text-gray-500">Select a session from any project to begin inspection.</p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {projects.map(project => (
                  <div key={`landing-${project.id}`} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
                    <div
                      className="text-sm font-semibold text-gray-900 mb-3 block min-w-0 overflow-hidden whitespace-nowrap"
                      title={project.name}
                    >
                      {compactProjectPath(project.name, 64)}
                    </div>
                    <div className="border-t border-gray-200 mb-2"></div>
                    <div className="space-y-1 max-h-56 overflow-y-auto">
                      {project.sessions.map(session => (
                        <button
                          key={`landing-session-${project.id}-${session.id}`}
                          onClick={() => selectSession(session.id, project.id)}
                          className="w-full text-left px-3 py-2 rounded-lg hover:bg-gray-50 border border-transparent hover:border-gray-100"
                        >
                          <div className="text-sm font-medium text-gray-700 truncate">{session.title}</div>
                          <div className="text-[10px] text-gray-400 font-mono truncate">{session.id}</div>
                          <div className="text-[10px] text-gray-400">{formatSessionDateTime(session.mtime)}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
        {selectedSessionId && activeSubagentId && (
          <SubagentModal 
            agentId={activeSubagentId} 
            onClose={() => setActiveSubagentId(null)} 
          />
        )}
      </main>
    </div>
  );
}

const get_content_text = (content: any): string => {
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

export default App;
