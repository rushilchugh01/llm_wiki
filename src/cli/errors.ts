export class CliError extends Error {
  readonly exitCode: number

  constructor(message: string, exitCode = 1) {
    super(message)
    this.name = "CliError"
    this.exitCode = exitCode
  }
}

export function assertCli(
  condition: unknown,
  message: string,
  exitCode = 1,
): asserts condition {
  if (!condition) throw new CliError(message, exitCode)
}
