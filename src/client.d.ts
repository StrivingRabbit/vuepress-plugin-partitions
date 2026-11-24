declare const __DOCS_SPLIT_SITE__: string
declare const __DOCS_SPLIT_SECTIONS__: string[]

declare module '@partition-version-component' {
  import type Vue from 'vue'
  import type { ComponentOptions } from 'vue'
  const component: ComponentOptions<Vue>
  export default component
}
