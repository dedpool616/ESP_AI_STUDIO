export interface BuildDiagnostic {
  file: string
  relativePath?: string
  line: number
  column: number
  severity: 'error' | 'warning'
  message: string
}

export interface EditorLocation {
  id: number
  projectPath: string
  relativePath: string
  line: number
  column: number
}

export function diagnosticProjectPath(file: string, projectPath: string): string | undefined {
  const clean = file.replaceAll('\\', '/').replace(/^"|"$/g, '')
  const root = projectPath.replaceAll('\\', '/').replace(/\/+$/, '')
  const absolute = /^(?:[A-Za-z]:\/|\/)/.test(clean)
  if (absolute && !clean.toLowerCase().startsWith(root.toLowerCase() + '/')) return undefined
  const relative = absolute ? clean.slice(root.length + 1) : clean.replace(/^\.\//, '')
  if (
    !relative ||
    relative.split('/').some((part) => !part || part === '..' || part === '.') ||
    relative.includes(':') ||
    relative.includes(String.fromCharCode(0))
  )
    return undefined
  return relative
}

export function parseBuildDiagnostics(log: string, projectPath: string): BuildDiagnostic[] {
  const diagnostics: BuildDiagnostic[] = []
  const seen = new Set<string>()
  const colorEscape = new RegExp(String.fromCharCode(27) + '\\[[0-9;]*m', 'g')
  for (const line of log.replace(colorEscape, '').split(/\r?\n/)) {
    const match = line.match(/^(.+?):(\d+)(?::(\d+))?:\s*(fatal error|error|warning):\s*(.+)$/)
    if (!match) continue
    const number = Number(match[2]),
      column = Number(match[3] ?? 1)
    if (!Number.isSafeInteger(number) || number < 1 || !Number.isSafeInteger(column) || column < 1)
      continue
    const item: BuildDiagnostic = {
      file: match[1],
      relativePath: diagnosticProjectPath(match[1], projectPath),
      line: number,
      column,
      severity: match[4] === 'warning' ? 'warning' : 'error',
      message: match[5]
    }
    const key = JSON.stringify(item)
    if (seen.has(key)) continue
    seen.add(key)
    diagnostics.push(item)
    if (diagnostics.length >= 500) break
  }
  return diagnostics
}
