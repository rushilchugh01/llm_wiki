export interface DebugReporter {
  event: (event: string, fields?: Record<string, unknown>) => void
}

export const NOOP_DEBUG: DebugReporter = {
  event: () => {},
}

export function createDebugReporter(
  enabled: boolean,
  stderr: (text: string) => void,
): DebugReporter {
  if (!enabled) return NOOP_DEBUG
  return {
    event: (event, fields = {}) => {
      stderr(JSON.stringify({ level: "debug", event, ...fields }))
    },
  }
}
