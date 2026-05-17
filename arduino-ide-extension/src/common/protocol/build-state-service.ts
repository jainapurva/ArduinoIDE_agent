/**
 * BuildStateService — captures the latest build (compile/upload) result
 * so the AI agent can see build errors from manual toolbar operations.
 */

export const BuildStateServicePath = '/services/build-state';
export const BuildStateService = Symbol('BuildStateService');

export interface BuildState {
  /** Full stdout from the build */
  output: string;
  /** Error details (compiler errors, upload errors) */
  errors: string;
  /** ISO timestamp of when the build completed */
  timestamp: string;
  /** Whether the build succeeded */
  success: boolean;
}

export interface BuildStateService {
  getLastBuild(): Promise<BuildState | undefined>;
  setLastBuild(state: BuildState): Promise<void>;
}
