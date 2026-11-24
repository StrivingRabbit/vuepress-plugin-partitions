import fs from 'fs-extra'
import path from 'path'
import crypto from 'crypto'
import glob from 'glob'
import { spawn } from 'child_process'
import { listFiles, digest } from './files'
import { normalizeOptions, CONFIG_FILES } from './options'
import type { PartitionsOptions, BuildArguments, Builder, BuildPlan, BuildManifest, BuildOutput, AssembledSite } from './types'

const MANIFEST = '.split-build.json'

export function parseBuildArgs(args: string[]): BuildArguments {
  const number = (name: string): number | undefined => {
    const argument = args.find(arg => arg.startsWith(`--${name}=`))
    if (!argument) return undefined
    const value = Number(argument.slice(name.length + 3))
    if (!Number.isInteger(value) || value < 1) throw new Error(`--${name} must be a positive integer`)
    return value
  }
  const jobs = number('jobs') || 1
  const heapMb = number('heap-mb')
  for (const arg of args) {
    if (arg.startsWith('--') && !['--changed', '--plan', '--prepare'].includes(arg) && !arg.startsWith('--jobs=') && !arg.startsWith('--heap-mb=')) throw new Error(`Unknown option: ${arg}`)
  }
  return { jobs, heapMb, targets: [...new Set(args.filter(arg => !arg.startsWith('--')))] }
}

