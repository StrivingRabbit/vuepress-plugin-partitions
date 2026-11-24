import path from 'path'
import merge from 'webpack-merge'
import type { Configuration, RuleSetRule, Plugin } from 'webpack'
import type ChainConfig from 'webpack-chain'
import configureCache from './cache'
import createPlugin from './plugin'
import { normalizeOptions } from './options'
import type { NormalizedOptions } from './types'
import type { SiteConfig, ThemeConfig, BuildSettings, Sidebar, SidebarItem, SidebarPage, PluginContext, VersionPlugin } from './vuepress'

interface CssExtractPlugin extends Plugin {
  options: { filename: string; chunkFilename: string }
}

function filterSidebar(sidebar: Sidebar | undefined, site: string, settings: Pick<NormalizedOptions, 'base' | 'getSite'>, sidebarPages: SidebarPage[] = []): Sidebar | undefined {
  const { base, getSite } = settings
  const targetPath = (raw: string | undefined, directory: string): string | null => {
    if (!raw || /^(?:[a-z][a-z\d+.-]*:|\/\/|[?#])/i.test(raw)) return null
    const suffixIndex = raw.search(/[?#]/)
    const pathname = suffixIndex < 0 ? raw : raw.slice(0, suffixIndex)
    const suffix = suffixIndex < 0 ? '' : raw.slice(suffixIndex)
    const relative = pathname.startsWith(base) ? pathname.slice(base.length) : pathname.startsWith('/') ? pathname.slice(1) : path.posix.join(directory, pathname)
    const target = path.posix.normalize('/' + relative).slice(1)
    if (getSite(target) === site) return null
    if (suffix.startsWith('?')) throw new Error(`Cross-partition sidebar links cannot contain query parameters in VuePress 1: ${raw}`)
    return target + suffix
  }
  const href = (target: string, title: string = target): string => {
    const suffixIndex = target.search(/[?#]/)
    const pathname = suffixIndex < 0 ? target : target.slice(0, suffixIndex)
    const suffix = suffixIndex < 0 ? '' : target.slice(suffixIndex)
    let canonical = pathname.replace(/(^|\/)README(?:\.md)?$/i, '$1').replace(/\.md$/i, '.html')
    // createSidebar 会提前移除 .md，普通页面仍需输出实际的 HTML 地址。
    if (canonical && !canonical.endsWith('/') && !/\.html$/i.test(canonical)) canonical += '.html'
    const route = '/' + canonical
    if (!sidebarPages.some(page => page.path === route)) sidebarPages.push({ path: route, regularPath: route, title, frontmatter: {} })
    return route + suffix
  }
  const filter = (item: SidebarItem, directory: string): SidebarItem => {
    if (typeof item === 'string') {
      const target = targetPath(item, directory)
      return target === null ? item : href(target, item)
    }
    if (Array.isArray(item)) {
      const target = targetPath(item[0], directory)
      return target === null ? item : [href(target, item[1]), item[1]]
    }
    if (!item) return item
    const children = item.children && item.children.map(child => filter(child, directory))
    const target = targetPath(item.path, directory)
    if (target === null) return children ? { ...item, children } : item
    return { ...item, ...(children ? { children } : {}), path: href(target, item.title) }
  }
  if (Array.isArray(sidebar)) return sidebar.map(item => filter(item, ''))
  if (!sidebar || typeof sidebar !== 'object') return sidebar
  return Object.fromEntries(Object.entries(sidebar).map(([key, items]) => [key, Array.isArray(items) ? items.map(item => filter(item, key.replace(/^\//, ''))) : items]))
}

const configure = Object.assign((base: SiteConfig, input: BuildSettings) => {
  const options = normalizeOptions(input, input.root)
  const { site, pages, output, buildId } = input
  const { root, sections, source } = options
  if (base.base && base.base !== options.base) throw new Error(`VuePress base ${base.base} does not match partition base ${options.base}`)
  const prefix = `_sites/${site}/${buildId}/`
  const sidebarPages: SidebarPage[] = []
  const adaptTheme = (theme: ThemeConfig = {}): ThemeConfig => ({
    ...theme,
    sidebar: filterSidebar(theme.sidebar, site, options, sidebarPages),
    ...(theme.locales ? { locales: Object.fromEntries(Object.entries(theme.locales).map(([locale, config]) => [locale, adaptTheme(config)])) } : {}),
  })
  const themeConfig = adaptTheme(base.themeConfig)
  const homeOnly = options.homeOnlyPlugins || []
  const entries = Array.isArray(base.plugins) ? base.plugins : Object.entries(base.plugins || {})
  const plugins = entries.filter(entry => {
    const plugin = Array.isArray(entry) ? entry[0] : entry
    const pluginRef: unknown = plugin
    const name = typeof pluginRef === 'function' ? pluginRef.name : typeof pluginRef === 'object' && pluginRef && 'name' in pluginRef ? pluginRef.name : pluginRef
    return site === 'home' || typeof name !== 'string' || !homeOnly.includes(name)
  })
  return {
    ...base,
    base: options.base,
    dest: output,
    temp: path.join(root, '.build', site, 'temp'),
    patterns: pages.slice(),
    themeConfig,
    // 版本插件必须先于分区插件执行 generated，确保复制标记时根 version.json 已写入。
    plugins: [...plugins, [require('vuepress-plugin-version-check') as (options: Record<string, unknown>, ctx: PluginContext) => VersionPlugin, {}], [createPlugin, { site, sections, source, buildId, versionCheckUI: options.versionCheckUI, sidebarPages }]],
    chainWebpack(config: ChainConfig, isServer: boolean): void {
      if (base.chainWebpack) base.chainWebpack(config, isServer)
      configureCache(config)
    },
    configureWebpack(config: Configuration, isServer: boolean): void {
      const additional = typeof base.configureWebpack === 'function' ? base.configureWebpack(config, isServer) : base.configureWebpack
      // 先合并原站点配置，再为最终资源路径加前缀，避免返回值覆盖分区资源目录。
      if (additional) Object.assign(config, merge(config, additional))
      if (!isServer) {
        const output = config.output!
        output.filename = prefix + output.filename
        output.chunkFilename = prefix + (output.chunkFilename || '[name].[chunkhash:8].js')
        output.jsonpFunction = `webpackJsonp_${site.replace(/-/g, '_')}`
        for (const plugin of config.plugins || []) {
          if (plugin.constructor.name === 'MiniCssExtractPlugin') {
            const cssPlugin = plugin as CssExtractPlugin
            cssPlugin.options.filename = prefix + cssPlugin.options.filename
            cssPlugin.options.chunkFilename = prefix + cssPlugin.options.chunkFilename
          }
        }
      }
      const visit = (rules?: RuleSetRule[]): void => {
        for (const rule of rules || []) {
          for (const use of Array.isArray(rule.use) ? rule.use : []) {
            if (use && typeof use === 'object' && use.options && typeof use.options === 'object' && typeof use.options.name === 'string') use.options.name = prefix + use.options.name
          }
          visit(rule.oneOf)
          visit(rule.rules)
        }
      }
      visit(config.module && config.module.rules)
    },
  }
}, { filterSidebar })

export = configure
