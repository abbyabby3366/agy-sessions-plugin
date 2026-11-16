import type { StickyMonitorApi } from '../shared/types.js';

declare global {
  interface Window {
    stickyMonitor: StickyMonitorApi;
  }
}

export {};
