// FIXME: hish - this is a hack to make the plugin types work. Once ElizaOS publishes the types,
// delete this file.

declare module '@elizaos/plugin-sql' {
  import { Plugin } from '@elizaos/core'
  const sqlPlugin: Plugin
  export default sqlPlugin
}
