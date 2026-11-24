const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs-extra')
const path = require('path')
const os = require('os')
const childProcess = require('child_process')
const { EventEmitter } = require('events')
const { createBuilder, parseBuildArgs } = require('../lib/build')
const configure = require('../lib/configure')

function fixture(t, input = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'partition-build-'))
  t.after(() => fs.removeSync(root))
  const builder = createBuilder({ source: 'content', base: '/manual/', sections: ['api', 'ai'], ...input }, root)
  fs.outputFileSync(path.join(root, 'content/.vuepress/config.js'), 'module.exports = { base: "/manual/" }')
  fs.outputFileSync(path.join(root, 'content/.vuepress/public/shared.js'), 'shared')
  for (const file of ['README.md', 'api/README.md', 'ai/README.md']) fs.outputFileSync(path.join(root, 'content', file), '# ' + file)
  const built = builder.options.sites.map(site => {
    const output = path.join(root, 'outputs', site)
    fs.outputFileSync(path.join(output, site === 'home' ? 'index.html' : `${site}/index.html`), site)
    fs.outputJsonSync(path.join(output, 'version.json'), { id: site })
    fs.outputJsonSync(path.join(output, `_sites/${site}/version.json`), { id: site, assets: '100-1' })
    fs.outputFileSync(path.join(output, `_sites/${site}/100-1/app.js`), site)
    return { site, output }
  })
  builder.publish(builder.getPlan(), built)
  return { root, builder, built }
}

test('fingerprints ignore metadata and retain shared JSON and external dependencies', t => {
  let external = 'first'
  const { root, builder } = fixture(t, { fingerprint: () => external })
  assert.deepEqual(builder.getPlan([], true).selected, [])
  for (const dir of ['content', 'content/.vuepress', 'content/.vuepress/public', 'scripts']) {
    fs.outputFileSync(path.join(root, dir, '.DS_Store'), 'metadata')
  }
  assert.deepEqual(builder.getPlan([], true).selected, [])
  fs.outputFileSync(path.join(root, 'content/new-category/page.md'), '# New')
  assert.deepEqual(builder.getPlan([], true).selected, ['home'])
  fs.removeSync(path.join(root, 'content/new-category'))
  fs.outputFileSync(path.join(root, 'content/ai/page.md'), '# AI')
  assert.deepEqual(builder.getPlan([], true).selected, ['ai'])
  fs.removeSync(path.join(root, 'content/ai/page.md'))
  external = 'second'
  assert.deepEqual(builder.getPlan([], true).selected, builder.options.sites)
  external = 'first'
  fs.outputJsonSync(path.join(root, 'content/.vuepress/utils/cssJson.json'), { changed: true })
  assert.deepEqual(builder.getPlan([], true).selected, builder.options.sites)
})

test('partial merge preserves other sites and replaces deleted pages and assets', t => {
  const { builder, built } = fixture(t)
  const ai = built.find(item => item.site === 'ai')
  fs.removeSync(path.join(ai.output, 'ai/index.html'))
  fs.outputFileSync(path.join(ai.output, 'ai/new.html'), 'new')
  builder.publish(builder.getPlan(['ai']), [ai])
  assert(fs.existsSync(path.join(builder.options.destination, 'api/index.html')))
  assert(!fs.existsSync(path.join(builder.options.destination, 'ai/index.html')))
  assert(fs.existsSync(path.join(builder.options.destination, 'ai/new.html')))
  assert.deepEqual(builder.getPlan([], true).selected, [])
})

test('TypeScript partition config changes invalidate every site', t => {
  const { root, builder, built } = fixture(t)
  const config = path.join(root, 'docs-partitions.config.ts')
  fs.outputFileSync(config, 'export default { sections: ["api", "ai"] }')
  assert.deepEqual(builder.getPlan([], true).selected, builder.options.sites)
  builder.publish(builder.getPlan(), built)
  assert.deepEqual(builder.getPlan([], true).selected, [])
  fs.appendFileSync(config, '\n// Changed configuration\n')
  assert.deepEqual(builder.getPlan([], true).selected, builder.options.sites)
})

test('preview and declaration changes do not invalidate builds, but builder changes do', t => {
  const { root } = fixture(t)
  const isolated = path.join(root, 'tool')
  fs.copySync(path.join(__dirname, '../lib'), path.join(isolated, 'lib'))
  fs.copySync(path.join(__dirname, '../package.json'), path.join(isolated, 'package.json'))
  fs.ensureDirSync(path.join(isolated, 'node_modules'))
  for (const dependency of ['fs-extra', 'glob']) {
    fs.symlinkSync(path.dirname(require.resolve(`${dependency}/package.json`)), path.join(isolated, 'node_modules', dependency), 'dir')
  }
  const { createBuilder: createIsolatedBuilder } = require(path.join(isolated, 'lib/build'))
  const builder = () => createIsolatedBuilder({ source: 'content', base: '/manual/', sections: ['api', 'ai'] }, root)
  assert.deepEqual(builder().getPlan([], true).selected, [])
  fs.appendFileSync(path.join(isolated, 'lib/preview.js'), '\n// Preview-only update\n')
  fs.appendFileSync(path.join(isolated, 'lib/types.d.ts'), '\n// Type-only update\n')
  assert.deepEqual(builder().getPlan([], true).selected, [])
  fs.appendFileSync(path.join(isolated, 'lib/build.js'), '\n// Build update\n')
  assert.deepEqual(builder().getPlan([], true).selected, ['home', 'api', 'ai'])
})

