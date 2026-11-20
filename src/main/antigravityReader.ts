import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { parseTimestampMs } from '../shared/time.js';
import type {
  ActivityPhase,
  ConversationItem,
  ConversationSource,
  MonitorSnapshot,
  SourceHealth,
  SubagentSummary,
} from '../shared/types.js';

interface RawSummaryRow {
  conversation_id: string;
  title: string;
  step_count: number;
  last_modified_time: string;
  workspace_uris: string;
  status: string;
  parent_conversation_id: string;
  nesting_depth: number;
  not_fully_idle: number;
  killed: number;
  last_user_input_time: string;
}

interface TranscriptTailInfo {
  startedAt: string | null;
  lastStepAt: string | null;
  mtimeMs: number;
  lastStepType: string | null;
  lastStepStatus: string | null;
  lastToolName: string | null;
  waitingForInput: boolean;
}

interface CachedTranscriptState {
  mtimeMs: number;
  size: number;
  info: TranscriptTailInfo;
}

interface AnnotationInfo {
  lastUserViewMs: number | null;
  archived: boolean;
}

interface CachedAnnotationState {
  mtimeMs: number;
  size: number;
  info: AnnotationInfo;
}

const STALL_THRESHOLD_MS = 10 * 60 * 1000;
const MAX_RECENT_IDLE = 10;
const MAX_IDLE_SCAN = 30;
const UNREAD_GRACE_MS = 1000;
const UNREAD_MAX_AGE_MS = 30 * 60 * 1000;
const HEAD_READ_BYTES = 4096;
const TAIL_READ_BYTES = 32768;
const MAX_CACHE_ENTRIES = 250;

const startedAtCache = new Map<string, string | null>();
const tailCache = new Map<string, CachedTranscriptState>();
const annotationCache = new Map<string, CachedAnnotationState>();

function setBoundedCache<K, V>(map: Map<K, V>, key: K, value: V): void {
  if (map.size >= MAX_CACHE_ENTRIES && !map.has(key)) {
    const oldestKey = map.keys().next().value;
    if (oldestKey !== undefined) {
      map.delete(oldestKey);
    }
  }
  map.set(key, value);
}

export interface ReaderOptions {
  geminiRootDir?: string;
  includeCli?: boolean;
  nowMs?: number;
  dismissedUnread?: Record<string, number>;
}

export function getDefaultGeminiRootDir(): string {
  return path.join(os.homedir(), '.gemini');
}

export function getSourceDirs(
  geminiRootDir: string,
  includeCli: boolean
): Array<{ source: ConversationSource; label: string; dirPath: string; dbPath: string }> {
  const sources: Array<{
    source: ConversationSource;
    label: string;
    dirPath: string;
    dbPath: string;
  }> = [
    {
      source: 'desktop',
      label: 'Antigravity App / IDE',
      dirPath: path.join(geminiRootDir, 'antigravity'),
      dbPath: path.join(geminiRootDir, 'antigravity', 'conversation_summaries.db'),
    },
  ];

  if (includeCli) {
    sources.push({
      source: 'cli',
      label: 'Antigravity CLI (agy)',
      dirPath: path.join(geminiRootDir, 'antigravity-cli'),
      dbPath: path.join(geminiRootDir, 'antigravity-cli', 'conversation_summaries.db'),
    });
  }

  return sources;
}

export function parseWorkspaceUri(rawUrisJson: string): {
  workspaceUri: string | null;
  workspacePath: string | null;
  workspaceName: string | null;
} {
  if (!rawUrisJson || !rawUrisJson.trim()) {
    return { workspaceUri: null, workspacePath: null, workspaceName: null };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawUrisJson);
  } catch {
    return { workspaceUri: null, workspacePath: null, workspaceName: null };
  }

  if (!Array.isArray(parsed) || parsed.length === 0 || typeof parsed[0] !== 'string') {
    return { workspaceUri: null, workspacePath: null, workspaceName: null };
  }

  const uri = parsed[0];
  let fsPath: string | null = null;
  if (uri.startsWith('file:///')) {
    const rawPath = decodeURIComponent(uri.slice('file:///'.length));
    fsPath = /^[a-zA-Z]:/.test(rawPath) ? path.normalize(rawPath) : path.normalize('/' + rawPath);
  } else if (uri.startsWith('file://')) {
    fsPath = path.normalize(decodeURIComponent(uri.slice('file://'.length)));
  } else {
    fsPath = uri;
  }

  const base = fsPath ? path.basename(fsPath) : null;
  return {
    workspaceUri: uri,
    workspacePath: fsPath,
    workspaceName: base && base.length > 0 ? base : fsPath,
  };
}

