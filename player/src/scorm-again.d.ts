declare module "scorm-again/scorm12" {
  export class Scorm12API {
    constructor(settings?: Record<string, unknown>);
    loadFromJSON(json: Record<string, unknown>, element?: string): void;
    on(event: string, callback: (...args: unknown[]) => void): void;
    renderCMIToJSONObject(): Record<string, unknown>;
    LMSCommit(parameter?: string): string;
    LMSFinish(parameter?: string): string;
  }
}

declare module "scorm-again/scorm2004" {
  export class Scorm2004API {
    constructor(settings?: Record<string, unknown>);
    settings: {
      lmsCommitUrl: string | boolean;
      [key: string]: unknown;
    };
    loadFromJSON(json: Record<string, unknown>, element?: string): void;
    on(event: string, callback: (...args: unknown[]) => void): void;
    renderCMIToJSONObject(): Record<string, unknown>;
    Commit(parameter?: string): string;
    Terminate(parameter?: string): string;
    SetValue(element: string, value: string): string;
    isInitialized?(): boolean;
    reset?(options?: { preserveListeners?: boolean; resetTotalTime?: boolean }): void;
    setSequencingEventListeners(listeners: Record<string, unknown>): void;
    processNavigationRequest(request: string, targetActivityId?: string): boolean;
    loadSequencingState(metadata?: Record<string, unknown>): Promise<boolean>;
    saveSequencingState(metadata?: Record<string, unknown>): Promise<boolean>;
    getSequencingState?(): {
      currentActivity?: { id: string; title?: string } | null;
      isInitialized?: boolean;
      isActive?: boolean;
    };
    getSequencingService?(): {
      sequencing?: {
        activityTree?: { suspendedActivity?: { id: string } | null };
      };
      getOverallSequencingProcess?: () => {
        updateNavigationValidity?: () => void;
      } | null;
    } | null;
    previewNavigationRequest?(request: "continue" | "previous"): {
      outcome: "allowed" | "blocked" | "unknown";
      targetActivityId: string | null;
      endSequencingSession: boolean;
      exception: string | null;
    };
  }
}
