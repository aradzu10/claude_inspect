import { Analysis, FinalizedAnalysis, LegacyAnalysis } from '../types';

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

export const isLegacyAnalysis = (value: unknown): value is LegacyAnalysis => (
  isObject(value) && Array.isArray(value.frames)
);

export const isFinalizedAnalysis = (value: unknown): value is FinalizedAnalysis => (
  isObject(value)
  && Array.isArray(value.conversations)
  && Array.isArray(value.sub_agent_analyses)
  && Array.isArray(value.suggestions)
);

export const isAnalysisPayload = (value: unknown): value is Analysis => (
  isLegacyAnalysis(value) || isFinalizedAnalysis(value)
);

export type AnalysisMode = 'none' | 'legacy' | 'finalized' | 'invalid';

export const getAnalysisMode = (value: unknown): AnalysisMode => {
  if (value == null) return 'none';
  if (isLegacyAnalysis(value)) return 'legacy';
  if (isFinalizedAnalysis(value)) return 'finalized';
  return 'invalid';
};
