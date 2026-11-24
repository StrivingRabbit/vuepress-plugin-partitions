import path from 'path'
import type { Server } from 'http'
import { createBuilder } from './build'
import { loadOptions } from './options'
import { createPreviewServer, parsePort } from './preview'
import type { BuildPlan } from './types'

export function build(args: string[] = [], root: string = process.cwd()): Promise<BuildPlan> {
  root = path.resolve(root)
  return createBuilder(loadOptions(root), root).build(args)
}

export function preview(args: string[] = [], root: string = process.cwd()): Server {
  root = path.resolve(root)
  const options = loadOptions(root)
  let port = parsePort(args)
  const server = createPreviewServer(options, root)
  server.on('error', (error: NodeJS.ErrnoException) => {
    // 直接绑定再处理冲突，避免先探测空闲端口后被其他进程抢占。
    if (error.code === 'EADDRINUSE' && port < 65535) {
      server.listen(++port, '0.0.0.0')
      return
    }
    console.error(error.message)
    process.exitCode = 1
  })
  server.once('listening', () => {
    console.log(`Preview: http://localhost:${port}${options.base || '/'}`)
  })
  server.listen(port, '0.0.0.0')
  return server
}

export { createBuilder, createPreviewServer }
export { defineConfig, loadOptions } from './options'
export { default as configureBuildCache } from './cache'
export type { PartitionsOptions, FingerprintContext, Builder, BuildPlan, BuildManifest, SiteManifest, BuildOutput, AssembledSite, NormalizedOptions, BuildArguments } from './types'
