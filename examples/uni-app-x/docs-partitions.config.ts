// 将此文件放到文档仓库根目录；依赖发布后再切换构建入口。
import { defineConfig } from 'vuepress-plugin-partitions'

export default defineConfig({
  source: 'docs',
  base: require('./docs/.vuepress/config/base'),
  origin: 'https://doc.dcloud.net.cn',
  sections: require('./sites').sections,
  homeOnlyPlugins: ['createLLMSText'],
  versionCheckUI: 'theme',
  fingerprint: require('./scripts/partition-inputs'),
})
