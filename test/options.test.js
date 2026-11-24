const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs-extra')
const path = require('path')
const os = require('os')
const { loadOptions, defineConfig } = require('../lib/options')

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'partition-options-'))
  t.after(() => fs.removeSync(root))
  fs.ensureDirSync(path.join(root, 'node_modules'))
  fs.symlinkSync(path.resolve(__dirname, '..'), path.join(root, 'node_modules/vuepress-plugin-partitions'), 'junction')
  return root
}

test('JavaScript config stays compatible without registering a TypeScript loader', t => {
  const root = fixture(t)
  fs.outputFileSync(path.join(root, 'docs-partitions.config.js'), 'module.exports = { sections: ["api"] }')
  assert.deepEqual(loadOptions(root), { sections: ['api'] })
  assert.equal(require.cache[require.resolve('ts-node')], undefined)
  const options = { sections: ['api'] }
  assert.equal(defineConfig(options), options)
})

test('TypeScript config takes precedence, imports typed helpers and ignores project tsconfig', t => {
  const root = fixture(t)
  fs.outputJsonSync(path.join(root, 'tsconfig.json'), { compilerOptions: { module: 'nodenext', moduleResolution: 'invalid' } })
  fs.outputFileSync(path.join(root, 'docs-partitions.config.js'), 'throw new Error("should not load JavaScript config")')
  fs.outputFileSync(path.join(root, 'sections.ts'), 'export const sections: string[] = ["api", "ai"]')
  fs.outputFileSync(path.join(root, 'docs-partitions.config.ts'), [
    'import { defineConfig } from "vuepress-plugin-partitions"',
    'import { sections } from "./sections"',
    'export default defineConfig({ sections, fingerprint: ({ source }) => source })',
  ].join('\n'))
  const options = loadOptions(root)
  assert.deepEqual(options.sections, ['api', 'ai'])
  assert.equal(options.fingerprint({ root, source: 'content' }), 'content')
})

test('TypeScript config also accepts CommonJS exports', t => {
  const root = fixture(t)
  fs.outputFileSync(path.join(root, 'docs-partitions.config.ts'), 'const sections: string[] = ["api"]; module.exports = { sections }')
  assert.deepEqual(loadOptions(root), { sections: ['api'] })
})

test('invalid TypeScript is reported without falling back to JavaScript', t => {
  const root = fixture(t)
  fs.outputFileSync(path.join(root, 'docs-partitions.config.ts'), 'export default { sections: [ }')
  fs.outputFileSync(path.join(root, 'docs-partitions.config.js'), 'module.exports = { sections: ["api"] }')
  assert.throws(() => loadOptions(root), /docs-partitions\.config\.ts/)
})

test('missing config error names both supported filenames', t => {
  const root = fixture(t)
  assert.throws(() => loadOptions(root), /docs-partitions\.config\.ts or docs-partitions\.config\.js/)
})
