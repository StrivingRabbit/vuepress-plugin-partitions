import fs from 'fs'
import http, { type Server, type ServerResponse } from 'http'
import path from 'path'
import { normalizeOptions } from './options'
import type { PartitionsOptions } from './types'

export function parsePort(args: string[]): number {
  if (args.some(arg => !arg.startsWith('--port='))) throw new Error('Usage: docs-partitions preview [--port=N]')
  const value = args.find(arg => arg.startsWith('--port='))
  const port = Number(value ? value.slice(7) : process.env.PORT || 3000)
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('port must be an integer between 1 and 65535')
  return port
}

const contentTypes: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8', '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml; charset=utf-8',
  '.gif': 'image/gif', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.webp': 'image/webp', '.avif': 'image/avif', '.ico': 'image/x-icon',
  '.ttf': 'font/ttf', '.woff': 'font/woff', '.woff2': 'font/woff2', '.mp4': 'video/mp4', '.webm': 'video/webm',
}

const rootAssetTypes = new Set(['.js', '.mjs', '.css', '.gif', '.png', '.jpg', '.jpeg', '.svg', '.webp', '.avif', '.ico', '.ttf', '.woff', '.woff2', '.mp4', '.webm'])

export function createPreviewServer(input: PartitionsOptions, projectRoot: string = process.cwd()): Server {
  const { base, destination } = normalizeOptions(input, path.resolve(projectRoot))
  const root = fs.realpathSync(destination)
  const inside = (filename: string): boolean => {
    const relative = path.relative(root, filename)
    return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
  }
  const sendError = (response: ServerResponse, status: number): void => {
    response.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' })
    response.end(http.STATUS_CODES[status])
  }
  return http.createServer((request, response) => {
    if (!['GET', 'HEAD'].includes(request.method || '')) {
      response.setHeader('Allow', 'GET, HEAD')
      return sendError(response, 405)
    }
    let requestUrl: URL, pathname: string
    try {
      requestUrl = new URL(request.url || '/', 'http://localhost')
      pathname = decodeURIComponent(requestUrl.pathname)
      if (pathname.includes('\0')) return sendError(response, 400)
    } catch (error) { return sendError(response, 400) }
    if (base !== '/' && (pathname === '/' || pathname === base.slice(0, -1))) {
      response.writeHead(302, { Location: base + requestUrl.search })
      return response.end()
    }
    const hasBase = pathname.startsWith(base)
    // 兼容 SDK 使用 /worker.js、/logo.png 等根路径；页面和 JSON 仍必须通过 base 访问。
    if (!hasBase && !rootAssetTypes.has(path.extname(pathname).toLowerCase())) return sendError(response, 404)
    // base 只映射访问路径，不改变磁盘上的 dist 结构。
    const filename = path.resolve(root, hasBase ? pathname.slice(base.length) : `.${pathname}`)
    if (!inside(filename)) return sendError(response, 403)
    let candidates: string[]
    try {
      candidates = fs.statSync(filename).isDirectory() ? [path.join(filename, 'index.html'), `${filename}.html`] : [filename]
    } catch (error) {
      if (!['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code || '')) return sendError(response, 500)
      candidates = path.extname(filename) ? [] : [`${filename}.html`]
    }
    for (const candidate of candidates) {
      let real: string, stats: fs.Stats
      try {
        real = fs.realpathSync(candidate)
        if (!inside(real)) return sendError(response, 403)
        stats = fs.statSync(real)
        if (!stats.isFile()) continue
      } catch (error) {
        if (['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code || '')) continue
        return sendError(response, 500)
      }
      const headers = { 'Cache-Control': 'no-cache', 'Content-Length': stats.size, 'Content-Type': contentTypes[path.extname(real).toLowerCase()] || 'application/octet-stream' }
      if (request.method === 'HEAD') {
        response.writeHead(200, headers)
        return response.end()
      }
      const stream = fs.createReadStream(real)
      stream.on('open', () => { response.writeHead(200, headers); stream.pipe(response) })
      stream.on('error', () => response.headersSent ? response.destroy() : sendError(response, 500))
      response.on('close', () => stream.destroy())
      return
    }
    // 不使用 SPA 兜底，缺失的版本 JSON 和分区页面必须返回 404。
    sendError(response, 404)
  })
}
