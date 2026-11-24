import path from 'path'
import fs from 'fs-extra'
import type { PartitionsOptions, NormalizedOptions } from './types'

export const CONFIG_FILES = ['docs-partitions.config.ts', 'docs-partitions.config.js']
let tsRegistered = false

export function defineConfig(options: PartitionsOptions): PartitionsOptions {
  return options
}

export function loadOptions(root: string = process.cwd()): PartitionsOptions {
  const filename = CONFIG_FILES.map(file => path.resolve(root, file)).find(file => fs.existsSync(file))
  if (!filename) throw new Error(`Missing configuration in ${path.resolve(root)}; expected ${CONFIG_FILES.join(' or ')}`)
  if (filename.endsWith('.ts') && !tsRegistered) {
    // 按需加载包内编译器，不读取消费项目的 tsconfig，也不依赖其 TS 版本。
    require('ts-node').register({
      compiler: require.resolve('typescript'),
      skipProject: true,
      transpileOnly: true,
      compilerOptions: { module: 'commonjs', moduleResolution: 'node', target: 'es2020', ignoreDeprecations: '6.0' },
    })
    tsRegistered = true
  }
  const loaded = require(filename)
  return loaded.default || loaded
}

export function normalizeOptions(input: PartitionsOptions, root: string): NormalizedOptions {
  const sections = input.sections || []
  if (!Array.isArray(sections) || sections.some(site => typeof site !== 'string' || !/^[a-z][a-z0-9-]*$/.test(site) || ['home', 'node_modules'].includes(site)) || new Set(sections).size !== sections.length) {
    throw new Error('sections must contain unique lowercase directory names, excluding home and node_modules')
  }
  const base = input.base || '/'
  if (typeof base !== 'string' || !base.startsWith('/') || !base.endsWith('/') || /[?#\\\s]/.test(base) || base.includes('//') || base.split('/').some(part => part === '.' || part === '..')) {
    throw new Error('base must be a URL path with leading and trailing slashes')
  }
  const origin = input.origin || ''
  if (origin && !/^https?:\/\/[^/?#]+\/?$/.test(origin)) throw new Error('origin must be an HTTP(S) origin without a path')
  const source = path.resolve(root, input.source || 'docs')
  const destination = path.resolve(root, input.dest || path.join(input.source || 'docs', '.vuepress/dist'))
  const workspace = path.join(root, '.build')
  const inside = (parent: string, child: string): boolean => child === parent || child.startsWith(parent + path.sep)
  // 组装和发布会清空临时目录，禁止把源码或输出指向项目根、外部目录及临时目录。
  if (source === root || destination === root || !inside(root, source) || !inside(root, destination) || inside(source, workspace) || inside(workspace, source) || inside(workspace, destination) || inside(destination, source)) {
    throw new Error('source and dest must be distinct project directories outside .build; dest cannot contain source')
  }
  if (input.fingerprint !== undefined && typeof input.fingerprint !== 'function') throw new Error('fingerprint must be a function')
  if (input.homeOnlyPlugins !== undefined && !Array.isArray(input.homeOnlyPlugins)) throw new Error('homeOnlyPlugins must be an array of plugin names')
  if (input.sharedFiles !== undefined && !Array.isArray(input.sharedFiles)) throw new Error('sharedFiles must be an array of project-relative glob patterns')
  if (input.versionCheckUI !== undefined && !['global', 'theme'].includes(input.versionCheckUI)) throw new Error('versionCheckUI must be global or theme')
  const sites = ['home', ...sections]
  const getSite = (file: string): string => {
    const section = file.replace(/\\/g, '/').split('/')[0]
    return sections.includes(section) ? section : 'home'
  }
  return { ...input, root, source, destination, workspace, base, origin: origin.replace(/\/$/, ''), sections: sections.slice(), sites, getSite }
}
