import type { Configuration } from 'webpack'
import type ChainConfig from 'webpack-chain'
import type { PartitionsOptions } from './types'

// 仅描述适配层会访问的字段，允许原站点继续携带主题和插件自定义配置。
export type SidebarItem = string | [string, string] | SidebarGroup
export interface SidebarGroup {
  path?: string
  title?: string
  type?: string
  children?: SidebarItem[]
  [key: string]: unknown
}
export type Sidebar = 'auto' | false | SidebarItem[] | Record<string, SidebarItem[] | 'auto' | false>

export interface SiteConfig {
  base?: string
  plugins?: unknown[] | Record<string, unknown>
  themeConfig?: { sidebar?: Sidebar; [key: string]: unknown }
  chainWebpack?: (config: ChainConfig, isServer: boolean) => void
  configureWebpack?: Configuration | ((config: Configuration, isServer: boolean) => Configuration | void)
  [key: string]: unknown
}

export interface BuildSettings extends PartitionsOptions {
  root: string
  site: string
  pages: string[]
  output: string
  buildId: string
}

export interface PluginSettings {
  source: string
  site: string
  sections: string[]
  buildId: string
  versionCheckUI?: PartitionsOptions['versionCheckUI']
}

export interface PluginContext {
  outDir: string
  vuepressDir: string
}

export interface PageData {
  relativePath?: string
  _filePath?: string
}

export interface VersionPlugin {
  name: string
  define(): Record<string, string>
  generated(): void
}
