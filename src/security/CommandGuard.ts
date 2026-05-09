import { DANGEROUS_PATTERNS } from '../shared/constants'

export interface GuardResult {
  safe: boolean
  reason?: string
  requiresConfirmation?: boolean
}

const CONFIRM_PATTERNS: RegExp[] = [
  // Git / deploy operations
  /git\s+push(?!\s+--dry-run)/i,
  /git\s+reset/i,
  /npm\s+publish/i,
  /docker\s+rm/i,
  /kubectl\s+delete/i,
  /terraform\s+destroy/i,
  // File system modifications
  /\bmkdir\b/i,
  /\btouch\b/i,
  /\bcp\b/i,
  /\bmv\b/i,
  /\brename\b/i,
  /\brm\b/i,
  /\brmdir\b/i,
]

export class CommandGuard {
  static check(command: string): GuardResult {
    const cmd = command.trim()

    for (const pattern of DANGEROUS_PATTERNS) {
      if (pattern.test(cmd)) {
        return {
          safe: false,
          reason: `Dangerous command blocked (pattern: ${pattern.source})`,
        }
      }
    }

    for (const pattern of CONFIRM_PATTERNS) {
      if (pattern.test(cmd)) {
        return {
          safe: true,
          requiresConfirmation: true,
          reason: 'This command may have irreversible effects',
        }
      }
    }

    return { safe: true }
  }
}
