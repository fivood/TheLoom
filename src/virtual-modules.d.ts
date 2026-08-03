declare module 'virtual:theloom-runtime-source' {
  /** runtime-dist/theloom-runtime.js 的源码;构建时由 vite 插件内嵌 */
  const source: string;
  export default source;
}
