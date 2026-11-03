import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

// Enforces CLAUDE.md rule 1: src/sim is pure, deterministic TypeScript.

const SIM_DIR = join(import.meta.dirname, '..')

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return name === '__tests__' ? [] : sourceFiles(path)
    return /\.tsx?$/.test(name) && !name.endsWith('.test.ts') ? [path] : []
  })
}

const FORBIDDEN: { pattern: RegExp; reason: string }[] = [
  { pattern: /from\s+['"](react|react-dom|pixi\.js)(\/[^'"]*)?['"]/, reason: 'UI/render library import' },
  { pattern: /from\s+['"]\.\.?\/(\.\.\/)*(app|render|ui|persistence)\b/, reason: 'import from another layer' },
  { pattern: /from\s+['"]node:/, reason: 'Node built-in import' },
  { pattern: /\bMath\.random\b/, reason: 'non-seeded randomness' },
  { pattern: /\bDate\b/, reason: 'wall-clock time' },
  { pattern: /\bperformance\b/, reason: 'wall-clock time' },
  { pattern: /\bcrypto\b/, reason: 'non-seeded randomness' },
  { pattern: /\b(window|document|localStorage|sessionStorage|globalThis)\b/, reason: 'platform API' },
]

describe('architecture: src/sim purity', () => {
  const files = sourceFiles(SIM_DIR)

  it('finds simulation source files', () => {
    expect(files.length).toBeGreaterThan(0)
  })

  it('uses no forbidden imports or platform APIs', () => {
    const violations: string[] = []
    for (const file of files) {
      readFileSync(file, 'utf8')
        // blank out block comments but keep line numbers
        .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
        .split('\n')
        .forEach((line, i) => {
          const code = line.replace(/\/\/.*$/, '') // ignore line comments
          for (const { pattern, reason } of FORBIDDEN) {
            if (pattern.test(code)) {
              violations.push(`${relative(SIM_DIR, file)}:${i + 1} ${reason}: ${line.trim()}`)
            }
          }
        })
    }
    expect(violations).toEqual([])
  })
})
