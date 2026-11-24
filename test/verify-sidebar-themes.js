const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const configure = require('../lib/configure')

const project = path.resolve(process.argv[2] || process.cwd())
const settings = { base: '/manual/', getSite: file => file.split('/')[0] === 'api' ? 'api' : 'home' }
const pages = []
const sidebar = configure.filterSidebar([
  ['/api/theme-change.md', 'Theme'],
  { title: 'Group', path: '/api/README.md', children: [['/api/uni.getLocation', 'Location']] },
  'https://example.org/',
], 'home', settings, pages)

for (const theme of ['@vuepress/theme-default', 'vuepress-theme-uniapp-official']) {
  const filename = require.resolve(`${theme}/util/index.js`, { paths: [project] })
  const source = fs.readFileSync(filename, 'utf8').replace(/import Vue from ['"]vue['"];?/, '').replace(/export /g, '')
  const { resolveSidebarItems } = new Function('Vue', source + '\nreturn { resolveSidebarItems };')({ prototype: {} })
  const page = { frontmatter: {}, regularPath: '/guide.html' }
  const resolved = resolveSidebarItems(page, page.regularPath, { pages, themeConfig: { sidebar } })
  assert.equal(resolved[0].type, 'page')
  assert.equal(resolved[0].path, '/api/theme-change.html')
  assert.equal(resolved[1].type, 'group')
  assert.equal(resolved[1].path, '/api/')
  assert.equal(resolved[1].children[0].path, '/api/uni.getLocation.html')
  assert.equal(resolved[2].type, 'external')
  if (theme === 'vuepress-theme-uniapp-official') {
    const anchored = configure.filterSidebar([['/api/theme-change.md#dark', 'Dark']], 'home', settings, pages)
    const items = resolveSidebarItems(page, page.regularPath, { pages, themeConfig: { sidebar: anchored } })
    assert.equal(items[0].path, '/api/theme-change.html#dark')
  }
  console.log(`Passed sidebar integration: ${theme}`)
}
