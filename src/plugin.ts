import fs from 'fs'
import path from 'path'
import { pathToFileURL } from 'url'
import type { RsbuildPlugin } from '@rsbuild/core'

function isPlugin(value: unknown): value is RsbuildPlugin {
  return (
    typeof value === 'object' &&
    value !== null &&
    'name' in value &&
    'setup' in value &&
    typeof (value as RsbuildPlugin).setup === 'function'
  )
}

export type TamerPluginOptions = Record<
  string,
  | boolean
  | Record<string, unknown>
  | RsbuildPlugin
>

const TAMER_CONFIG_NAMES = ['tamer.config.json', 'tamer.config.ts', 'tamer.config.mjs', 'tamer.config.js']
const TAMER_ROOT_CONFIG = 'tamer.config.json'

function findTamerProjectRoot(start: string): string | null {
  let dir = path.resolve(start)
  const root = path.parse(dir).root
  while (dir !== root) {
    if (fs.existsSync(path.join(dir, TAMER_ROOT_CONFIG))) return dir
    dir = path.dirname(dir)
  }
  return null
}

function loadTamerRootConfigJson(projectRoot: string): Record<string, unknown> | null {
  const p = path.join(projectRoot, TAMER_ROOT_CONFIG)
  if (!fs.existsSync(p)) return null
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8')) as Record<string, unknown>
  } catch {
    return null
  }
}

/** Matches host `resolveHostPaths`: `lynxProject` or `paths.lynxProject` relative to the Tamer repo root. */
function resolveLynxDirForServerBase(buildRoot: string): string {
  const tamerRoot = findTamerProjectRoot(buildRoot)
  if (!tamerRoot) return buildRoot
  const cfg = loadTamerRootConfigJson(tamerRoot)
  if (!cfg) return buildRoot
  const paths = cfg.paths
  const pathsObj = paths && typeof paths === 'object' && !Array.isArray(paths) ? (paths as Record<string, unknown>) : {}
  const explicit =
    (typeof cfg.lynxProject === 'string' ? cfg.lynxProject : undefined) ??
    (typeof pathsObj.lynxProject === 'string' ? pathsObj.lynxProject : undefined)
  if (!explicit) return buildRoot
  const resolved = path.isAbsolute(explicit) ? explicit : path.join(tamerRoot, explicit)
  if (fs.existsSync(resolved)) return path.resolve(resolved)
  return buildRoot
}

function hasTamerConfigExport(pkgJson: { exports?: unknown }): boolean {
  const exp = pkgJson.exports
  if (exp === null || exp === undefined) return false
  if (typeof exp === 'string') return exp === './tamer.config' || exp.endsWith('/tamer.config')
  if (typeof exp !== 'object') return false
  if (Array.isArray(exp)) return exp.some((e: unknown) => e === './tamer.config' || (typeof e === 'string' ? e.endsWith('/tamer.config') : false))
  return './tamer.config' in (exp as object) || Object.keys(exp as object).some((k) => k === './tamer.config' || k.startsWith('./tamer.config'))
}

/** Like Node module resolution: walk from cwd up to the filesystem root and merge unique package names from each `node_modules` (hoisted deps live in ancestor folders). */
function findPackagesWithTamerConfigFromAncestors(startDir: string): string[] {
  const seen = new Set<string>()
  const names: string[] = []
  let dir = path.resolve(startDir)
  const root = path.parse(dir).root
  while (dir !== root) {
    const nodeModulesDir = path.join(dir, 'node_modules')
    if (fs.existsSync(nodeModulesDir)) {
      for (const pkgName of findPackagesWithTamerConfig(nodeModulesDir)) {
        if (!seen.has(pkgName)) {
          seen.add(pkgName)
          names.push(pkgName)
        }
      }
    }
    dir = path.dirname(dir)
  }
  return names.sort()
}

function findPackagesWithTamerConfig(nodeModulesDir: string): string[] {
  const names: string[] = []
  if (!fs.existsSync(nodeModulesDir)) return names
  const entries = fs.readdirSync(nodeModulesDir, { withFileTypes: true })
  for (const e of entries) {
    if (e.name.startsWith('.')) continue
    if (e.isDirectory()) {
      if (e.name.startsWith('@')) {
        const scopePath = path.join(nodeModulesDir, e.name)
        const scoped = fs.readdirSync(scopePath, { withFileTypes: true })
        for (const s of scoped) {
          if (s.isDirectory()) {
            const pkgDir = path.join(scopePath, s.name)
            const pkgName = `${e.name}/${s.name}`
            try {
              const pkgPath = path.join(pkgDir, 'package.json')
              if (fs.existsSync(pkgPath)) {
                const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
                if (hasTamerConfigExport(pkg)) names.push(pkgName)
              }
            } catch {
              // skip
            }
          }
        }
      } else {
        const pkgDir = path.join(nodeModulesDir, e.name)
        try {
          const pkgPath = path.join(pkgDir, 'package.json')
          if (fs.existsSync(pkgPath)) {
            const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
            if (hasTamerConfigExport(pkg)) names.push(e.name)
          }
        } catch {
          // skip
        }
      }
    }
  }
  return names.sort()
}

