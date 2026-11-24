const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs-extra')
const path = require('path')
const os = require('os')
const vm = require('vm')
const Config = require('webpack-chain')
const cache = require('../lib/cache')
const createPlugin = require('../lib/plugin')
const configure = require('../lib/configure')
const { spawnSync } = require('child_process')

test('compiled CLI can be executed directly after linking', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'partition-cli-'))
  t.after(() => fs.removeSync(root))
  fs.outputFileSync(path.join(root, 'docs-partitions.config.js'), 'module.exports = { sections: [] }')
  const cli = path.join(__dirname, '../lib/cli.js')
  const result = spawnSync(process.platform === 'win32' ? process.execPath : cli,
    process.platform === 'win32' ? [cli, 'build', '--plan'] : ['build', '--plan'], { cwd: root, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr || String(result.error))
  assert.match(result.stdout, /Build sites: home/)
})

test('CLI loads TypeScript config and its helpers from the consumer directory', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'partition-cli-ts-'))
  t.after(() => fs.removeSync(root))
  fs.ensureDirSync(path.join(root, 'node_modules'))
  fs.symlinkSync(path.resolve(__dirname, '..'), path.join(root, 'node_modules/vuepress-plugin-partitions'), 'junction')
  fs.outputJsonSync(path.join(root, 'tsconfig.json'), { compilerOptions: { module: 'nodenext', moduleResolution: 'invalid' } })
  fs.outputFileSync(path.join(root, 'sections.ts'), 'export const sections: string[] = ["api"]')
  fs.outputFileSync(path.join(root, 'docs-partitions.config.ts'), [
    'import { defineConfig } from "vuepress-plugin-partitions"',
    'import { sections } from "./sections"',
    'export default defineConfig({ sections })',
  ].join('\n'))
  const result = spawnSync(process.execPath, [path.join(__dirname, '../lib/cli.js'), 'build', '--plan'], { cwd: root, encoding: 'utf8', timeout: 10000 })
  assert.equal(result.status, 0, result.stderr || String(result.error))
  assert.match(result.stdout, /Build sites: home, api/)
  assert(!fs.existsSync(path.join(root, '.build')))
})

test('CLI help works without project configuration and invalid commands fail', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'partition-help-'))
  t.after(() => fs.removeSync(root))
  const cli = path.join(__dirname, '../lib/cli.js')
  for (const args of [[], ['help'], ['--help'], ['-h'], ['help', 'build'], ['help', 'preview'], ['build', '--help'], ['preview', '-h']]) {
    const result = spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8', timeout: 5000 })
    assert.equal(result.status, 0, result.stderr || String(result.error))
    assert.match(result.stdout, /Usage: docs-partitions/)
    for (const option of ['--changed', '--jobs=N', '--heap-mb=N', '--plan', '--prepare', '--port=N']) assert(result.stdout.includes(option))
    assert.equal(result.stderr, '')
  }
  for (const args of [['unknown'], ['unknown', '--help'], ['help', 'unknown']]) {
    const result = spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8', timeout: 5000 })
    assert.equal(result.status, 1, result.stderr || String(result.error))
    assert.match(result.stderr, /Unknown command|Usage:/)
  }
  assert.deepEqual(fs.readdirSync(root), [])
})

test('cache policy changes production builds only', t => {
  const original = process.env.NODE_ENV
  t.after(() => { if (original === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = original })
  for (const environment of ['development', 'production']) {
    process.env.NODE_ENV = environment
    const config = new Config()
    const rule = config.module.rule('vue')
    rule.use('cache-loader').loader('cache-loader')
    rule.use('vue-loader').loader('vue-loader').options({ cacheDirectory: 'cache', cacheIdentifier: 'original' })
    rule.use('babel-loader').loader('babel-loader').options({ cacheDirectory: true })
    cache(config)
    const production = environment === 'production'
    assert.equal(rule.uses.has('cache-loader'), !production)
    assert.equal(rule.use('babel-loader').get('options').cacheDirectory, !production)
    assert.equal(config.optimization.minimizers.values().length, production ? 1 : 0)
    if (production) assert.equal(config.optimization.minimizer('terser').get('args')[0].cache, false)
  }
})

test('site marker keeps the client version and cleanup-compatible asset identifier; sitemap is optional', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'partition-marker-'))
  t.after(() => fs.removeSync(directory))
  const ctx = { outDir: path.join(directory, 'output'), vuepressDir: path.join(directory, 'content/.vuepress') }
  const plugin = createPlugin({ source: path.join(directory, 'content'), site: 'home', sections: ['api'], buildId: '123-456', root: directory }, ctx)
  assert.doesNotThrow(() => plugin.ready())
  assert.throws(() => plugin.generated(), /Missing version/)
  fs.outputJsonSync(path.join(ctx.outDir, 'version.json'), { id: '2026-11-23_10-00-00' })
  plugin.generated()
  assert.deepEqual(fs.readJsonSync(path.join(ctx.outDir, '_sites/home/version.json')), { id: '2026-11-23_10-00-00', assets: '123-456' })
  assert.deepEqual(plugin.globalUIComponents, ['VuepressVersionCheck'])
  assert.deepEqual(createPlugin({ site: 'api', versionCheckUI: 'theme' }, ctx).globalUIComponents, [])
})

test('version generated hook runs before the partition hook and matches the embedded client ID', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'partition-hooks-'))
  t.after(() => fs.removeSync(root))
  const output = path.join(root, 'output')
  fs.ensureDirSync(output)
  const result = configure({ base: '/manual/' }, { root, base: '/manual/', site: 'home', sections: ['api'], pages: [], output, buildId: '100-1' })
  const plugins = result.plugins.map(([factory, options]) => factory(options, { outDir: output }))
  for (const plugin of plugins) if (plugin.generated) plugin.generated()
  const rootVersion = fs.readJsonSync(path.join(output, 'version.json'))
  const marker = fs.readJsonSync(path.join(output, '_sites/home/version.json'))
  const versionPlugin = plugins.find(plugin => plugin.name === 'vuepress-plugin-version-check')
  assert.equal(marker.id, rootVersion.id)
  assert.equal(marker.id, versionPlugin.define().__VUEPRESS_VERSION_CHECK_BUILD_ID__)
})

test('client uses per-site versions and full navigation only across partition boundaries', () => {
  let hook
  let component
  const navigations = []
  const source = fs.readFileSync(path.join(__dirname, '../lib/enhanceApp.js'), 'utf8')
  assert(source.includes('module.exports'))
  const context = { module: { exports: {} }, __DOCS_SPLIT_SITE__: 'api', __DOCS_SPLIT_SECTIONS__: ['api', 'ai'], window: { location: { assign: url => navigations.push(url) } } }
  context.exports = context.module.exports
  context.require = name => {
    assert.equal(name, '@partition-version-component')
    return {}
  }
  vm.runInNewContext(source, context)
  assert.equal(typeof context.module.exports, 'function')
  context.module.exports({ Vue: { component: (name, value) => { component = value } }, router: { beforeEach: value => { hook = value } }, siteData: { base: '/manual/' } })
  assert.equal(component.computed.versionUrl(), '/manual/_sites/api/version.json')
  const next = []
  hook({ path: '/api/page.html', fullPath: '/api/page.html' }, {}, value => next.push(value))
  hook({ path: '/ai/page.html', fullPath: '/ai/page.html?q=1#heading' }, {}, value => next.push(value))
  assert.deepEqual(navigations, ['/manual/ai/page.html?q=1#heading'])
  assert.deepEqual(next, [undefined, false])
})
