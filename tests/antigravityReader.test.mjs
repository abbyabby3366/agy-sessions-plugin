import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, it } from 'node:test';
import {
  classifyPhase,
  parseWorkspaceUri,
  readMonitorSnapshot,
} from '../dist-electron/main/antigravityReader.js';
import {
  getQuestionWaitMs,
  isQuestionOverdue,
  resolveAlwaysOnTop,
  sortConversations,
} from '../dist-electron/shared/status.js';
import {
  formatDateTimeGMT8,
  formatElapsed,
  parseTimestampMs,
} from '../dist-electron/shared/time.js';

const tempDirs = [];

function createTempRoot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-sticky-test-'));
  tempDirs.push(dir);
  return dir;
}

function createTestSummariesDb(dbPath, rows) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE conversation_summaries (
      conversation_id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT "",
      preview TEXT NOT NULL DEFAULT "",
      step_count INTEGER NOT NULL DEFAULT 0,
      last_modified_time DATETIME NOT NULL,
      workspace_uris TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT "",
      source TEXT NOT NULL DEFAULT "",
      project_id TEXT NOT NULL DEFAULT "",
      agent_name TEXT NOT NULL DEFAULT "",
      parent_conversation_id TEXT NOT NULL DEFAULT "",
      nesting_depth INTEGER NOT NULL DEFAULT 0,
      battle_id TEXT NOT NULL DEFAULT "",
      winning_conversation_id TEXT NOT NULL DEFAULT "",
      not_fully_idle NUMERIC NOT NULL DEFAULT 0,
      killed NUMERIC NOT NULL DEFAULT 0,
      last_user_input_time DATETIME NOT NULL,
      last_user_input_step_index INTEGER NOT NULL DEFAULT -1,
      app_data_dir TEXT NOT NULL DEFAULT "",
      raw_summary BLOB,
      group_id TEXT NOT NULL DEFAULT ""
    );
  `);

  const stmt = db.prepare(`
    INSERT INTO conversation_summaries (
      conversation_id, title, step_count, last_modified_time, workspace_uris,
      status, parent_conversation_id, nesting_depth, not_fully_idle, killed,
      last_user_input_time, app_data_dir
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const r of rows) {
    stmt.run(
      r.conversation_id,
      r.title ?? '',
      r.step_count ?? 1,
      r.last_modified_time,
      r.workspace_uris ?? '[]',
      r.status,
      r.parent_conversation_id ?? '',
      r.nesting_depth ?? 0,
      r.not_fully_idle ?? 0,
      r.killed ?? 0,
      r.last_user_input_time,
      r.app_data_dir ?? 'antigravity'
    );
  }
  db.close();
}