function resolveTamerConfigExport(exp: unknown): string | null {
  if (exp === null || exp === undefined) return null
  if (typeof exp === 'string') return exp
  if (typeof exp === 'object' && !Array.isArray(exp)) {
    const o = exp as Record<string, unknown>
    if (o.import && typeof o.import === 'string') return o.import
    if (o.default && typeof o.default === 'string') return o.default
    const first = Object.values(o)[0]
    if (typeof first === 'string') return first
  }
  return null
}

function getTamerConfigFilePath(pkgDir: string, pkg: { exports?: unknown }): string | null {
  const exp = pkg.exports
  if (exp === null || typeof exp !== 'object') return null
  let subpath: string | null = null
  if (typeof exp === 'string') subpath = exp === './tamer.config' ? exp : null
  else if (Array.isArray(exp)) {
    const entry = exp.find((e: unknown) => e === './tamer.config' || (typeof e === 'string' && e.startsWith('./tamer.config')))
    subpath = typeof entry === 'string' ? entry : null
  } else if ('./tamer.config' in (exp as object)) {
    subpath = resolveTamerConfigExport((exp as Record<string, unknown>)['./tamer.config'])
  }
  if (subpath && typeof subpath === 'string' && subpath.startsWith('./')) {
    const rel = subpath.replace(/^\.\//, '')
    const full = path.join(pkgDir, rel)
    if (fs.existsSync(full)) return path.resolve(full)
  }
  for (const name of TAMER_CONFIG_NAMES) {
    const full = path.join(pkgDir, name)
    if (fs.existsSync(full)) return path.resolve(full)
  }
  return null
}

function findWorkspaceRoot(start: string): string | null {
  let dir = path.resolve(start)
  const root = path.parse(dir).root
  while (dir !== root) {
    const pkgPath = path.join(dir, 'package.json')
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
        if (pkg.workspaces) return dir
      } catch {
        // skip
      }
    }
    dir = path.dirname(dir)
  }
  return null
}

function getWorkspacePackageDirs(workspaceRoot: string): { dir: string; name: string }[] {
  const result: { dir: string; name: string }[] = []
  const pkgPath = path.join(workspaceRoot, 'package.json')
  let workspaces: string[] = []
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
    const w = pkg.workspaces
    if (Array.isArray(w)) workspaces = w.filter((x: unknown) => typeof x === 'string')
    else if (typeof w === 'string') workspaces = [w]
  } catch {
    return result
  }
  for (const pattern of workspaces) {
    const isGlob = pattern.includes('*')
    if (isGlob) {
      const base = path.join(workspaceRoot, pattern.replace(/\/\*$/, ''))
      if (!fs.existsSync(base)) continue
      const entries = fs.readdirSync(base, { withFileTypes: true })
      for (const e of entries) {
        if (e.isDirectory() && !e.name.startsWith('.')) {
          const dir = path.join(base, e.name)
          const wp = path.join(dir, 'package.json')
          if (fs.existsSync(wp)) {
            try {
              const pkg = JSON.parse(fs.readFileSync(wp, 'utf8'))
              result.push({ dir, name: pkg.name || e.name })
            } catch {
              result.push({ dir, name: e.name })
            }
          }
        }
      }
    } else {
      const dir = path.join(workspaceRoot, pattern)
      if (fs.existsSync(dir)) {
        const wp = path.join(dir, 'package.json')
        if (fs.existsSync(wp)) {
          try {
            const pkg = JSON.parse(fs.readFileSync(wp, 'utf8'))
            result.push({ dir, name: pkg.name || path.basename(dir) })
          } catch {
            result.push({ dir, name: path.basename(dir) })
          }
        }
      }
    }
  }
  return result.sort((a, b) => a.name.localeCompare(b.name))
}

