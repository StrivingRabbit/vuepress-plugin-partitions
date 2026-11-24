import type ChainConfig from 'webpack-chain'

function configureBuildCache(config: ChainConfig): void {
  // 只在构建时治理磁盘缓存，开发服务继续使用原有缓存加快热更新。
  if (process.env.NODE_ENV !== 'production') return
  const TerserPlugin = require('terser-webpack-plugin')
  config.module.rules.values().forEach(rule => {
    rule.uses.delete('cache-loader')
    if (rule.uses.has('vue-loader')) {
      rule.use('vue-loader').tap((options: Record<string, unknown>) => {
        const result = { ...options }
        delete result.cacheDirectory
        delete result.cacheIdentifier
        return result
      })
    }
    if (rule.uses.has('babel-loader')) rule.use('babel-loader').tap((options: Record<string, unknown>) => ({ ...options, cacheDirectory: false }))
  })
  // webpack-chain 6 的声明遗漏了运行时存在的 minimizers，仅在访问点补充该字段。
  const minimizers = (config.optimization as ChainConfig.Optimization & {
    minimizers: { values(): ChainConfig.Plugin<ChainConfig.Optimization>[] }
  }).minimizers
  if (!minimizers.values().length) {
    config.optimization.minimizer('terser').use(TerserPlugin, [{ cache: false, parallel: 2, sourceMap: /source-?map/.test(config.get('devtool') || '') }])
  } else {
    minimizers.values().forEach(minimizer => {
      const plugin = minimizer.get('plugin') as { name?: string } | undefined
      if (plugin && plugin.name === 'TerserPlugin') minimizer.tap((args: unknown[]) => [{ ...(args[0] as Record<string, unknown>), cache: false }, ...args.slice(1)])
    })
  }
}

export = configureBuildCache