function writeTranscript(rootDir, convId, lines) {
  const logPath = path.join(
    rootDir,
    'antigravity',
    'brain',
    convId,
    '.system_generated',
    'logs',
    'transcript.jsonl'
  );
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  fs.writeFileSync(
    logPath,
    lines.map((obj) => JSON.stringify(obj)).join('\n') + '\n',
    'utf-8'
  );
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('time helpers', () => {
  it('parses 7-digit fractional timestamps and formats GMT+8 DD-MM-YY', () => {
    const raw = '2026-11-16 06:27:43.7794974+00:00';
    const ms = parseTimestampMs(raw);
    assert.equal(ms, Date.UTC(2026, 10, 16, 6, 27, 43, 779));

    const gmt8 = formatDateTimeGMT8(raw);
    assert.deepEqual(gmt8, { date: '16-11-26', time: '14:27:43' });
  });

  it('returns null for invalid or missing timestamps instead of guessing', () => {
    assert.equal(parseTimestampMs(null), null);
    assert.equal(parseTimestampMs(''), null);
    assert.equal(parseTimestampMs('not-a-date'), null);
    assert.equal(formatDateTimeGMT8('invalid'), null);
  });

  it('formats elapsed durations cleanly', () => {
    assert.equal(formatElapsed(0), '00:00');
    assert.equal(formatElapsed(259_000), '04:19');
    assert.equal(formatElapsed(3_859_000), '1:04:19');
    assert.equal(formatElapsed(-500), '00:00');
  });
});

describe('parseWorkspaceUri', () => {
  it('extracts Windows path and folder name from file:/// URI', () => {
    const parsed = parseWorkspaceUri('["file:///c%3A/Users/desmo/Desktop/agy-custom"]');
    assert.equal(parsed.workspaceName, 'agy-custom');
    assert.ok(parsed.workspacePath?.toLowerCase().endsWith('agy-custom'));
  });

  it('returns nulls when workspace_uris is empty or invalid', () => {
    assert.deepEqual(parseWorkspaceUri('[]'), {
      workspaceUri: null,
      workspacePath: null,
      workspaceName: null,
    });
    assert.deepEqual(parseWorkspaceUri('bad-json'), {
      workspaceUri: null,
      workspacePath: null,
      workspaceName: null,
    });
  });
});

describe('readMonitorSnapshot', () => {
  it('detects running, waiting_input, stalled, subagents, and recent idle rows', () => {
    const rootDir = createTempRoot();
    const nowMs = Date.parse('2026-11-16T06:35:00.000Z');

    createTestSummariesDb(path.join(rootDir, 'antigravity', 'conversation_summaries.db'), [
      {
        conversation_id: 'conv-running',
        title: 'Build Sticky Widget',
        step_count: 14,
        last_modified_time: '2026-11-16 06:34:50.0000000+00:00',
        workspace_uris: '["file:///c%3A/Users/desmo/Desktop/agy-custom"]',
        status: 'CASCADE_RUN_STATUS_RUNNING',
        not_fully_idle: 1,
        last_user_input_time: '2026-11-16 06:30:00.0000000+00:00',
      },
      {
        conversation_id: 'conv-subagent',
        title: 'Subagent Task',
        step_count: 5,
        last_modified_time: '2026-11-16 06:34:55.0000000+00:00',
        workspace_uris: '["file:///c%3A/Users/desmo/Desktop/agy-custom"]',
        status: 'CASCADE_RUN_STATUS_RUNNING',
        parent_conversation_id: 'conv-running',
        nesting_depth: 1,
        not_fully_idle: 1,
        last_user_input_time: '2026-11-16 06:32:00.0000000+00:00',
      },
      {
        conversation_id: 'conv-waiting',
        title: 'Ask User Flow',
        step_count: 9,
        last_modified_time: '2026-11-16 06:20:00.0000000+00:00',
        workspace_uris: '["file:///c%3A/Users/desmo/Desktop/whatsapp-agent"]',
        status: 'CASCADE_RUN_STATUS_RUNNING',
        not_fully_idle: 1,
        last_user_input_time: '2026-11-16 06:18:00.0000000+00:00',
      },
      {
        conversation_id: 'conv-stalled',
        title: 'Hung Command',
        step_count: 4,
        last_modified_time: '2026-11-16 06:20:00.0000000+00:00',
        workspace_uris: '["file:///c%3A/Users/desmo/Desktop/aircon-kl"]',
        status: 'CASCADE_RUN_STATUS_RUNNING',
        not_fully_idle: 1,
        last_user_input_time: '2026-11-16 06:19:00.0000000+00:00',
      },
      {
        conversation_id: 'conv-transcript-active',
        title: 'DB Lagging Transcript Active',
        step_count: 12,
        last_modified_time: '2026-11-16 06:20:00.0000000+00:00',
        workspace_uris: '["file:///c%3A/Users/desmo/Desktop/aircon-kl"]',
        status: 'CASCADE_RUN_STATUS_RUNNING',
        not_fully_idle: 1,
        last_user_input_time: '2026-11-16 06:19:00.0000000+00:00',
      },
      {
        conversation_id: 'conv-idle',
        title: 'Completed Earlier',
        step_count: 8,
        last_modified_time: '2026-11-16 06:28:00.0000000+00:00',
        workspace_uris: '["file:///c%3A/Users/desmo/Desktop/goose-video"]',
        status: 'CASCADE_RUN_STATUS_IDLE',
        not_fully_idle: 0,
        last_user_input_time: '2026-11-16 06:22:00.0000000+00:00',
      },
    ]);

    writeTranscript(rootDir, 'conv-running', [
      { step_index: 0, type: 'USER_INPUT', status: 'DONE', created_at: '2026-11-16T06:10:00Z' },
      {
        step_index: 1,
        type: 'PLANNER_RESPONSE',
        status: 'DONE',
        created_at: '2026-11-16T06:34:50Z',
        tool_calls: [{ name: 'run_command' }],
      },
    ]);

    writeTranscript(rootDir, 'conv-waiting', [
      { step_index: 0, type: 'USER_INPUT', status: 'DONE', created_at: '2026-11-16T06:18:00Z' },
      {
        step_index: 1,
        type: 'PLANNER_RESPONSE',
        status: 'DONE',
        created_at: '2026-11-16T06:20:00Z',
        tool_calls: [{ name: 'ask_question' }],
      },
    ]);

    writeTranscript(rootDir, 'conv-transcript-active', [
      { step_index: 0, type: 'USER_INPUT', status: 'DONE', created_at: '2026-11-16T06:19:00Z' },
      { step_index: 1, type: 'GENERIC', status: 'DONE', created_at: '2026-11-16T06:33:30Z' },
    ]);

    const snapshot = readMonitorSnapshot({
      geminiRootDir: rootDir,
      includeCli: false,
      nowMs,
    });

    assert.equal(snapshot.sources[0].ok, true);
    assert.equal(snapshot.running.length, 4);
    assert.equal(snapshot.recentIdle.length, 1);

    const byId = new Map(snapshot.running.map((item) => [item.conversationId, item]));
    assert.equal(byId.get('conv-running')?.phase, 'running');
    assert.equal(byId.get('conv-running')?.activeSubagents.length, 1);
    assert.equal(byId.get('conv-running')?.startedAt, '2026-11-16T06:10:00.000Z');
    assert.equal(byId.get('conv-waiting')?.phase, 'waiting_input');
    assert.equal(byId.get('conv-waiting')?.waitingSinceAt, '2026-11-16T06:20:00.000Z');
    assert.equal(isQuestionOverdue(byId.get('conv-waiting'), nowMs), true);
    assert.equal(getQuestionWaitMs(byId.get('conv-waiting'), nowMs), 15 * 60 * 1000);
    assert.equal(byId.get('conv-stalled')?.phase, 'stalled');
    assert.equal(byId.get('conv-transcript-active')?.phase, 'running');
    assert.equal(byId.get('conv-transcript-active')?.lastModifiedAt, '2026-11-16T06:33:30.000Z');
  });

  it('surfaces explicit source health errors when DB is missing instead of hiding failure', () => {
    const rootDir = createTempRoot();
    const snapshot = readMonitorSnapshot({
      geminiRootDir: rootDir,
      includeCli: false,
    });

    assert.equal(snapshot.running.length, 0);
    assert.equal(snapshot.sources.length, 1);
    assert.equal(snapshot.sources[0].ok, false);
    assert.match(snapshot.sources[0].error ?? '', /Database file not found/);
  });

  it('returns the last 10 idle runs regardless of age without older cutoff', () => {
    const rootDir = createTempRoot();
    const rows = Array.from({ length: 12 }, (_, idx) => {
      const hour = String(idx).padStart(2, '0');
      return {
        conversation_id: `idle-${idx}`,
        title: `Idle Run ${idx}`,
        step_count: 5,
        last_modified_time: `2026-11-15 ${hour}:30:00.0000000+00:00`,
        workspace_uris: '["file:///c%3A/Users/desmo/Desktop/agy-custom"]',
        status: 'CASCADE_RUN_STATUS_IDLE',
        not_fully_idle: 0,
        last_user_input_time: `2026-11-15 ${hour}:10:00.0000000+00:00`,
      };
    });

    createTestSummariesDb(
      path.join(rootDir, 'antigravity', 'conversation_summaries.db'),
      rows
    );

    const snapshot = readMonitorSnapshot({
      geminiRootDir: rootDir,
      includeCli: false,
      nowMs: Date.parse('2026-11-16T07:00:00.000Z'),
    });

    assert.equal(snapshot.recentIdle.length, 10);
    assert.equal(snapshot.recentIdle[0].conversationId, 'idle-11');
    assert.equal(snapshot.recentIdle[9].conversationId, 'idle-2');
  });

  it('classifies phase transitions accurately', () => {
    const nowMs = 1_000_000;
    assert.equal(
      classifyPhase({
        status: 'CASCADE_RUN_STATUS_IDLE',
        notFullyIdle: 0,
        waitingForInput: false,
        lastModifiedMs: nowMs,
        nowMs,
      }),
      'idle'
    );
    assert.equal(
      classifyPhase({
        status: 'CASCADE_RUN_STATUS_RUNNING',
        notFullyIdle: 1,
        waitingForInput: true,
        lastModifiedMs: nowMs - 600_000,
        nowMs,
      }),
      'waiting_input'
    );
  });

  it('flags overdue questions >5m and sorts action_needed by urgency', () => {
    const nowMs = Date.parse('2026-11-16T07:10:00.000Z');
    const makeItem = (id, phase, waitingSinceAt, lastUserInputAt) => ({
      conversationId: id,
      source: 'desktop',
      title: id,
      workspaceUri: null,
      workspacePath: null,
      workspaceName: id,
      status: 'CASCADE_RUN_STATUS_RUNNING',
      phase,
      stepCount: 5,
      nestingDepth: 0,
      parentConversationId: null,
      startedAt: lastUserInputAt,
      lastUserInputAt,
      lastModifiedAt: waitingSinceAt ?? lastUserInputAt,
      lastStepType: 'PLANNER_RESPONSE',
      lastStepStatus: 'DONE',
      lastToolName: phase === 'waiting_input' ? 'ask_question' : null,
      waitingSinceAt,
      transcriptPath: null,
      activeSubagents: [],
    });

    const runningOld = makeItem('running-old', 'running', null, '2026-11-16T06:30:00.000Z');
    const stalled = makeItem('stalled-1', 'stalled', null, '2026-11-16T06:50:00.000Z');
    const freshQ = makeItem(
      'fresh-q',
      'waiting_input',
      '2026-11-16T07:07:00.000Z',
      '2026-11-16T07:05:00.000Z'
    );
    const overdueQ = makeItem(
      'overdue-q',
      'waiting_input',
      '2026-11-16T07:04:00.000Z',
      '2026-11-16T07:02:00.000Z'
    );

    assert.equal(isQuestionOverdue(freshQ, nowMs), false);
    assert.equal(isQuestionOverdue(overdueQ, nowMs), true);
    assert.equal(isQuestionOverdue(runningOld, nowMs), false);

    const sorted = sortConversations([runningOld, freshQ, stalled, overdueQ], 'action_needed', nowMs);
    assert.deepEqual(
      sorted.map((x) => x.conversationId),
      ['overdue-q', 'fresh-q', 'stalled-1', 'running-old']
    );

    const oldChatRecentPrompt = {
      ...makeItem('old-chat-recent-prompt', 'running', null, '2026-11-16T07:05:00.000Z'),
      startedAt: '2026-11-16T04:00:00.000Z',
    };

    const durationSorted = sortConversations(
      [runningOld, freshQ, stalled, overdueQ, oldChatRecentPrompt],
      'duration',
      nowMs
    );
    assert.deepEqual(
      durationSorted.map((x) => x.conversationId),
      ['overdue-q', 'fresh-q', 'running-old', 'stalled-1', 'old-chat-recent-prompt']
    );

    const activitySorted = sortConversations(
      [runningOld, freshQ, stalled, overdueQ],
      'activity',
      nowMs
    );
    assert.deepEqual(
      activitySorted.map((x) => x.conversationId),
      ['overdue-q', 'fresh-q', 'stalled-1', 'running-old']
    );

    assert.equal(resolveAlwaysOnTop('on_question', [runningOld, stalled]), false);
    assert.equal(resolveAlwaysOnTop('on_question', [runningOld, freshQ]), true);
    assert.equal(resolveAlwaysOnTop('always', []), true);
    assert.equal(resolveAlwaysOnTop('off', [overdueQ]), false);
  });
});
