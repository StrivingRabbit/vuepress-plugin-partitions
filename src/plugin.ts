import fs from 'fs-extra'
import path from 'path'
import type { PluginSettings, PluginContext, PageData } from './vuepress'

const createPlugin = ({ site, sections, source, buildId, versionCheckUI, sidebarPages = [] }: PluginSettings, ctx: PluginContext) => ({
  name: 'vuepress-plugin-partitions',
  alias: { '@partition-version-component': require.resolve('vuepress-plugin-version-check/lib/VersionCheck.vue') },
  define() {
    return { __DOCS_SPLIT_SITE__: site, __DOCS_SPLIT_SECTIONS__: sections, __DOCS_SPLIT_SIDEBAR_PAGES__: sidebarPages }
  },
  enhanceAppFiles: path.join(__dirname, 'enhanceApp.js'),
  // 自带提示组件的主题由主题渲染，其他主题通过全局 UI 挂载，避免重复提示。
  globalUIComponents: versionCheckUI === 'theme' ? [] : ['VuepressVersionCheck'],
  extendPageData(page: PageData): void {
    if (!page.relativePath || !page._filePath) return
    const original = page._filePath
    try {
      page._filePath = path.join(source, page.relativePath)
      const lastUpdated = require('@vuepress/plugin-last-updated') as (options: Record<string, unknown>, context: PluginContext) => { extendPageData(page: PageData): void }
      lastUpdated({}, ctx).extendPageData(page)
    } finally {
      page._filePath = original
    }
  },
  ready() {
    const sitemap = path.join(source, '.vuepress/public/sitemap.xml')
    if (site === 'home' && fs.existsSync(sitemap)) fs.copySync(sitemap, path.join(ctx.vuepressDir, 'public/sitemap.xml'))
  },
  generated() {
    const marker = path.join(ctx.outDir, 'version.json')
    if (!fs.existsSync(marker)) throw new Error(`Missing version marker for ${site}`)
    // assets 仍使用时间戳-进程号，兼容堡垒机的分区比较和旧资源清理。
    fs.outputJsonSync(path.join(ctx.outDir, `_sites/${site}/version.json`), { ...fs.readJsonSync(marker), assets: buildId })
  },
})

export = createPlugin
