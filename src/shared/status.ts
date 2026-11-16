import { parseTimestampMs } from './time.js';
import type { ActivityPhase, ConversationItem, SortMode } from './types.js';

export const QUESTION_OVERDUE_MS = 5 * 60 * 1000;

export function getQuestionWaitMs(item: ConversationItem, nowMs: number): number | null {
  if (item.phase !== 'waiting_input') return null;
  const sinceMs =
    parseTimestampMs(item.waitingSinceAt) ??
    parseTimestampMs(item.lastModifiedAt) ??
    parseTimestampMs(item.lastUserInputAt);
  if (sinceMs === null) return null;
  return Math.max(0, nowMs - sinceMs);
}

export function isQuestionOverdue(item: ConversationItem, nowMs: number): boolean {
  const waitMs = getQuestionWaitMs(item, nowMs);
  return waitMs !== null && waitMs > QUESTION_OVERDUE_MS;
}

const ACTION_PRIORITY: Record<ActivityPhase, number> = {
  waiting_input: 1,
  stalled: 2,
  running: 3,
  idle: 4,
};

function getActionRank(item: ConversationItem, nowMs: number): number {
  if (isQuestionOverdue(item, nowMs)) return 0;
  return ACTION_PRIORITY[item.phase];
}

export function sortConversations(
  items: ConversationItem[],
  mode: SortMode,
  nowMs: number
): ConversationItem[] {
  return [...items].sort((a, b) => {
    if (mode === 'action_needed') {
      const rankDiff = getActionRank(a, nowMs) - getActionRank(b, nowMs);
      if (rankDiff !== 0) return rankDiff;

      if (a.phase === 'waiting_input' && b.phase === 'waiting_input') {
        const aWait = getQuestionWaitMs(a, nowMs) ?? 0;
        const bWait = getQuestionWaitMs(b, nowMs) ?? 0;
        if (aWait !== bWait) return bWait - aWait;
      }

      const aStart = parseTimestampMs(a.lastUserInputAt) ?? Number.MAX_SAFE_INTEGER;
      const bStart = parseTimestampMs(b.lastUserInputAt) ?? Number.MAX_SAFE_INTEGER;
      if (aStart !== bStart) return aStart - bStart;
    }

    if (mode === 'duration') {
      const aStart = parseTimestampMs(a.lastUserInputAt) ?? Number.MAX_SAFE_INTEGER;
      const bStart = parseTimestampMs(b.lastUserInputAt) ?? Number.MAX_SAFE_INTEGER;
      if (aStart !== bStart) return aStart - bStart;
    }

    const aMod = parseTimestampMs(a.lastModifiedAt) ?? 0;
    const bMod = parseTimestampMs(b.lastModifiedAt) ?? 0;
    return bMod - aMod;
  });
}
