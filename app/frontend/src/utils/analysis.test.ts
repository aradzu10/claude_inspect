import { describe, expect, it } from 'vitest';
import { getAnalysisMode, isAnalysisPayload, isFinalizedAnalysis, isLegacyAnalysis } from './analysis';

describe('analysis utils', () => {
  it('detects legacy analysis payload', () => {
    const payload = { frames: [] };
    expect(isLegacyAnalysis(payload)).toBe(true);
    expect(isFinalizedAnalysis(payload)).toBe(false);
    expect(isAnalysisPayload(payload)).toBe(true);
    expect(getAnalysisMode(payload)).toBe('legacy');
  });

  it('detects finalized analysis payload', () => {
    const payload = { conversations: [], sub_agent_analyses: [], suggestions: [] };
    expect(isFinalizedAnalysis(payload)).toBe(true);
    expect(isLegacyAnalysis(payload)).toBe(false);
    expect(isAnalysisPayload(payload)).toBe(true);
    expect(getAnalysisMode(payload)).toBe('finalized');
  });

  it('flags unknown analysis payload as invalid', () => {
    const payload = { conversation: [] };
    expect(isAnalysisPayload(payload)).toBe(false);
    expect(getAnalysisMode(payload)).toBe('invalid');
  });
});
