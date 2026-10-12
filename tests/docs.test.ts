import { expect, test } from 'bun:test'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
function markdown(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (['node_modules', '.git'].includes(entry.name)) return []
    const name = join(directory, entry.name)
    return entry.isDirectory() ? markdown(name) : name.endsWith('.md') ? [name] : []
  })
}

test('documentation links and named package scripts resolve', () => {
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  for (const file of markdown(root)) {
    const text = readFileSync(file, 'utf8')
    for (const match of text.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
      const target = match[1].split('#')[0]
      if (!target || /^[a-z]+:/i.test(target)) continue
      const destination = target.startsWith('/')
        ? resolve(root, `.${target}`)
        : resolve(dirname(file), target)
      expect(existsSync(destination), `${file}: ${target}`).toBe(true)
    }
    for (const match of text.matchAll(/bun run ([a-z-]+)/g)) {
      expect(Object.hasOwn(manifest.scripts, match[1]), `${file}: ${match[1]}`).toBe(true)
    }
  }
  for (const entry of manifest.pi.extensions) expect(existsSync(resolve(root, entry))).toBe(true)
})
