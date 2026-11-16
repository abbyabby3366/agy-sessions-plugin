export type ConversationSource = 'desktop' | 'cli';

export type ActivityPhase =
  | 'running'
  | 'waiting_input'
  | 'stalled'
  | 'idle';

export type SortMode = 'duration' | 'action_needed' | 'activity';

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
  recentIdle: ConversationItem[];
  sources: SourceHealth[];
}

export interface WindowPreferences {
  alwaysOnTop: boolean;
  compactMode: boolean;
  showIdleRecent: boolean;
  includeCli: boolean;
  sortMode: SortMode;
  themePreference: 'system' | 'light' | 'dark';
  opacity: number;
}

export interface ActionResult {
  ok: boolean;
  error?: string;
}

export interface StickyMonitorApi {
  getSnapshot: () => Promise<MonitorSnapshot>;
  onSnapshot: (callback: (snapshot: MonitorSnapshot) => void) => () => void;
  getPreferences: () => Promise<WindowPreferences>;
  updatePreferences: (patch: Partial<WindowPreferences>) => Promise<WindowPreferences>;
  onPreferencesChanged: (callback: (prefs: WindowPreferences) => void) => () => void;
  minimizeWindow: () => Promise<void>;
  hideToTray: () => Promise<void>;
  closeWindow: () => Promise<void>;
  openPath: (targetPath: string) => Promise<ActionResult>;
  revealFile: (targetPath: string) => Promise<ActionResult>;
  copyText: (text: string) => Promise<ActionResult>;
}
