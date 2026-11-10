declare module "scorm-again/scorm12" {
  export class Scorm12API {
    constructor(settings?: Record<string, unknown>);
    loadFromJSON(json: Record<string, unknown>, element?: string): void;
    on(event: string, callback: (...args: unknown[]) => void): void;
    renderCMIToJSONObject(): Record<string, unknown>;
    LMSFinish(parameter?: string): string;
  }
}

declare module "scorm-again/scorm2004" {
  export class Scorm2004API {
    constructor(settings?: Record<string, unknown>);
    loadFromJSON(json: Record<string, unknown>, element?: string): void;
    on(event: string, callback: (...args: unknown[]) => void): void;
    renderCMIToJSONObject(): Record<string, unknown>;
    Terminate(parameter?: string): string;
  }
}
