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

export interface Analysis {
  frames: Frame[];
}
