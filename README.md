# vuepress-plugin-partitions

适用于 VuePress 1.9.x / Webpack 4 的文档分区构建工具。源码保留在原文档目录，独立编译一级分类后合并为完整静态站点，不改变现有页面 URL 和发布目录。构建运行环境为 Node.js 16 及以上，建议使用 Node.js 22；测试使用 Node.js 22。

## 安装与接入

包发布后在文档仓库安装：

```sh
yarn add -D vuepress-plugin-partitions
```

在文档仓库根目录创建 `docs-partitions.config.ts`：

```ts
import { defineConfig } from 'vuepress-plugin-partitions'

export default defineConfig({
  source: 'docs',
  base: '/manual/',
  origin: 'https://docs.example.org',
  sections: ['api', 'component'],
})
```

消费仓库需要已安装 VuePress 1.9.x。VuePress 自带 Webpack 4，常规 Yarn/npm 安装无需在文档项目中额外声明 Webpack。公共包通过 peer dependency 声明 Webpack 兼容范围；本地使用 `yarn link` 时，应先安装公共包自身的开发依赖，让链接包内的 Terser 能解析到 Webpack 4。

`base` 必须和原 `.vuepress/config.js` 一致，建议两边引用同一个小配置文件。`source` 默认 `docs`；`dest` 默认 `<source>/.vuepress/dist`。只将需要独立编译的一级目录列入 `sections`，根页面和其他分类自动归入 `home`。

在 `package.json` 中配置命令：

```json
{
  "scripts": {
    "build": "docs-partitions build",
    "build:changed": "docs-partitions build --changed",
    "build:sites": "docs-partitions build",
    "preview": "docs-partitions preview"
  }
}
```

使用公共文档同步的仓库，应保留同步步骤，例如 `"build:changed": "npm run sync && docs-partitions build --changed"`。工具读取同步后的实际内容，不依赖 Git 修改列表或文件修改时间。

```sh
yarn build
yarn build:changed
yarn build:sites api --jobs=2
yarn build:sites api --heap-mb=4096
yarn build:changed --plan
yarn preview --port=3001
yarn docs-partitions --help
yarn build:sites --help
yarn preview --help
```

工具自动包装原 VuePress 配置，不需要再手动注册一次插件。原来的 Markdown 注入、主题、侧边栏生成等逻辑仍由文档仓库维护。

`defineConfig` 提供配置项和钩子参数的类型提示。也兼容 CommonJS 的 `docs-partitions.config.js`，可使用 JSDoc 检查类型：

```js
/** @type {import('vuepress-plugin-partitions').PartitionsOptions} */
module.exports = {
  base: '/manual/',
  sections: ['api'],
}
```

配置文件按 `.ts`、`.js` 的顺序查找；两者并存时优先使用 `.ts`，加载失败会直接报错，不回退到旧配置。工具按需使用自带的 `ts-node` 和 TypeScript 转译 TS 配置及其导入的 TS 模块，支持 `export default` 和 `module.exports`。消费项目无需额外安装加载器；不读取项目 `tsconfig.json`，不执行类型检查，也不解析其中的路径别名。包同时导出 `loadOptions(root)`，供自定义脚本复用相同的配置加载逻辑。

## 构建与发布约定

- 每个分区的临时目录为 `.build/<分区>/docs`。为兼容跨目录文件引用，临时目录保留完整源码副本，通过 `patterns` 限定编译页面。
- `.vuepress/public` 只进入 `home`。公共目录的 `sitemap.xml` 若存在，会由主站同步；工具不会为整个站点主动生成 sitemap 或 llms。
- 根页面及非独立分类属于 `home`。删除分类配置后建议执行一次全部构建。
- 配置、JSON、侧边栏、依赖锁文件和共享输入变化触发全部分区构建；普通页面只影响所属分区；`.DS_Store` 不参与指纹。
- 包的构建实现参与指纹；预览服务代码和 `.d.ts` 不影响构建指纹，避免只改本地预览或类型就重建全部分区。
- 指定分区时自动补齐缺失基线；已有完整产物的其他分区保留。指定分区不会自动重建其他内容已变化但基线完整的分区，自动部署应使用 `--changed`。
- 默认顺序构建、使用 Node 默认堆上限。`--jobs=N` 为独立 VuePress 进程数量；失败后停止分派，等待已启动进程退出后释放锁，失败批次不合并。
- `--prepare` 只组装临时目录，`--plan` 只查看构建计划。`.build/build.lock` 遗留时，先确认没有正在构建的进程，再手动删除。
- 构建时禁用 loader/Terser 磁盘缓存，dev 继续使用原配置。需要对原单站 build 复用时，可在 `chainWebpack` 调用导出的 `configureBuildCache`。

