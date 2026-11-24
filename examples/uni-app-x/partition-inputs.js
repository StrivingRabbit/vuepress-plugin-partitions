const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

// 此适配器属于文档仓库；通用包不需要了解 EXAMPLEJSON 的映射结构。
module.exports = ({ root, source }) => {
  const mappingFile = path.join(source, '.vuepress/utils/example-mapping.json')
  if (!fs.existsSync(mappingFile)) return ''
  const envFile = path.join(root, '.env')
  const env = { ...(fs.existsSync(envFile) ? require(require.resolve('dotenv', { paths: [root] })).parse(fs.readFileSync(envFile)) : {}), ...process.env }
  const mapping = JSON.parse(fs.readFileSync(mappingFile, 'utf8'))
  const projects = mapping._projects || {}
  const hash = crypto.createHash('sha256')
  const add = file => hash.update(file).update(fs.existsSync(file) ? fs.readFileSync(file) : '<missing>')
  for (const project of Object.values(projects)) {
    for (const key of ['path', 'webPath', 'gitCodePath']) hash.update(env[project[key]] || '')
    if (env[project.path]) add(path.join(env[project.path], 'pages.json'))
  }
  const defaultProject = Object.keys(projects)[0]
  for (const [key, entry] of Object.entries(mapping)) {
    if (key === '_projects') continue
    for (const item of Object.values(entry)) {
      if (!item || typeof item !== 'object' || !item.path) continue
      const project = projects[item.project || entry.project || defaultProject]
      if (project && env[project.path]) add(path.join(env[project.path], item.path))
    }
  }
  return hash.digest('hex')
}
