import { createBuilder, build, createPreviewServer, configureBuildCache, defineConfig, loadOptions } from '../lib'
import type { PartitionsOptions, BuildPlan, BuildManifest } from '../lib'
import type ChainConfig from 'webpack-chain'
import type { Server } from 'http'

const options: PartitionsOptions = {
  source: 'content',
  base: '/manual/',
  sections: ['api'],
  versionCheckUI: 'theme',
  fingerprint: ({ root, source }) => root + source,
}

const typedOptions: PartitionsOptions = defineConfig({
  sections: ['api'],
  fingerprint: ({ root, source }) => root + source,
})
const loadedOptions: PartitionsOptions = loadOptions('.')

const builder = createBuilder(options)
const plan: BuildPlan = builder.getPlan([], true)
const manifest: BuildManifest = plan.previous
const selected: string[] = plan.selected
const pending: Promise<BuildPlan> = build(['--plan'])
const server: Server = createPreviewServer(options)
const configure: (config: ChainConfig) => void = configureBuildCache
void [manifest, selected, pending, server, configure, typedOptions, loadedOptions]

// @ts-expect-error 分区必须是字符串数组。
const invalidSections: PartitionsOptions = { sections: 'api' }
// @ts-expect-error 指纹钩子必须同步返回字符串。
const invalidFingerprint: PartitionsOptions = { fingerprint: async () => 'async' }
// @ts-expect-error UI 模式只允许已声明的值。
const invalidUI: PartitionsOptions = { versionCheckUI: 'unknown' }
// @ts-expect-error defineConfig 同样检查配置类型。
const invalidConfig = defineConfig({ versionCheckUI: 'unknown' })
void [invalidSections, invalidFingerprint, invalidUI, invalidConfig]