产物保持以下协议，可与现有堡垒机部署及清理代码配合：

```text
dist/
  index.html
  api/index.html
  version.json
  .split-build.json
  _sites/home/version.json
  _sites/home/<时间戳-进程号>/...
  _sites/api/version.json
  _sites/api/<时间戳-进程号>/...
```

分区标记保留 `{ "id": "客户端版本", "assets": "时间戳-进程号" }`；清单保留 `{ "sites": { "分区": { "signature": "指纹", "files": [] } } }`。`.split-build.json` 必须随完整 dist 同步到发布机，不应上传为公开资源。内容 CDN 刷新成功后才发布分区标记；全量发布的根标记最后写入。

本包不包含 COS、CDN 或 Git 发布操作。其他站点要启用按分区上传，堡垒机必须为该站点开启相应配置；仅安装本包不会自动修改生产发布策略。

预览时，页面和版本 JSON 从配置的 base 访问；已有 SDK 使用的 `/worker.js`、`/logo.png` 等根路径静态资源会映射到同一 dist，不需要改写线上脚本。不存在的文件始终返回 404。

预览端口默认为 `PORT` 环境变量或 `3000`，也可通过 `--port=N` 指定起始端口。端口被占用时依次尝试下一个端口（最多到 `65535`），终端会输出实际访问地址。其他监听错误仍会报错退出。

运行 `docs-partitions`、`docs-partitions help` 或 `docs-partitions --help` 可查看命令和参数说明；也支持 `help build`、`help preview`、`build --help` 和 `preview --help`。帮助命令不要求存在项目配置或构建产物。

## 可选配置

```js
module.exports = {
  source: 'docs',
  dest: 'docs/.vuepress/dist',
  base: '/manual/',
  sections: ['api', 'component'],
  // 兼容旧配置保留，当前不参与跨分区链接生成，可省略。
  origin: 'https://docs.example.org',
  // 插件请求名，或通过函数配置插件时的函数名；只过滤原配置的 plugins 数组。
  homeOnlyPlugins: ['createLLMSText'],
  // 默认 global；主题已经渲染 VuepressVersionCheck 时用 theme，避免重复提示。
  versionCheckUI: 'theme',
  sharedFiles: ['extra-config/**/*.js'],
  // 同步返回字符串，额外跟踪文档目录之外的源码；不把敏感内容写入清单。
  fingerprint({ root, source }) {
    return ''
  },
}
```

内置共享指纹包含文档配置、非页面文件、全部 `_sidebar.md`、根目录 docs-partitions.config.ts/js、package.json/锁文件/docs-sync.config.ts/.env，以及 scripts/shared/sites。`sharedFiles` 在这些默认输入上追加项目相对 glob；配置导入的文件若不在上述范围内，也应通过 `sharedFiles` 或 `fingerprint` 声明。

`fingerprint` 是可选的同步函数，用于补充项目目录之外的依赖。返回字符串参与所有分区的共享指纹比较，值改变时 `--changed` 会重建全部分区；它不负责监听或同步文件。`examples/uni-app-x/partition-inputs.js` 是 uni-app x 的适配脚本，读取示例映射及 `.env`，计算外部示例源码、`pages.json` 和示例地址配置的指纹。没有这类外部依赖的项目可省略该脚本和 `fingerprint` 配置。

`versionCheckUI` 只决定版本提示组件由谁挂载。默认 `global`，由插件挂载；主题已渲染 `VuepressVersionCheck` 时使用 `theme`，避免重复提示。两种方式都会使用当前分区的 `<base>_sites/<分区>/version.json` 检查更新，`theme` 不会关闭版本检查。

