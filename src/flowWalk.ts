/**
 * 出边选择规则 —— 演出(Player)、路径遍历(simulate)、独立运行库(runtime)三处共用。
 *
 * 这段规则此前在三个文件里各写了一份,靠人记得同步。三份一旦漂开,症状是
 * 「演出里走得通的分支,路径测试报不可达」或者「导出到引擎后走向和编辑器里不一样」,
 * 而且不会有任何报错。收成一份之后,改规则只有一个地方可改。
 *
 * 三处仍各自持有状态(已走过的边、变量、检定结果),所以状态查询以回调传入。
 */

export interface WalkEdge {
  id: string;
  sourceHandle?: string | null;
  once?: boolean;
  fallback?: boolean;
  condition?: string;
}

export interface WalkGate {
  /** 从命名出口回到父层时,该出口节点的 id;非出口回溯传 null */
  exitId?: string | null;
  /** 当前所在节点的类型 */
  nodeType?: string;
  /** condition 节点的求值结果;null = 求不出来,保留全部引脚交由人工选择 */
  condResult?: boolean | null;
  /** check 节点是否通过 */
  checkPassed?: boolean;
  /** 该边是否已被走过(一次性选项用) */
  isTaken: (edgeId: string) => boolean;
  /** 边上的出现条件是否放行;求不出来算放行 */
  edgeAllowed: (condition: string) => boolean;
}

/**
 * @returns usable 此刻可走的边;rawCount 引脚过滤之后、选项级过滤之前的条数 ——
 * simulate 用它区分「本来就没有出边」和「有出边但全被过滤掉了」(卡死)。
 */
export function selectOutgoing<E extends WalkEdge>(
  all: E[], g: WalkGate,
): { usable: E[]; rawCount: number } {
  let edges = all;

  if (g.exitId) {
    // 命名出口:优先接到父层片段上同名引脚,没有再落到默认引脚
    const named = edges.filter((e) => e.sourceHandle === `exit:${g.exitId}`);
    edges = named.length > 0 ? named : edges.filter((e) => !e.sourceHandle);
  } else if (g.nodeType === 'fragment') {
    // 子路径自然结束(未经出口)→ 只走默认引脚
    edges = edges.filter((e) => !e.sourceHandle);
  }

  if (g.nodeType === 'condition' && g.condResult != null) {
    const want = g.condResult ? 'true' : 'false';
    const picked = edges.filter((e) => e.sourceHandle === want);
    edges = picked.length > 0 ? picked : [];
  }

  if (g.nodeType === 'check') {
    const want = g.checkPassed ? 'success' : 'fail';
    const picked = edges.filter((e) => e.sourceHandle === want);
    edges = picked.length > 0 ? picked : [];
  }

  const rawCount = edges.length;
  const usable = edges.filter((e) =>
    !(e.once && g.isTaken(e.id)) &&
    (!e.condition || g.edgeAllowed(e.condition)),
  );
  // 兜底分支:还有别的可走时遮蔽 fallback 边
  const nonFallback = usable.filter((e) => !e.fallback);
  return { usable: nonFallback.length > 0 ? nonFallback : usable, rawCount };
}
