import VersionCheck from '@partition-version-component'
import type { VueConstructor } from 'vue'
import type VueRouter from 'vue-router'

interface EnhanceContext {
  Vue: VueConstructor
  router: VueRouter
  siteData: { base: string }
}

const enhanceApp = ({ Vue, router, siteData }: EnhanceContext): void => {
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