VuePress 原配置支持通常的 `chainWebpack` 和 `configureWebpack` 函数/对象。侧边栏支持字符串、`[路径, 标题]`、分组对象和 `auto`；跨分区项保留为内部链接。工具在应用初始化时补充这些链接所需的轻量页面元数据，让主题正常解析；不会编译其他分区文档或生成其路由、组件。点击后由路由守卫在当前标签页、当前域名下整页跳转，不依赖 `origin`，也不需要修改主题。真正的外链继续使用原有行为。

跨分区侧边栏支持 `#锚点`。VuePress 1 的主题侧边栏解析器不能正确处理 `?query`，此类配置会明确报错，避免丢失参数或生成错误地址；普通 Markdown 链接的查询参数不受此限制。

## 从 uni-app x 迁移

`examples/uni-app-x` 提供适配文件：

1. 将 `docs-partitions.config.ts` 放到文档根目录，也可沿用现有 `.js` 配置。
2. 将 `partition-inputs.js` 放到该文档的 `scripts/`，保留 EXAMPLEJSON 对外部源码的指纹。
3. 安装已发布版本，构建与 preview 命令切换为上面的 CLI，保留 `npm run sync &&` 前缀。
4. 验证后删除原有 `scripts/build-sites.js`、`scripts/serve-dist.js`、`shared/.vuepress`；保留站点自己的 `sites`、base、Markdown 插件和同步配置。
5. 如需保留原单站缓存治理入口，可将 `config/build-cache.js` 改为 `module.exports = require('vuepress-plugin-partitions').configureBuildCache`。

新包的指纹包含自身版本和实现，首次切换需要重建一次全部分区。生产切换前应验证：完整构建、连续两次无变化计划、单区改动、深层刷新、跨区跳转、版本提示，以及清单完整同步。原单站构建命令可继续保留用于回退。

## 开发与子模块登记

本目录是独立包，可在独立 Git 仓库中提交后推送到用户创建的远端。远端地址确定、包仓库已有首次提交后，在父仓库执行：

```sh
git submodule add <包仓库远端地址> packages/vuepress-plugin-partitions
```

这会生成父仓库的 `.gitmodules` 配置及子模块引用。不要把开发机器的本地绝对路径登记为 submodule URL。当前无需依赖 GitHub Actions。

使用 pnpm 10.13.1 开发，建议 Node.js 22。当前包位于父仓库的 workspace 内，独立安装时加上 `--ignore-workspace`，使用本包的 `pnpm-lock.yaml`，避免修改父仓库的依赖和锁文件：

```sh
pnpm install --ignore-workspace --config.auto-install-peers=false
pnpm run typecheck
pnpm run build
pnpm test
pnpm pack
```

提交本包的 `pnpm-lock.yaml`，后续本地复现或 CI 安装使用：

```sh
pnpm install --ignore-workspace --config.auto-install-peers=false --frozen-lockfile
```

安装命令中的 `--config.auto-install-peers=false` 关闭 peer dependency 自动安装，VuePress 由消费项目提供；Webpack 等本包测试需要的依赖已在 `devDependencies` 中声明。冻结安装时也要保留该参数，与锁文件中的设置一致。文档消费项目可以继续使用 Yarn，与公共包自身的包管理器互不影响。

源码在 `src/`，TypeScript 配置参照同工作区的 `uni-docs-utils`：严格检查、CommonJS、声明文件输出到 `lib/`。CLI 源码是 `src/cli.ts`，发布入口是编译后的 `lib/cli.js`；构建步骤会设置可执行权限，保证 `yarn link` 后可以直接运行。`lib/` 是忽略的生成目录，`pnpm test` 会先编译，打包或发布通过 `prepack` 自动编译，不发布 TS 源码或测试文件。

测试在临时目录运行，不会上传 COS 或刷新 CDN。真实 VuePress 构建需要消费仓库安装 VuePress 1.9.x。

消费仓库安装默认主题和官方主题后，可直接调用它们未修改的侧边栏解析器做集成检查：

```sh
node test/verify-sidebar-themes.js /path/to/docs-project
```