function readTranscriptStartedAt(transcriptPath: string): string | null {
  if (startedAtCache.has(transcriptPath)) {
    return startedAtCache.get(transcriptPath) ?? null;
  }

  let fd: number | null = null;
  try {
    fd = fs.openSync(transcriptPath, 'r');
    const buf = Buffer.allocUnsafe(HEAD_READ_BYTES);
    const bytesRead = fs.readSync(fd, buf, 0, HEAD_READ_BYTES, 0);
    if (bytesRead <= 0) return null;

    const headText = buf.subarray(0, bytesRead).toString('utf-8');
    const newlineIdx = headText.indexOf('\n');
    const firstLine = (newlineIdx === -1 ? headText : headText.slice(0, newlineIdx)).trim();
    if (!firstLine) return null;

    const entry = JSON.parse(firstLine) as { created_at?: unknown };
    const createdAt = typeof entry.created_at === 'string' ? entry.created_at : null;
    if (createdAt) {
      setBoundedCache(startedAtCache, transcriptPath, createdAt);
    }
    return createdAt;
  } catch {
    return null;
  } finally {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch {
        // Ignore close failure on read handle
      }
    }
  }
}

function extractWaitingFromStep(entry: Record<string, unknown>): {
  lastStepAt: string | null;
  lastStepType: string | null;
  lastStepStatus: string | null;
  lastToolName: string | null;
  waitingForInput: boolean;
} {
  const lastStepAt = typeof entry.created_at === 'string' ? entry.created_at : null;
  const lastStepType = typeof entry.type === 'string' ? entry.type : null;
  const lastStepStatus = typeof entry.status === 'string' ? entry.status : null;
  const toolCalls = Array.isArray(entry.tool_calls) ? entry.tool_calls : [];

  let lastToolName: string | null = null;
  let waitingForInput = false;

  if (toolCalls.length > 0) {
    const lastCall = toolCalls[toolCalls.length - 1] as Record<string, unknown> | undefined;
    if (lastCall && typeof lastCall.name === 'string') {
      lastToolName = lastCall.name;
    }

    const callsWaitingTool = toolCalls.some((tc) => {
      if (!tc || typeof tc !== 'object') return false;
      const record = tc as Record<string, unknown>;
      if (record.name === 'ask_question') return true;
      if (record.name === 'notify_user' && record.args && typeof record.args === 'object') {
        const args = record.args as Record<string, unknown>;
        return args.BlockedOnUser === true;
      }
      return false;
    });

    if (lastStepType === 'PLANNER_RESPONSE' && lastStepStatus === 'DONE' && callsWaitingTool) {
      waitingForInput = true;
    }
  }

  return { lastStepAt, lastStepType, lastStepStatus, lastToolName, waitingForInput };
}

export function readTranscriptTail(transcriptPath: string): TranscriptTailInfo | null {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(transcriptPath);
  } catch {
    return null;
  }

  const cached = tailCache.get(transcriptPath);
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
    return cached.info;
  }

  const startedAt = readTranscriptStartedAt(transcriptPath);
  let fd: number | null = null;
  try {
    fd = fs.openSync(transcriptPath, 'r');
    const readSize = Math.min(stat.size, TAIL_READ_BYTES);
    const startOffset = Math.max(0, stat.size - readSize);
    const buf = Buffer.allocUnsafe(readSize);
    const bytesRead = fs.readSync(fd, buf, 0, readSize, startOffset);
    const tailText = buf.subarray(0, bytesRead).toString('utf-8');
    const lines = tailText.split(/\r?\n/).filter((line) => line.trim().length > 0);

    let lastStepAt: string | null = null;
    let lastStepType: string | null = null;
    let lastStepStatus: string | null = null;
    let lastToolName: string | null = null;
    let waitingForInput = false;

    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const entry = JSON.parse(lines[i]) as Record<string, unknown>;
        const extracted = extractWaitingFromStep(entry);
        lastStepAt = extracted.lastStepAt;
        lastStepType = extracted.lastStepType;
        lastStepStatus = extracted.lastStepStatus;
        lastToolName = extracted.lastToolName;
        waitingForInput = extracted.waitingForInput;
        break;
      } catch {
        // Last partial line or truncated chunk boundary; try previous complete line
      }
    }

    const info: TranscriptTailInfo = {
      startedAt,
      lastStepAt,
      mtimeMs: stat.mtimeMs,
      lastStepType,
      lastStepStatus,
      lastToolName,
      waitingForInput,
    };
    setBoundedCache(tailCache, transcriptPath, { mtimeMs: stat.mtimeMs, size: stat.size, info });
    return info;
  } catch {
    return null;
  } finally {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch {
        // Ignore close failure on read handle
      }
    }
  }
}