test('missing baseline is repaired, public belongs to home, original config path is kept', async t => {
  const { builder } = fixture(t)
  fs.removeSync(path.join(builder.options.destination, 'api'))
  const plan = await builder.build(['ai', '--prepare'])
  assert.deepEqual(plan.selected, ['ai', 'api'])
  assert(!fs.existsSync(path.join(builder.options.workspace, 'ai/docs/.vuepress/public')))
  const home = builder.assemble('home', plan.sitePages.home, '200-1')
  assert(fs.existsSync(path.join(home.source, '.vuepress/public/shared.js')))
  assert(fs.readFileSync(path.join(home.source, '.vuepress/config.js'), 'utf8').includes(path.join(builder.options.source, '.vuepress/config.js')))
})

test('invalid sections, destructive directories and unknown arguments fail early', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'partition-invalid-'))
  t.after(() => fs.removeSync(root))
  for (const sections of [['home'], ['api', 'api'], ['../api']]) assert.throws(() => createBuilder({ sections }, root), /sections/)
  for (const input of [{ source: '.' }, { dest: '.' }, { source: '.build/docs' }, { dest: '.build/output' }]) assert.throws(() => createBuilder(input, root), /source and dest/)
  assert.throws(() => createBuilder({ base: '/manual' }, root), /base/)
  assert.throws(() => parseBuildArgs(['--jobs=0']), /positive integer/)
  assert.throws(() => parseBuildArgs(['--wat']), /Unknown option/)
  assert.deepEqual(parseBuildArgs(['ai', '--jobs=2']), { jobs: 2, heapMb: undefined, targets: ['ai'] })
})

test('worker failure waits for running builds and never publishes a partial batch', async t => {
  const { root, builder } = fixture(t)
  const vuepress = path.join(root, 'node_modules/vuepress')
  fs.outputJsonSync(path.join(vuepress, 'package.json'), { name: 'vuepress', main: 'index.js' })
  fs.outputFileSync(path.join(vuepress, 'index.js'), '')
  const original = childProcess.spawn
  t.after(() => { childProcess.spawn = original })
  let active = 0
  let maximum = 0
  let releasedEarly = false
  const manifest = path.join(builder.options.destination, '.split-build.json')
  const before = fs.readFileSync(manifest, 'utf8')
  childProcess.spawn = (command, args) => {
    assert.equal(args[0], '--max-old-space-size=2048')
    const temporary = args[args.indexOf('build') + 1]
    const site = path.basename(path.dirname(temporary))
    const child = new EventEmitter()
    active++
    maximum = Math.max(maximum, active)
    setTimeout(() => {
      if (!fs.existsSync(path.join(root, '.build/build.lock'))) releasedEarly = true
      if (site !== 'ai') {
        const output = path.join(path.dirname(temporary), 'output')
        fs.outputJsonSync(path.join(output, 'version.json'), { id: 'new' })
        fs.outputJsonSync(path.join(output, `_sites/${site}/version.json`), { id: 'new' })
      }
      active--
      child.emit('close', site === 'ai' ? 1 : 0)
    }, site === 'ai' ? 10 : 40)
    return child
  }
  await assert.rejects(builder.build(['ai', 'api', '--jobs=2', '--heap-mb=2048']), /Build ai failed/)
  assert.equal(active, 0)
  assert.equal(maximum, 2)
  assert.equal(releasedEarly, false)
  assert(!fs.existsSync(path.join(root, '.build/build.lock')))
  assert.equal(fs.readFileSync(manifest, 'utf8'), before)
})

test('configuration keeps custom base and origin, excludes home-only plugins and namespaces returned output', t => {
  const { root, builder } = fixture(t)
  function createLLMSText() {}
  const settings = { ...builder.options, site: 'ai', pages: ['ai/README.md'], buildId: '100-1', output: path.join(root, 'output'), origin: 'https://docs.example.org', homeOnlyPlugins: ['createLLMSText'] }
  const result = configure({ base: '/manual/', plugins: [[createLLMSText, {}]], themeConfig: { sidebar: { '/ai/': [{ path: '/api/' }] } }, configureWebpack: { output: { filename: 'custom.js' } } }, settings)
  assert(!result.plugins.some(item => item[0] === createLLMSText))
  assert.equal(result.themeConfig.sidebar['/ai/'][0].path, 'https://docs.example.org/manual/api/')
  const config = { output: {}, plugins: [], module: { rules: [] } }
  result.configureWebpack(config, false)
  assert.equal(config.output.filename, '_sites/ai/100-1/custom.js')
  assert.equal(config.output.jsonpFunction, 'webpackJsonp_ai')
})

test('sidebar handles strings, tuples, relative links and requires origin only for cross-site items', () => {
  const settings = { base: '/manual/', origin: 'https://docs.example.org', getSite: file => file.split('/')[0] === 'api' ? 'api' : 'home' }
  const sidebar = { '/api/': ['page.md', ['/README.md', 'Home'], { title: 'Group', path: '/README.md', children: ['other.md'] }] }
  const filtered = configure.filterSidebar(sidebar, 'api', settings)
  assert.equal(filtered['/api/'][0], 'page.md')
  assert.deepEqual(filtered['/api/'][1], ['https://docs.example.org/manual/', 'Home'])
  assert.equal(filtered['/api/'][2].path, undefined)
  assert.deepEqual(filtered['/api/'][2].children, ['other.md'])
  assert.equal(configure.filterSidebar('auto', 'api', settings), 'auto')
  assert.throws(() => configure.filterSidebar(sidebar, 'api', { ...settings, origin: '' }), /origin is required/)
})
