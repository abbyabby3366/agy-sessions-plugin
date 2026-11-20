export type ConversationSource = 'desktop' | 'cli';

export type ActivityPhase =
  | 'running'
  | 'waiting_input'
  | 'stalled'
  | 'idle';

export type SortMode = 'duration' | 'action_needed' | 'activity';

export type StickyMode = 'on_question' | 'always' | 'off';

export interface SubagentSummary {
  conversationId: string;
  title: string | null;
  status: string;
  phase: ActivityPhase;
  stepCount: number;
  lastUserInputAt: string | null;
  lastModifiedAt: string | null;
}

export interface ConversationItem {
  conversationId: string;
  source: ConversationSource;
  title: string | null;
  workspaceUri: string | null;
  workspacePath: string | null;
  workspaceName: string | null;
  status: string;
  phase: ActivityPhase;
  stepCount: number;
  nestingDepth: number;
  parentConversationId: string | null;
  startedAt: string | null;
  lastUserInputAt: string | null;
  lastModifiedAt: string | null;
  lastUserViewAt: string | null;
  unread: boolean;
  lastStepType: string | null;
  lastStepStatus: string | null;
  lastToolName: string | null;
  waitingSinceAt: string | null;
  transcriptPath: string | null;
  activeSubagents: SubagentSummary[];
}

export interface SourceHealth {
  source: ConversationSource;
  label: string;
  dbPath: string;
  ok: boolean;
  error: string | null;
}

export interface MonitorSnapshot {
  capturedAt: string;
  running: ConversationItem[];
  unread: ConversationItem[];
  recentIdle: ConversationItem[];
  sources: SourceHealth[];
}

export interface WindowPreferences {
  stickyMode: StickyMode;
  compactMode: boolean;
  showIdleRecent: boolean;
  idleExpanded: boolean;
  includeCli: boolean;
  sortMode: SortMode;
  themePreference: 'system' | 'light' | 'dark';
  opacity: number;
}

export interface ActionResult {
  ok: boolean;
  error?: string;
}

export interface ModelPoolQuota {
  weeklyRemainingPct: number;
  weeklyResetAt: string | null;
  fiveHourRemainingPct: number | null;
  fiveHourResetAt: string | null;
}

export type QuotaState =
  | { status: 'loading' }
  | {
      status: 'ok';
      fetchedAt: string;
      gemini: ModelPoolQuota;
      thirdParty: ModelPoolQuota;
    }
  | {
      status: 'error';
      error: string;
      fetchedAt: string;
    };

export interface StickyMonitorApi {
  getSnapshot: () => Promise<MonitorSnapshot>;
  onSnapshot: (callback: (snapshot: MonitorSnapshot) => void) => () => void;
  getQuota: () => Promise<QuotaState>;
  onQuotaChanged: (callback: (quota: QuotaState) => void) => () => void;
  getPreferences: () => Promise<WindowPreferences>;
  updatePreferences: (patch: Partial<WindowPreferences>) => Promise<WindowPreferences>;
  onPreferencesChanged: (callback: (prefs: WindowPreferences) => void) => () => void;
  minimizeWindow: () => Promise<void>;
  hideToTray: () => Promise<void>;
  closeWindow: () => Promise<void>;
  setContentHeight: (height: number) => Promise<void>;
  openPath: (targetPath: string) => Promise<ActionResult>;
  openInIde: (workspacePath: string) => Promise<ActionResult>;
  focusAntigravityApp: () => Promise<ActionResult>;
  revealFile: (targetPath: string) => Promise<ActionResult>;
  copyText: (text: string) => Promise<ActionResult>;
  markUnreadRead: (conversationIds: string[]) => Promise<ActionResult>;
}
