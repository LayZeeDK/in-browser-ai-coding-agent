export {};

/** Context values provided by globalSetup via Vitest `provide`/`inject`. */
declare module 'vitest' {
  export interface ProvidedContext {
    CI: boolean;
  }
}
