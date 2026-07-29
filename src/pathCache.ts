import type { Entity, Variable } from './types';
import { simulateFlow, type SimOptions, type SimReport } from './simulate';

/**
 * R19-P 路径报告缓存。
 *
 * `simulateFlow` 是 auditProject 的绝对热点:在老伦敦示例项目上,
 * 51 个节点的互动流程要跑满 400 条路径上限,单次约 1.2 秒,占
 * auditProject 总耗时的 99%。而体检面板每次打开、AI 提案 dry-run
 * 前后各跑一次、叙事分析复用同一份数据 —— 同一个流程会被反复模拟。
 *
 * 缓存键是「会影响遍历结果的输入」的内容哈希:流程本身 + 变量初值 +
 * 实体字段(实体属性参与条件求值)+ 遍历上限。只要这些没变,报告
 * 一定相同(simulateFlow 是确定性的,这是 R7 就定下的性质)。
 *
 * 典型收益:dry-run 的「改动前」与「改动后」两次 audit,未被提案
 * 触及的流程直接命中缓存。
 */

/** FNV-1a 双 32 位,与 engine/package.ts 的 contentHash 同算法 */
function hash(value: unknown): string {
  const s = JSON.stringify(value);
  let h1 = 0x811c9dc5;
  let h2 = 0xcbf29ce4;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ ((c >> 8) | (c << 3)), 0x01000193) >>> 0;
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}

interface FlowLike { nodes: unknown[]; edges: unknown[]; id?: string }

/**
 * 只取 `buildEntityProps` 真正消费的实体信息 —— 这是缓存正确性的关键,
 * 少一项就可能错误命中:
 *   - id:entity 型字段按 id 解析被引用实体,解析结果进入属性值
 *   - technicalName:属性表的键,也是 entity 型字段解析后的值
 *   - 字段 label / value / type:type 决定该字段是否注入(entities 型不注入)
 * 刻意排除 name / summary / notes / color / avatar —— 它们不参与遍历,
 * 排除后「只改了简介」这类编辑不会让缓存失效(AI dry-run 前后对比因此受益)。
 */
function entityDigest(entities: Entity[]): unknown[] {
  return entities.map((e) => [
    e.id,
    e.technicalName ?? '',
    e.fields.map((f) => [f.label, f.value, f.type ?? 'text']),
  ]);
}

/** 只取参与遍历的变量信息 */
function variableDigest(variables: Variable[]): unknown[] {
  return variables.map((v) => [v.name, v.type, v.value]);
}

/** 缓存上限:体检一次最多涉及项目内全部流程,留出几次编辑的历史 */
const MAX_ENTRIES = 64;

const cache = new Map<string, SimReport>();
let hits = 0;
let misses = 0;

/**
 * 带缓存的 `simulateFlow`。语义与直接调用完全一致,只是相同输入不重算。
 * 返回的报告是共享引用 —— 调用方不得修改它(现有调用方都只读)。
 */
export function cachedSimulateFlow(
  flow: FlowLike,
  variables: Variable[],
  entities: Entity[],
  options: SimOptions = {},
): SimReport {
  const key = hash([flow, variableDigest(variables), entityDigest(entities), options.maxPaths, options.maxSteps]);
  const cached = cache.get(key);
  if (cached) {
    hits++;
    // LRU:命中后移到末尾
    cache.delete(key);
    cache.set(key, cached);
    return cached;
  }
  misses++;
  const report = simulateFlow(flow as Parameters<typeof simulateFlow>[0], variables, entities, options);
  cache.set(key, report);
  if (cache.size > MAX_ENTRIES) {
    // Map 迭代序即插入序,首个就是最久未用的
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  return report;
}

/** 供测试与「重新体检」按钮使用 */
export function clearPathCache(): void {
  cache.clear();
  hits = 0;
  misses = 0;
}

/** 供测试与诊断导出使用 */
export function pathCacheStats(): { size: number; hits: number; misses: number } {
  return { size: cache.size, hits, misses };
}