export function createBuilder(input: PartitionsOptions = {}, root: string = process.cwd()): Builder {
  root = path.resolve(root)
  const options = normalizeOptions(input, root)
  const { source, destination, workspace, sites, getSite } = options
  const ignored = (filename: string): boolean => filename === destination || filename === path.join(source, '.vuepress/.temp') || filename === path.join(source, '.vuepress/.cache')
  // 预览服务及声明文件不影响静态产物，修改它们不应导致所有分区重新编译。
  const packageHash = digest(path.resolve(__dirname, '..'), ['package.json', ...listFiles(__dirname).filter(file => file.endsWith('.js') && file !== 'preview.js').map(file => `lib/${file}`)])

  function getPlan(targets: string[] = [], changed = false): BuildPlan {
    for (const site of targets) if (!sites.includes(site)) throw new Error(`Unknown site: ${site}; choose ${sites.join(', ')}`)
    const files = listFiles(source, ignored)
    const pages = files.filter(file => !file.startsWith('.vuepress/') && /\.(md|vue)$/.test(file) && path.basename(file) !== '_sidebar.md')
    const publicFiles = files.filter(file => file.startsWith('.vuepress/public/') && !/^\.vuepress\/public\/(sitemap\.xml|llms\.txt)$/.test(file))
    const sharedFiles = files.filter(file => (!/\.(md|vue)$/.test(file) || file.startsWith('.vuepress/') || path.basename(file) === '_sidebar.md') && !file.startsWith('.vuepress/public/'))
    const patterns = ['package.json', '*lock*', ...CONFIG_FILES, 'docs-sync.config.ts', '.env', 'scripts/**', 'shared/**', 'sites/**', ...(options.sharedFiles || [])]
    const rootFiles = [...new Set(patterns.flatMap(pattern => glob.sync(pattern, { cwd: root, nodir: true, dot: true, ignore: ['**/.DS_Store', 'node_modules/**', '.build/**', '.git/**'] })))].sort()
    const extra = options.fingerprint ? options.fingerprint({ root, source }) : ''
    if (typeof extra !== 'string') throw new Error('fingerprint must return a string synchronously')
    // 共享配置、JSON 和外部输入影响所有分区；公共静态文件仅影响主站。
    const commonHash = packageHash + JSON.stringify({ base: options.base, sections: options.sections, origin: options.origin, homeOnlyPlugins: options.homeOnlyPlugins }) + digest(source, sharedFiles) + digest(root, rootFiles) + extra
    const signatures: Record<string, string> = {}
    const sitePages: Record<string, string[]> = {}
    for (const site of sites) {
      sitePages[site] = pages.filter(file => getSite(file) === site)
      signatures[site] = crypto.createHash('sha256').update(commonHash).update(digest(source, sitePages[site])).update(site === 'home' ? digest(source, publicFiles) : '').digest('hex')
    }
    const manifestFile = path.join(destination, MANIFEST)
    const previous: BuildManifest = fs.existsSync(manifestFile) ? fs.readJsonSync(manifestFile) : { sites: {} }
    const present = (site: string) => previous.sites && previous.sites[site] && Array.isArray(previous.sites[site].files) && previous.sites[site].files.length && previous.sites[site].files.every(file => fs.existsSync(path.join(destination, file)))
    const missing = sites.filter(site => !present(site))
    const requested = targets.length ? targets : changed ? sites.filter(site => !present(site) || previous.sites[site].signature !== signatures[site]) : sites
    // 指定分区时仍补齐缺失基线，保证最终 dist 是可独立部署的完整站点。
    return { selected: [...new Set([...requested, ...missing])], missing, signatures, sitePages, previous, destination }
  }

  function assemble(site: string, pages: string[], buildId: string): AssembledSite {
    const directory = path.join(workspace, site)
    const temporarySource = path.join(directory, 'docs')
    fs.emptyDirSync(directory)
    fs.copySync(source, temporarySource, { filter: filename => !ignored(filename) && path.basename(filename) !== '.DS_Store' && (site === 'home' || filename !== path.join(source, '.vuepress/public')) })
    const temporaryConfig = path.join(temporarySource, '.vuepress/config.js')
    if (fs.existsSync(temporaryConfig)) fs.moveSync(temporaryConfig, path.join(temporarySource, '.vuepress/config.base.js'))
    const output = path.join(directory, 'output')
    const settings = { ...options, getSite: undefined, fingerprint: undefined, site, pages, output, buildId }
    // 原配置从仓库加载，保留 JSON 注入及示例源码的相对路径语义。
    fs.outputFileSync(temporaryConfig, [
      `const base = require(${JSON.stringify(path.join(source, '.vuepress/config.js'))})`,
      `const configure = require(${JSON.stringify(require.resolve('./configure'))})`,
      `module.exports = configure(base, ${JSON.stringify(settings)})`,
      '',
    ].join('\n'))
    return { source: temporarySource, output }
  }

  function publish(plan: BuildPlan, built: BuildOutput[]): void {
    const pending = path.join(workspace, 'merged')
    fs.emptyDirSync(pending)
    if (fs.existsSync(path.join(destination, MANIFEST))) fs.copySync(destination, pending)
    const manifest: BuildManifest = { sites: { ...plan.previous.sites } }
    const retired = Object.keys(manifest.sites).filter(site => !sites.includes(site))
    for (const site of [...retired, ...built.map(item => item.site)]) {
      for (const file of (manifest.sites[site] || {}).files || []) {
        const relative = path.relative(pending, path.resolve(pending, file))
        if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error(`Invalid manifest path: ${file}`)
        fs.removeSync(path.join(pending, file))
      }
    }
    for (const site of retired) delete manifest.sites[site]
    for (const { site, output } of built) {
      const files = listFiles(output).filter(file => file.startsWith(`_sites/${site}/`) || (file.endsWith('.html') ? getSite(file) === site : site === 'home'))
      for (const file of files) fs.copySync(path.join(output, file), path.join(pending, file))
      manifest.sites[site] = { signature: plan.signatures[site], files }
    }
    fs.writeJsonSync(path.join(pending, MANIFEST), manifest, { spaces: 2 })
    const backup = path.join(workspace, 'previous-dist')
    fs.removeSync(backup)
    if (fs.existsSync(destination)) fs.moveSync(destination, backup)
    try {
      fs.moveSync(pending, destination)
    } catch (error) {
      if (fs.existsSync(backup)) fs.moveSync(backup, destination)
      throw error
    }
  }

  function buildSite(site: string, pages: string[], buildId: string, heapMb?: number): Promise<BuildOutput> {
    const assembled = assemble(site, pages, buildId)
    const cli = path.join(path.dirname(require.resolve('vuepress', { paths: [root] })), 'cli.js')
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [
        ...(heapMb ? [`--max-old-space-size=${heapMb}`] : []), cli, 'build', assembled.source, '--no-cache', '--max-concurrency', '8',
      ], { cwd: root, stdio: 'inherit', env: { ...process.env, NODE_ENV: 'production' } })
      child.on('error', reject)
      child.on('close', code => {
        if (code !== 0) return reject(new Error(`Build ${site} failed (${code || 'signal'})`))
        for (const marker of ['version.json', `_sites/${site}/version.json`]) {
          if (!fs.existsSync(path.join(assembled.output, marker))) return reject(new Error(`Build ${site}: missing ${marker}`))
        }
        resolve({ site, output: assembled.output })
      })
    })
  }

  async function build(args: string[] = []): Promise<BuildPlan> {
    const { jobs, heapMb, targets } = parseBuildArgs(args)
    const planOnly = args.includes('--plan')
    if (!planOnly) fs.ensureDirSync(workspace)
    const lockFile = path.join(workspace, 'build.lock')
    const lock = planOnly ? undefined : fs.openSync(lockFile, 'wx')
    try {
      const plan = getPlan(targets, args.includes('--changed'))
      if (plan.missing.length) console.warn(`Missing baseline sites: ${plan.missing.join(', ')}; rebuilding them automatically`)
      console.log(`Build sites: ${plan.selected.join(', ') || '(unchanged)'} (jobs=${jobs}, heap=${heapMb || 'Node default'})`)
      if (planOnly) return plan
      const buildId = `${Date.now()}-${process.pid}`
      if (args.includes('--prepare')) {
        for (const site of plan.selected) assemble(site, plan.sitePages[site], buildId)
        return plan
      }
      const queue = plan.selected.slice()
      let failure: unknown
      const workers = Array.from({ length: Math.min(jobs, queue.length) }, async () => {
        const results: BuildOutput[] = []
        while (queue.length && !failure) {
          const site = queue.shift()!
          try { results.push(await buildSite(site, plan.sitePages[site], buildId, heapMb)) }
          catch (error) { failure = failure || error }
        }
        return results
      })
      // 失败后等待已启动进程结束才释放锁，且不发布本轮产物。
      const built = (await Promise.all(workers)).flat()
      if (failure) throw failure
      if (built.length) publish(plan, built)
      return plan
    } finally {
      if (lock !== undefined) {
        fs.closeSync(lock)
        fs.unlinkSync(lockFile)
      }
    }
  }

  return { options, getPlan, assemble, publish, build }
}
