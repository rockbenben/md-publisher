// Shared types mirroring the existing Express API contract (src/gui.js).

export interface Platform {
  id: string;
  name: string;
  icon: string;
  url: string;
}

export interface Article {
  title: string;
  description: string;
  date: string;
  cover?: string;
  filePath: string;
  fileName: string;
  manual?: boolean;
}

export interface ProjectConfig {
  platforms?: string[];
  category?: string[];
  tag?: string[];
}

export interface Settings {
  articleDir?: string;
  defaultPlatforms?: string[];
  loginStatus?: Record<string, LoginStatus>;
}

export interface LoginStatus {
  loggedIn: boolean;
  username?: string;
}

export interface DirEntry {
  name: string;
  path: string;
}

export interface BrowseDirResult {
  entries: DirEntry[];
  current: string;
  parent?: string;
  error?: string;
}

export interface PublishResult {
  success: boolean;
  platform: string;
  message?: string;
}

/** Per-platform dispatch state shown on the destination cards + postmark. */
export type DispatchStatus = 'idle' | 'running' | 'done' | 'error';

export interface DispatchInfo {
  status: DispatchStatus;
  /** HH:MM stamped into the postmark when dispatch completes. */
  time?: string;
}

export interface LogEntry {
  id: number;
  time: string;
  text: string;
  level?: 'error';
}
