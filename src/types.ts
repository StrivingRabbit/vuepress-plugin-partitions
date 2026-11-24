export interface FingerprintContext {
  root: string
  source: string
}

export interface PartitionsOptions {
  source?: string
  dest?: string
  base?: string
  /** @deprecated 保留兼容旧配置，跨分区链接已使用同域路径。 */
  origin?: string
  sections?: string[]
  homeOnlyPlugins?: string[]
  versionCheckUI?: 'global' | 'theme'
  sharedFiles?: string[]
  fingerprint?: (context: FingerprintContext) => string
}

export interface NormalizedOptions extends PartitionsOptions {
  root: string
  source: string
  destination: string
  workspace: string
  base: string
  origin: string
  sections: string[]
  sites: string[]
  getSite: (file: string) => string
}

export interface SiteManifest {
  signature: string
  files: string[]
}

export interface BuildManifest {
  sites: Record<string, SiteManifest>
}

export interface BuildPlan {
  selected: string[]
  missing: string[]
  signatures: Record<string, string>
  sitePages: Record<string, string[]>
  previous: BuildManifest
  destination: string
}

export interface BuildOutput {
  site: string
  output: string
}

export interface AssembledSite {
  source: string
  output: string
}

export interface BuildArguments {
  jobs: number
  heapMb?: number
  targets: string[]
}

export interface Builder {
  options: NormalizedOptions
  getPlan(targets?: string[], changed?: boolean): BuildPlan
  assemble(site: string, pages: string[], buildId: string): AssembledSite
  publish(plan: BuildPlan, built: BuildOutput[]): void
  build(args?: string[]): Promise<BuildPlan>
}