export function pluginTamer(options: TamerPluginOptions = {}): RsbuildPlugin {
  return {
    name: 'tamer-plugin',
    async setup(api) {
      const cwd = api.context?.rootPath ?? process.cwd()
      let merged: TamerPluginOptions = { ...options }
      let loaded = false

      for (const name of TAMER_CONFIG_NAMES) {
        const configPath = path.join(cwd, name)
        if (!fs.existsSync(configPath)) continue
        try {
          let defaults: Record<string, unknown> | null = null
          if (name === 'tamer.config.json') {
            const raw = fs.readFileSync(configPath, 'utf8')
            defaults = JSON.parse(raw) as Record<string, unknown>
          }
          if (name !== 'tamer.config.json') {
            const mod = await import(`${pathToFileURL(configPath).href}?t=${Date.now()}`)
            defaults = (mod.default ?? mod.tamerDefaults ?? mod) as Record<string, unknown> | null
          }
          if (typeof defaults === 'object' && defaults !== null) {
            merged = { ...defaults } as TamerPluginOptions
            for (const [k, v] of Object.entries(options)) {
              if (v === false) merged[k] = false
              else if (v !== true) merged[k] = v as TamerPluginOptions[string]
            }
            loaded = true
            break
          }
        } catch {
          // skip this file, try next
        }
      }

      if (loaded) {
        const pkgNames = findPackagesWithTamerConfigFromAncestors(cwd)
        for (const pkgName of pkgNames) {
          try {
            const mod = await import(`${pkgName}/tamer.config`)
            const defaults = mod.default ?? mod.tamerDefaults ?? mod
            if (typeof defaults === 'object' && defaults !== null) {
              merged = { ...defaults, ...merged }
            }
          } catch {
            // skip
          }
        }
      }

      if (!loaded) {
        const workspaceRoot = findWorkspaceRoot(cwd)
        if (workspaceRoot) {
          const workspacePackages = getWorkspacePackageDirs(workspaceRoot)
          for (const { dir: pkgDir } of workspacePackages) {
            const pkgPath = path.join(pkgDir, 'package.json')
            if (!fs.existsSync(pkgPath)) continue
            try {
              const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
              if (!hasTamerConfigExport(pkg)) continue
              const configPath = getTamerConfigFilePath(pkgDir, pkg)
              if (!configPath) continue
              const mod = await import(`${pathToFileURL(configPath).href}?t=${Date.now()}`)
              const defaults = mod.default ?? mod.tamerDefaults ?? mod
              if (typeof defaults === 'object' && defaults !== null) {
                merged = { ...defaults, ...merged }
              }
            } catch {
              // skip this package
            }
          }
        }
        const pkgNames = findPackagesWithTamerConfigFromAncestors(cwd)
        for (const pkgName of pkgNames) {
          try {
            const mod = await import(`${pkgName}/tamer.config`)
            const defaults = mod.default ?? mod.tamerDefaults ?? mod
            if (typeof defaults === 'object' && defaults !== null) {
              merged = { ...defaults, ...merged }
            }
          } catch {
            // skip this package
          }
        }
        for (const [k, v] of Object.entries(options)) {
          if (v === false) merged[k] = false
          else if (v !== true) merged[k] = v as TamerPluginOptions[string]
        }
      }

      const rsbuildConfigPartial = merged.rsbuildConfig as Record<string, unknown> | undefined

      if ('modifyRsbuildConfig' in api) {
        api.modifyRsbuildConfig((config) => {
          const lynxDir = resolveLynxDirForServerBase(cwd)
          const tamerBase = `/${path.basename(lynxDir)}`
          const next: Record<string, unknown> = { ...config }
          if (typeof rsbuildConfigPartial === 'object' && rsbuildConfigPartial !== null) {
            const src = config.source || {}
            const partialSrc = (rsbuildConfigPartial.source || {}) as Record<string, unknown>
            const preEntry = [
              ...(Array.isArray(src.preEntry) ? src.preEntry : src.preEntry ? [src.preEntry] : []),
              ...(Array.isArray(partialSrc.preEntry) ? partialSrc.preEntry : partialSrc.preEntry ? [partialSrc.preEntry] : []),
            ]
            const seen = new Set<string>()
            const deduped = preEntry.filter((e: string) => !seen.has(e) && seen.add(e))
            next.source = { ...src, ...partialSrc, preEntry: deduped.length ? deduped : undefined }
          }

          const server = (config.server || {}) as Record<string, unknown>
          next.server = { ...server, base: server.base ?? tamerBase }

          const output = (config.output || {}) as Record<string, unknown>
          if (output.assetPrefix === undefined) {
            next.output = { ...output, assetPrefix: 'auto' }
          }

          return next as typeof config
        })
      }

      for (const value of Object.values(merged)) {
        if (value === false || value === rsbuildConfigPartial) continue
        if (isPlugin(value)) await value.setup(api)
      }

    },
  }
}
