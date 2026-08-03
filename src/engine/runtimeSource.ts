/**
 * 运行库源码(R20-2):由 vite 插件在构建时把 runtime-dist/theloom-runtime.js
 * 内嵌为字符串。没跑过 `npm run build:runtime` 时为空串 —— 界面据此禁用
 * 「包含运行库」而不是打出一个缺文件的包。
 */
import runtimeSource from 'virtual:theloom-runtime-source';

export const RUNTIME_SOURCE: string = runtimeSource || '';
export const RUNTIME_AVAILABLE = RUNTIME_SOURCE.length > 0;