export function readAnnotationInfo(annotationPath: string): AnnotationInfo | null {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(annotationPath);
  } catch {
    return null;
  }

  const cached = annotationCache.get(annotationPath);
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
    return cached.info;
  }

  try {
    const raw = fs.readFileSync(annotationPath, 'utf-8');
    const archived = /\barchived\s*:\s*true\b/.test(raw);
    const viewMatch = raw.match(
      /last_user_view_time\s*:\s*\{\s*seconds\s*:\s*(\d+)(?:\s+nanos\s*:\s*(\d+))?\s*\}/
    );
    const lastUserViewMs = viewMatch
      ? Number(viewMatch[1]) * 1000 + Math.floor(Number(viewMatch[2] ?? 0) / 1e6)
      : null;

    const info: AnnotationInfo = {
      lastUserViewMs: lastUserViewMs !== null && Number.isFinite(lastUserViewMs) ? lastUserViewMs : null,
      archived,
    };
    setBoundedCache(annotationCache, annotationPath, {
      mtimeMs: stat.mtimeMs,
      size: stat.size,
      info,
    });
    return info;
  } catch {
    return null;
  }
}

export function classifyPhase(params: {
  status: string;
  notFullyIdle: number;
  waitingForInput: boolean;
  lastModifiedMs: number | null;
  nowMs: number;
}): ActivityPhase {
  const isRunningFlag = params.status === 'CASCADE_RUN_STATUS_RUNNING' || params.notFullyIdle === 1;
  if (!isRunningFlag) {
    return 'idle';
  }
  if (params.waitingForInput) {
    return 'waiting_input';
  }
  if (params.lastModifiedMs !== null && params.nowMs - params.lastModifiedMs > STALL_THRESHOLD_MS) {
    return 'stalled';
  }
  return 'running';
}

function toIsoOrNull(raw: string | null | undefined): string | null {
  const ms = parseTimestampMs(raw);
  return ms === null ? null : new Date(ms).toISOString();
}

