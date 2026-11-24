const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs-extra')
const path = require('path')
const os = require('os')
const http = require('http')
const { createPreviewServer } = require('../lib/preview')
const { preview } = require('../lib')
const { spawn } = require('child_process')

test('preview skips consecutive occupied ports and serves output on the actual port', { timeout: 10000 }, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'partition-preview-ports-'))
  t.after(() => fs.removeSync(root))
  fs.outputFileSync(path.join(root, 'docs-partitions.config.ts'), "const base: string = '/manual/'; export default { base }")
  fs.outputFileSync(path.join(root, 'docs/.vuepress/dist/index.html'), 'Preview')
  const reserved = []
  t.after(() => Promise.all(reserved.map(server => new Promise(resolve => server.close(resolve)))))
  // 由系统分配起始端口，避免测试占用本机已有的预览服务。
  let port
  for (let attempt = 0; attempt < 10; attempt++) {
    const first = http.createServer()
    await new Promise(resolve => first.listen(0, '0.0.0.0', resolve))
    port = first.address().port
    if (port >= 65534) { await new Promise(resolve => first.close(resolve)); continue }
    const second = http.createServer()
    const error = await new Promise(resolve => {
      second.once('error', resolve)
      second.listen(port + 1, '0.0.0.0', () => resolve(null))
    })
    if (!error) { reserved.push(first, second); break }
    await new Promise(resolve => first.close(resolve))
    if (error.code !== 'EADDRINUSE') throw error
  }
  assert.equal(reserved.length, 2, 'could not reserve consecutive ports')
  const previousExitCode = process.exitCode
  const server = preview([`--port=${port}`], root)
  t.after(() => new Promise(resolve => server.close(resolve)))
  await new Promise(resolve => server.once('listening', resolve))
  assert(server.address().port >= port + 2)
  assert.equal(server.address().address, '0.0.0.0')
  assert.equal(process.exitCode, previousExitCode)
  const body = await new Promise((resolve, reject) => {
    http.get({ hostname: '127.0.0.1', port: server.address().port, path: '/manual/', agent: false }, response => {
      let body = ''
      response.on('data', data => { body += data })
      response.on('end', () => resolve(body))
    }).on('error', reject)
  })
  assert.equal(body, 'Preview')
})

test('preview exits with an error when port 65535 is occupied', { timeout: 10000 }, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'partition-preview-limit-'))
  t.after(() => fs.removeSync(root))
  fs.outputFileSync(path.join(root, 'docs-partitions.config.js'), 'module.exports = {}')
  fs.ensureDirSync(path.join(root, 'docs/.vuepress/dist'))
  const reserved = http.createServer()
  const error = await new Promise(resolve => {
    reserved.once('error', resolve)
    reserved.listen(65535, '0.0.0.0', () => resolve(null))
  })
  if (error && error.code !== 'EADDRINUSE') throw error
  if (!error) t.after(() => new Promise(resolve => reserved.close(resolve)))
  const child = spawn(process.execPath, [path.join(__dirname, '../lib/cli.js'), 'preview', '--port=65535'], { cwd: root })
  t.after(() => { if (child.exitCode === null) child.kill() })
  let stderr = ''
  child.stderr.on('data', data => { stderr += data })
  const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('close', resolve) })
  assert.equal(code, 1, stderr)
  assert.match(stderr, /EADDRINUSE/)
})

test('preview mounts flat output at base, preserves HTML URLs and rejects missing JSON and traversal', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'partition-preview-'))
  t.after(() => fs.removeSync(root))
  const output = path.join(root, 'content/.vuepress/dist')
  for (const [file, body] of Object.entries({ 'index.html': 'Home', 'api/index.html': 'API', 'api/page.html': 'Page', '_sites/api/app.js': 'bundle', 'worker.js': 'self.addEventListener("fetch", () => {})', 'logo.svg': '<svg></svg>', 'version.json': '{"id":"version"}' })) fs.outputFileSync(path.join(output, file), body)
  const server = createPreviewServer({ source: 'content', base: '/manual/' }, root)
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))
  const request = (url, method = 'GET') => new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: server.address().port, path: url, method, agent: false }, response => {
      let body = ''
      response.on('data', data => { body += data })
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body }))
    })
    req.on('error', reject)
    req.end()
  })
  for (const [url, body] of [['/', 'Home'], ['/api/', 'API'], ['/api/page', 'Page'], ['/api/page/', 'Page'], ['/api/page.html', 'Page'], ['/_sites/api/app.js', 'bundle']]) {
    const result = await request('/manual' + url)
    assert.equal(result.status, 200, url)
    assert.equal(result.body, body, url)
  }
  assert.equal((await request('/?q=1')).headers.location, '/manual/?q=1')
  assert.equal((await request('/manual')).headers.location, '/manual/')
  assert.equal((await request('/manuals/')).status, 404)
  assert.equal((await request('/worker.js?config=1')).status, 200)
  assert.equal((await request('/logo.svg')).status, 200)
  assert.equal((await request('/version.json')).status, 404)
  assert.equal((await request('/api/page.html')).status, 404)
  assert.equal((await request('/missing.js')).status, 404)
  assert.equal((await request('/manual/missing.json')).status, 404)
  assert.equal((await request('/manual/%ZZ')).status, 400)
  assert.equal((await request('/manual/%2e%2e%2foutside')).status, 403)
  assert.equal((await request('/manual/api/page.html', 'HEAD')).body, '')
  assert.equal((await request('/manual/', 'POST')).status, 405)
  assert.match((await request('/manual/version.json?t=1')).headers['content-type'], /application\/json/)
  assert(!fs.existsSync(path.join(output, 'manual')))
})
