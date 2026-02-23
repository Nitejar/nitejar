import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const SEARCH_DIRS = ['app', 'components', 'lib']
const ALLOWED_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx'])
const BANNED_IMPORT_PATTERNS = [
  /^@\/server\//,
  /^@nitejar\/agent(\/|$)/,
  /^@nitejar\/database(\/|$)/,
  /^@nitejar\/plugin-handlers(\/|$)/,
  /^@nitejar\/plugin-runtime(\/|$)/,
  /^@nitejar\/sprites(\/|$)/,
]

/**
 * Keep client components free of server/runtime package imports.
 * This check enforces the boundary to prevent accidental compile-graph blowups.
 */
function main() {
  const violations = []

  for (const relativeDir of SEARCH_DIRS) {
    const absoluteDir = path.join(ROOT, relativeDir)
    if (!fs.existsSync(absoluteDir)) continue
    walk(absoluteDir, violations)
  }

  if (violations.length === 0) {
    console.log('check-client-imports: OK')
    return
  }

  console.error('check-client-imports: found forbidden imports in client modules:\n')
  for (const violation of violations) {
    console.error(
      `- ${violation.file}:${violation.line} imports "${violation.module}" in a 'use client' file`
    )
  }
  process.exit(1)
}

function walk(dir, violations) {
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    const absolute = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      walk(absolute, violations)
      continue
    }

    if (!ALLOWED_EXTENSIONS.has(path.extname(entry.name))) continue
    checkFile(absolute, violations)
  }
}

function checkFile(filePath, violations) {
  const source = fs.readFileSync(filePath, 'utf8')
  if (!isUseClientFile(source)) return

  const importRegex = /^import\s+(.+?)\s+from\s+['"]([^'"]+)['"]/gm
  let match

  while ((match = importRegex.exec(source)) !== null) {
    const importClause = match[1] ?? ''
    const modulePath = match[2] ?? ''

    if (!isBannedModule(modulePath)) continue
    if (isTypeOnlyImport(importClause)) continue

    violations.push({
      file: path.relative(ROOT, filePath),
      line: lineNumberAt(source, match.index),
      module: modulePath,
    })
  }
}

function isUseClientFile(source) {
  return source.startsWith("'use client'") || source.startsWith('"use client"')
}

function isBannedModule(modulePath) {
  return BANNED_IMPORT_PATTERNS.some((pattern) => pattern.test(modulePath))
}

function isTypeOnlyImport(importClause) {
  return importClause.trimStart().startsWith('type ')
}

function lineNumberAt(source, index) {
  let line = 1
  for (let i = 0; i < index; i += 1) {
    if (source.charCodeAt(i) === 10) line += 1
  }
  return line
}

main()