function readSource(
  source: ConversationSource,
  label: string,
  dirPath: string,
  dbPath: string,
  nowMs: number,
  dismissedUnread?: Record<string, number>
): {
  running: ConversationItem[];
  unread: ConversationItem[];
  recentIdle: ConversationItem[];
  health: SourceHealth;
} {
  if (!fs.existsSync(dbPath)) {
    return {
      running: [],
      unread: [],
      recentIdle: [],
      health: {
        source,
        label,
        dbPath,
        ok: false,
        error: `Database file not found at ${dbPath}`,
      },
    };
  }

  let db: DatabaseSync | null = null;
  try {
    db = new DatabaseSync(dbPath, { readOnly: true, timeout: 1500 });

    const runningRows = db
      .prepare(
        `SELECT
           conversation_id,
           title,
           step_count,
           last_modified_time,
           workspace_uris,
           status,
           parent_conversation_id,
           nesting_depth,
           not_fully_idle,
           killed,
           last_user_input_time
         FROM conversation_summaries
         WHERE killed = 0
           AND (status = 'CASCADE_RUN_STATUS_RUNNING' OR not_fully_idle = 1)
         ORDER BY last_modified_time DESC`
      )
      .all() as unknown as RawSummaryRow[];

    const recentRows = db
      .prepare(
        `SELECT
           conversation_id,
           title,
           step_count,
           last_modified_time,
           workspace_uris,
           status,
           parent_conversation_id,
           nesting_depth,
           not_fully_idle,
           killed,
           last_user_input_time
         FROM conversation_summaries
         WHERE killed = 0
           AND nesting_depth = 0
           AND status != 'CASCADE_RUN_STATUS_RUNNING'
           AND not_fully_idle = 0
         ORDER BY last_modified_time DESC
         LIMIT ?`
      )
      .all(MAX_IDLE_SCAN) as unknown as RawSummaryRow[];

    const seenIds = new Set<string>();
    const rows: RawSummaryRow[] = [];
    for (const r of [...runningRows, ...recentRows]) {
      if (!seenIds.has(r.conversation_id)) {
        seenIds.add(r.conversation_id);
        rows.push(r);
      }
    }

    const topLevelItems: ConversationItem[] = [];
    const runningSubagentsByParent = new Map<string, SubagentSummary[]>();
    const orphanRunningSubagents: ConversationItem[] = [];

    for (const row of rows) {
      const lastModifiedMs = parseTimestampMs(row.last_modified_time);

      const transcriptCandidate = path.join(
        dirPath,
        'brain',
        row.conversation_id,
        '.system_generated',
        'logs',
        'transcript.jsonl'
      );
      const transcriptExists = fs.existsSync(transcriptCandidate);
      const tail = transcriptExists ? readTranscriptTail(transcriptCandidate) : null;
      const transcriptStepMs = parseTimestampMs(tail?.lastStepAt);
      const effectiveModifiedMs =
        transcriptStepMs !== null && (lastModifiedMs === null || transcriptStepMs > lastModifiedMs)
          ? transcriptStepMs
          : lastModifiedMs;
      const effectiveModifiedIso =
        effectiveModifiedMs !== null ? new Date(effectiveModifiedMs).toISOString() : null;

      const phase = classifyPhase({
        status: row.status,
        notFullyIdle: row.not_fully_idle,
        waitingForInput: tail?.waitingForInput ?? false,
        lastModifiedMs: effectiveModifiedMs,
        nowMs,
      });

      if (row.nesting_depth > 0) {
        if (phase !== 'idle' && row.parent_conversation_id) {
          const list = runningSubagentsByParent.get(row.parent_conversation_id) ?? [];
          list.push({
            conversationId: row.conversation_id,
            title: row.title.trim() || null,
            status: row.status,
            phase,
            stepCount: row.step_count,
            lastUserInputAt: toIsoOrNull(row.last_user_input_time),
            lastModifiedAt: effectiveModifiedIso,
          });
          runningSubagentsByParent.set(row.parent_conversation_id, list);
          continue;
        }
        if (phase === 'idle') {
          continue;
        }
      }

      const annotationPath = path.join(dirPath, 'annotations', `${row.conversation_id}.pbtxt`);
      const annotation = row.nesting_depth === 0 ? readAnnotationInfo(annotationPath) : null;
      const lastUserViewMs = annotation?.lastUserViewMs ?? null;
      const lastUserViewAt = lastUserViewMs !== null ? new Date(lastUserViewMs).toISOString() : null;
      const dismissedAtMs = dismissedUnread?.[row.conversation_id];
      const isDismissed =
        typeof dismissedAtMs === 'number' &&
        lastModifiedMs !== null &&
        lastModifiedMs <= dismissedAtMs;
      const isUnread =
        phase === 'idle' &&
        !isDismissed &&
        annotation !== null &&
        !annotation.archived &&
        lastUserViewMs !== null &&
        lastModifiedMs !== null &&
        lastModifiedMs - lastUserViewMs > UNREAD_GRACE_MS &&
        nowMs - lastModifiedMs <= UNREAD_MAX_AGE_MS;

      const ws = parseWorkspaceUri(row.workspace_uris);
      const item: ConversationItem = {
        conversationId: row.conversation_id,
        source,
        title: row.title.trim() || null,
        workspaceUri: ws.workspaceUri,
        workspacePath: ws.workspacePath,
        workspaceName: ws.workspaceName,
        status: row.status,
        phase,
        stepCount: row.step_count,
        nestingDepth: row.nesting_depth,
        parentConversationId: row.parent_conversation_id.trim() || null,
        startedAt: tail?.startedAt ? toIsoOrNull(tail.startedAt) : null,
        lastUserInputAt: toIsoOrNull(row.last_user_input_time),
        lastModifiedAt: effectiveModifiedIso,
        lastUserViewAt,
        unread: isUnread,
        lastStepType: tail?.lastStepType ?? null,
        lastStepStatus: tail?.lastStepStatus ?? null,
        lastToolName: tail?.lastToolName ?? null,
        waitingSinceAt:
          phase === 'waiting_input'
            ? (tail?.lastStepAt ? toIsoOrNull(tail.lastStepAt) : effectiveModifiedIso)
            : null,
        transcriptPath: transcriptExists ? transcriptCandidate : null,
        activeSubagents: [],
      };

      if (row.nesting_depth > 0) {
        orphanRunningSubagents.push(item);
      } else {
        topLevelItems.push(item);
      }
    }

    const topLevelById = new Map(topLevelItems.map((item) => [item.conversationId, item]));
    for (const [parentId, children] of runningSubagentsByParent.entries()) {
      const parent = topLevelById.get(parentId);
      if (parent) {
        parent.activeSubagents = children;
      } else {
        for (const child of children) {
          orphanRunningSubagents.push({
            conversationId: child.conversationId,
            source,
            title: child.title,
            workspaceUri: null,
            workspacePath: null,
            workspaceName: null,
            status: child.status,
            phase: child.phase,
            stepCount: child.stepCount,
            nestingDepth: 1,
            parentConversationId: parentId,
            startedAt: null,
            lastUserInputAt: child.lastUserInputAt,
            lastModifiedAt: child.lastModifiedAt,
            lastUserViewAt: null,
            unread: false,
            lastStepType: null,
            lastStepStatus: null,
            lastToolName: null,
            waitingSinceAt: child.phase === 'waiting_input' ? child.lastModifiedAt : null,
            transcriptPath: null,
            activeSubagents: [],
          });
        }
      }
    }

    const all = [...topLevelItems, ...orphanRunningSubagents];
    const running = all.filter((item) => item.phase !== 'idle');
    const unread = all.filter((item) => item.phase === 'idle' && item.unread);
    const recentIdle = all
      .filter((item) => item.phase === 'idle' && !item.unread)
      .slice(0, MAX_RECENT_IDLE);

    return {
      running,
      unread,
      recentIdle,
      health: { source, label, dbPath, ok: true, error: null },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      running: [],
      unread: [],
      recentIdle: [],
      health: { source, label, dbPath, ok: false, error: message },
    };
  } finally {
    if (db) {
      try {
        db.close();
      } catch {
        // Ignore close failure on read-only DB handle
      }
    }
  }
}

