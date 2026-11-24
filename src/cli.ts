#!/usr/bin/env node
import { build, preview } from './index'

const help = `Usage: docs-partitions <command> [options]

Commands:
  build [sites...]       Build all sites, or selected sites (including missing baselines)
  preview               Preview merged output at the configured base URL
  help [command]        Show help without loading project configuration

Build options:
  --changed             Build sites whose input fingerprints changed
  --jobs=N              Run N VuePress processes concurrently (default: 1)
  --heap-mb=N           Set each build process's Node heap limit in MB (default: Node default)
  --plan                Print the build plan without building or preparing files
  --prepare             Prepare temporary sources without compiling

Preview options:
  --port=N              Starting port (default: PORT environment variable, or 3000)
                        If occupied, try the next port, up to 65535

General options:
  -h, --help            Show this help (also supported after build or preview)

Examples:
  docs-partitions build --changed
  docs-partitions build api component --jobs=2
  docs-partitions build --changed --plan
  docs-partitions preview --port=3000
`

const [command, ...args] = process.argv.slice(2)
Promise.resolve().then((): unknown => {
  if (!command || command === '-h' || command === '--help' || command === 'help') {
    if (command === 'help' && (args.length > 1 || (args.length && !['build', 'preview'].includes(args[0])))) throw new Error('Usage: docs-partitions help [build|preview]')
    console.log(help)
    return
  }
  if ((command === 'build' || command === 'preview') && args.some(arg => arg === '-h' || arg === '--help')) {
    console.log(help)
    return
  }
  if (command === 'build') return build(args)
  if (command === 'preview') return preview(args)
  throw new Error(`Unknown command: ${command}\nRun docs-partitions --help for usage.`)
}).catch(error => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
