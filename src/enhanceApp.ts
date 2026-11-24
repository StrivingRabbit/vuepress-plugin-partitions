import VersionCheck from '@partition-version-component'
import type { VueConstructor } from 'vue'
import type VueRouter from 'vue-router'
import type { SidebarPage } from './vuepress'

interface EnhanceContext {
  Vue: VueConstructor
  router: VueRouter
  siteData: { base: string; pages: SidebarPage[] }
}

const enhanceApp = ({ Vue, router, siteData }: EnhanceContext): void => {
  // 仅补充主题解析跨分区侧边栏所需的元数据，不生成页面、路由或组件。
  const knownPaths = new Set(siteData.pages.map(page => page.path))
  for (const page of __DOCS_SPLIT_SIDEBAR_PAGES__) {
    if (!knownPaths.has(page.path)) {
      siteData.pages.push(page)
      knownPaths.add(page.path)
    }
  }
  Vue.component('VuepressVersionCheck', {
    extends: VersionCheck,
    computed: {
      versionUrl() {
        return `${siteData.base}_sites/${__DOCS_SPLIT_SITE__}/version.json`
      },
    },
  })
  router.beforeEach((to, from, next) => {
    const section = to.path.split('/')[1]
    const owner = __DOCS_SPLIT_SECTIONS__.includes(section) ? section : 'home'
    if (owner !== __DOCS_SPLIT_SITE__ && typeof window !== 'undefined') {
      // 目标分区使用独立路由和资源，跨分区必须进行整页导航。
      window.location.assign(siteData.base.replace(/\/$/, '') + to.fullPath)
      next(false)
      return
    }
    next()
  })
}

// VuePress 1.9 通过源码中的 module.exports 识别增强入口，exports.default 会被忽略。
export = enhanceApp