export function readMonitorSnapshot(options: ReaderOptions = {}): MonitorSnapshot {
  const geminiRootDir = options.geminiRootDir ?? getDefaultGeminiRootDir();
  const includeCli = options.includeCli ?? true;
  const nowMs = options.nowMs ?? Date.now();

  const sourceConfigs = getSourceDirs(geminiRootDir, includeCli);
  const running: ConversationItem[] = [];
  const unread: ConversationItem[] = [];
  const recentIdle: ConversationItem[] = [];
  const sources: SourceHealth[] = [];

  for (const cfg of sourceConfigs) {
    const result = readSource(
      cfg.source,
      cfg.label,
      cfg.dirPath,
      cfg.dbPath,
      nowMs,
      options.dismissedUnread
    );
    running.push(...result.running);
    unread.push(...result.unread);
    recentIdle.push(...result.recentIdle);
    sources.push(result.health);
  }

  unread.sort((a, b) => {
    const aMs = parseTimestampMs(a.lastModifiedAt) ?? 0;
    const bMs = parseTimestampMs(b.lastModifiedAt) ?? 0;
    return bMs - aMs;
  });

  recentIdle.sort((a, b) => {
    const aMs = parseTimestampMs(a.lastModifiedAt) ?? 0;
    const bMs = parseTimestampMs(b.lastModifiedAt) ?? 0;
    return bMs - aMs;
  });

  return {
    capturedAt: new Date(nowMs).toISOString(),
    running,
    unread,
    recentIdle: recentIdle.slice(0, MAX_RECENT_IDLE),
    sources,
  };
}
