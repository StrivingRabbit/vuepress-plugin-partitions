import path from 'path'
import merge from 'webpack-merge'
import type { Configuration, RuleSetRule, Plugin } from 'webpack'
import type ChainConfig from 'webpack-chain'
import configureCache from './cache'
import createPlugin from './plugin'
import { normalizeOptions } from './options'
import type { NormalizedOptions } from './types'
import type { SiteConfig, BuildSettings, Sidebar, SidebarItem, PluginContext, VersionPlugin } from './vuepress'

interface CssExtractPlugin extends Plugin {
  options: { filename: string; chunkFilename: string }
}

function filterSidebar(sidebar: Sidebar | undefined, site: string, settings: Pick<NormalizedOptions, 'base' | 'origin' | 'getSite'>): Sidebar | undefined {
  const { base, origin, getSite } = settings
  const targetPath = (raw: string | undefined, directory: string): string | null => {
    if (!raw || /^(?:[a-z]+:|\/\/|#)/i.test(raw)) return null
    const target = raw.startsWith(base) ? raw.slice(base.length) : raw.startsWith('/') ? raw.slice(1) : path.posix.join(directory, raw)
    return getSite(target.split(/[?#]/)[0]) === site ? null : target
  }
  const external = (target: string): string => {
    if (!origin) throw new Error('origin is required for cross-partition sidebar links (for example https://docs.example.org)')
    const canonical = target.replace(/(^|\/)README\.md(?=[?#]|$)/i, '$1').replace(/\.md(?=[?#]|$)/i, '.html')
    return `${origin}${base}${canonical}`
  }
  const filter = (item: SidebarItem, directory: string): SidebarItem => {
    if (typeof item === 'string') {
      const target = targetPath(item, directory)
      return target === null ? item : external(target)
    }
    if (Array.isArray(item)) {
      const target = targetPath(item[0], directory)
      return target === null ? item : [external(target), item[1]]
    }
    if (!item) return item
    const children = item.children && item.children.map(child => filter(child, directory))
    const target = targetPath(item.path, directory)
    if (target === null) return children ? { ...item, children } : item
    if (children) return { ...item, path: undefined, children }
    // 默认主题通过 URL 协议识别外链，仅设置 type 或使用根相对路径仍会查找缺失页面。
    return { ...item, type: 'external', path: external(target) }
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
    themeConfig: { ...base.themeConfig, sidebar: filterSidebar(base.themeConfig && base.themeConfig.sidebar, site, options) },
    // 版本插件必须先于分区插件执行 generated，确保复制标记时根 version.json 已写入。
    plugins: [...plugins, [require('vuepress-plugin-version-check') as (options: Record<string, unknown>, ctx: PluginContext) => VersionPlugin, {}], [createPlugin, { site, sections, source, buildId, versionCheckUI: options.versionCheckUI }]],
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
