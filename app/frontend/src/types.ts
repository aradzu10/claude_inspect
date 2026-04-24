export interface TokenUsage {
  input: number;
  output: number;
  thinking: number;
  tools: number;
  cache_creation: number;
  cache_read: number;
}

export interface ModelTokenUsage {
  read: number;
  cache: number;
  write: number;
}

export interface ToolTokenUsage {
  input: number;
  output: number;
}

export interface ThinkingTokenUsage {
  input: number;
  output: number;
}

export interface Event {
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

export interface Session {
  id: string;
  title: string;
  slug?: string;
  name?: string;
  path: string;
  size_mb: number;
  mtime?: number;
  project_name?: string;
  project_short_name?: string;
}

export interface ProjectGroup {
  id: string;
  name: string;
  short_name: string;
  sessions: Session[];
  latest_mtime?: number;
}

export interface SessionsResponse {
  recent_sessions: Session[];
  projects: ProjectGroup[];
}

export interface Frame {
  title: string;
  objective: string;
  suggestion: string;
  event_uuids: string[];
}

export interface LegacyAnalysis {
  frames: Frame[];
}

export interface AnalysisFrictionPoint {
  id: string;
  message_range: [number, number];
  description: string;
  evidence_quote: string;
}

export interface AnalysisConversationFrame {
  id: string;
  title: string;
  goal: string;
  outcome: 'success' | 'partial' | 'failed' | 'abandoned';
  message_range: [number, number];
  health: 'green' | 'yellow' | 'red';
  friction_points: Array<string | AnalysisFrictionPoint>;
}

export interface AnalysisSuggestion {
  id: string;
  category: 'add' | 'fix' | 'refactor';
  title?: string;
  addresses: string[];
  rationale: string;
  snippet: string;
  evidence?: Record<string, unknown>;
  token_estimation_save?: number;
  estimated_tokens_saved?: number;
  merged_from?: string[];
}

export interface AnalysisConversation {
  conversation_id?: string;
  agent_type?: string;
  frames: AnalysisConversationFrame[];
  friction_points?: AnalysisFrictionPoint[];
  suggestions: AnalysisSuggestion[];
}

export interface SubAgentActionOccurrence {
  conversation_id: string;
  message_range: [number, number];
}

export interface SubAgentSharedAction {
  id: string;
  action: string;
  appeared_in: SubAgentActionOccurrence[];
  category: 'environment' | 'project_context' | 'convention';
  orthogonality_rationale: string;
}

export interface SubAgentAnalysis {
  agent_type: string;
  inferred_purpose: string;
  invocation_count: number;
  conversation_ids: string[];
  shared_preamble_actions: SubAgentSharedAction[];
  suggestions: AnalysisSuggestion[];
}

export interface FinalizedAnalysis {
  conversations: AnalysisConversation[];
  sub_agent_analyses: SubAgentAnalysis[];
  suggestions: AnalysisSuggestion[];
}

export type Analysis = LegacyAnalysis | FinalizedAnalysis;
