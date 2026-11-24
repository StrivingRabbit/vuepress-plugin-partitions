import fs from 'fs-extra'
import path from 'path'
import crypto from 'crypto'

export function listFiles(directory: string, ignored: (filename: string) => boolean = () => false): string[] {
  if (!fs.existsSync(directory)) return []
  const files: string[] = []
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name)
    // Finder 元数据不参与编译，忽略它以免误触发全量构建。
    if (entry.name === '.DS_Store' || ignored(target)) continue
    if (entry.isDirectory()) files.push(...listFiles(target, ignored).map(file => `${entry.name}/${file}`))
    else if (entry.isFile()) files.push(entry.name)
  }
  return files.sort()
}

export function digest(directory: string, files: string[]): string {
  const hash = crypto.createHash('sha256')
  for (const file of files) hash.update(file).update('\0').update(fs.readFileSync(path.join(directory, file))).update('\0')
  return hash.digest('hex')
}
