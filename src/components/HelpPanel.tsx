import { useState } from 'react';
import Icon from './Icon';
import { useEscape } from '../hooks/useEscape';
import Q from './Q';

/**
 * 帮助面板 · 按模块列出用途、上手动作与常用快捷键。
 * 顶栏「?」按钮打开;新用户从这里能快速理解每个 tab 干什么、
 * 键盘怎么用、找不到功能时上哪找。
 */

type SectionKey = 'overview' | 'flow' | 'documents' | 'entities' | 'planning'
  | 'other' | 'sync' | 'safety' | 'shortcuts' | 'workflow';

interface Section { key: SectionKey; title: string; body: React.ReactNode }

const SECTIONS: Section[] = [
  {
    key: 'overview',
    title: '开始',
    body: (
      <>
        <p>TheLoom 是本地优先的叙事设计工具:小说、剧本、互动叙事都能装,数据默认存本机。</p>
        <ul>
          <li><b>网页版</b>:数据在浏览器里;换机器前先<Q>工具 → 存储管理 → 全部导出为 zip</Q>,或配好云同步</li>
          <li><b>桌面版</b>:项目槽位可绑定本地文件夹,正文就是 Markdown,Obsidian 能直接读写</li>
          <li><b>手机 / 平板</b>:网页版加到主屏即可离线使用,提供写作、快记、设定速查与大纲时间线查阅</li>
          <li><b>示例项目</b>:<Q>项目菜单 ▾</Q>→<Q>新建 · 载入示例</Q>载入<Q>老伦敦寻人记</Q>—— 覆盖全部模块的完整参考</li>
          <li><b>工作区预设</b>:小说 / 剧本 / 设定集 / 纪实 / TRPG 模组 / 互动叙事 / 通用七套,只改模块排序与命名,不锁功能</li>
          <li><b>写作阶段</b>(除通用外的全部预设):顶栏<Q>写 / 改 / 理 / 设</Q>四档。写 = 只留正文;改 = 查找替换、快照、版本差异与批注在手边;理 = 大纲 / 时间线 / 规划优先;设 = 设定集 / 地图 / 关系图 / 资料优先,查世界观不必离开当前作品。阶段是本机设置,不写入作品</li>
        </ul>
        <p className="hint">按 <kbd>F1</kbd> 随时打开本帮助。</p>
      </>
    ),
  },
  {
    key: 'flow',
    title: '流程',
    body: (
      <>
        <p>节点式分支叙事编辑器。工具栏点节点按钮 → 在画布中央添加;拖线连接;双击剧情片段进入子流程,可无限嵌套。</p>
        <ul>
          <li><b>叙事节点</b>:对白 / 剧情片段 / 汇聚点 / 条件分支 / 指令 / 检定 / 出口</li>
          <li><b>跨流程</b>:跳转(不返回)、调用(进目标流程,结束后回到调用点)、返回(可带返回值)</li>
          <li><b>外部事件</b>:声明式请求宿主引擎做事(播动画 / 切场景 / 启动谜题),可等待回值</li>
          <li><b>画布组织</b>:注释与分区框,不参与演出与导出</li>
          <li><b>选项</b>:汇聚点的每条出边就是一个玩家选项,标签即选项文字;可设出现条件、一次性、兜底</li>
          <li><b>条件 / 指令</b>:引用变量;<code>seen("节点技术名")</code> 判断走过没有,<code>实体.字段</code> 读写实体属性</li>
          <li><b>演出 / 路径测试 / 回归测试</b>:逐步播放 · 检查覆盖率与卡死死循环 · 把一次演出固化成可重跑的断言</li>
          <li><b>查看为剧本</b>:反向生成一份剧本文档,与流程共享叙事单元、双向同步</li>
        </ul>
      </>
    ),
  },
  {
    key: 'documents',
    title: '文档',
    body: (
      <>
        <p>写作工作台。左侧文件夹树(卷 / 章),中间是编辑器,右侧属性栏。</p>
        <ul>
          <li><b>三视图</b>:<Q>写作</Q>快速起草 · <Q>结构</Q>拖排块与流程角色 · <Q>连续稿</Q>通读全文</li>
          <li><b>专注模式</b>:工具栏<Q>专注</Q>进入纯文本沉浸写作,退出时按段落次序保留块身份</li>
          <li><b>斜杠菜单</b>:空段首输入 <code>/</code> 切换块类型(对白 / 选项 / 场景锚点等)</li>
          <li><b>生成流程</b>:一键把含对白 / 选项的文档转成流程节点图,双向同步</li>
          <li><b>场景元数据</b>:右栏可设状态 / 字数目标 / POV / 地点 / 故事时间 / 张力,喂给规划模块</li>
          <li><b>批注 / 快照 / 修订轮次</b>:右栏可折叠区,改稿留痕;场景可拆分与合并</li>
        </ul>
      </>
    ),
  },
  {
    key: 'entities',
    title: '设定集 / 资源 / 资料',
    body: (
      <>
        <p>素材库三件套 —— 角色 / 地点 / 物品 / 阵营 / 设定;图片音视频文件;考据与灵感卡片。
          (设定集在互动叙事与通用预设下叫<Q>实体</Q>。)</p>
        <ul>
          <li><b>设定集</b>:字段可用模板批量套用;角色可作为流程对白说话人</li>
          <li><b>技术名</b>:英文标识符,脚本里用 <code>技术名.字段名</code> 读写;改名时脚本自动跟随</li>
          <li><b>资源</b>:原文件按内容哈希存放,同一份文件只存一次;删除资源不会立刻删字节,由<Q>清理未引用原文件</Q>显式回收</li>
          <li><b>资料卡</b>:分类 / 标签 / 置顶 / 全文搜索,写世界观和考据用</li>
          <li><b>快记</b>:跨项目的灵感库,手机上随手记,回到桌面可转成场景或大纲行</li>
        </ul>
      </>
    ),
  },
  {
    key: 'planning',
    title: '规划',
    body: (
      <>
        <p>叙事宏观视图,子视图切换:</p>
        <ul>
          <li><b>关系图</b>:实体间拖线;节点位置会持久化</li>
          <li><b>角色弧线</b>:每个角色一条阶段轨迹,可关联具体场景文档</li>
          <li><b>伏笔台账</b>:埋设 / 回收位置,状态自动推导;<Q>缺埋设</Q>= 有回收却没埋过</li>
          <li><b>登场统计</b>:角色 × 章节的对白 / POV / 弧线聚合表</li>
          <li><b>场景卡片墙 / 节奏图</b>:章内拖排 · 字数 + 张力时间线</li>
          <li><b>写作进度 / 修订</b>:全书到场景四级目标与今日新增 · 快照差异逐项处理</li>
        </ul>
      </>
    ),
  },
  {
    key: 'other',
    title: '大纲 / 时间线 / 地图 / 风暴 / 变量',
    body: (
      <>
        <ul>
          <li><b>大纲</b>:罗琳式表格,行 = 章、列 = 剧情线;行可绑定到具体场景</li>
          <li><b>时间线</b>:轨道 × 时间点矩阵;事件可关联实体,与地图 / 演出时间过滤联动</li>
          <li><b>地图</b>:标记 + 区域 + 矢量形状 + 图层;<b>不需要底图也能用</b>,空白格纸上直接摆地点,美术以后再补</li>
          <li><b>风暴</b>:便签自由画布,双击空白新建,拖线关联;便签可转场景或大纲行</li>
          <li><b>变量</b>:布尔 / 数值 / 文本,流程条件与指令里可读写;另可声明外部事件</li>
        </ul>
      </>
    ),
  },
  {
    key: 'sync',
    title: '跨设备同步',
    body: (
      <>
        <p>两条路,可以同时用:</p>
        <ul>
          <li><b>文件夹模式(桌面)</b>:把项目绑定到 OneDrive / Dropbox 里的文件夹,正文是 Markdown,
            Obsidian 直接读写,云盘负责在电脑之间同步</li>
          <li><b>外链网盘(全平台)</b>:同步到你自己的 S3 兼容存储(R2 / B2 / MinIO / OSS)。
            这是手机与电脑之间唯一的通道 —— 手机上碰不到本地文件夹</li>
        </ul>
        <p>外链网盘的要点:</p>
        <ul>
          <li>远端按<b>作品名</b>分目录,多部作品互不覆盖;面板里<Q>查看远端作品</Q>可挑着拉</li>
          <li>还没起名的作品不能上传 —— 都叫<Q>未命名项目</Q>会在远端互相覆盖</li>
          <li>逐文件比对,改一个场景只传那一个;两边改了同一个文件才会拦下让你选</li>
          <li><b>只自动上传,不自动替换</b>:远端有更新只提示,拉取要你点头,因为那会整份替换当前作品</li>
          <li>顶栏的云图标:左键立即上传,右键打开完整面板</li>
          <li>网页版需在存储桶上配置 CORS;桌面版走本机转发,不需要配</li>
        </ul>
      </>
    ),
  },
  {
    key: 'safety',
    title: '检查与数据安全',
    body: (
      <>
        <ul>
          <li><b>体检</b>(工具菜单):孤儿节点、分支缺口、未定义变量、脚本类型错误、跨模块无效引用、
            路径不可达与死循环,点问题直达出错的地方</li>
          <li><b>组合查询</b>:按类型 / 文本 / 文件夹 / 字段 / 标签 / 引用状态筛选,条件可命名保存</li>
          <li><b>版本历史</b>:手动存快照并可回滚;回滚本身也能撤销</li>
          <li><b>恢复与备份</b>:每次保存留自动恢复点;项目损坏时隔离并给出诊断导出</li>
          <li><b>存储管理</b>:看占用、清理未引用的资源字节、全部导出为 zip</li>
          <li><b>撤销</b>:50 步,连续输入自动合并;所有改动都走同一条撤销栈</li>
        </ul>
        <p className="hint">删除带引用的对象前会列出会波及的地方 —— 那不是吓唬,是让你在删之前看清楚。</p>
      </>
    ),
  },
  {
    key: 'shortcuts',
    title: '快捷键',
    body: (
      <table className="var-table">
        <tbody>
          <tr><td><kbd>F1</kbd></td><td>打开本帮助</td></tr>
          <tr><td><kbd>Ctrl+K</kbd></td><td>全局搜索(找具体对象)</td></tr>
          <tr><td><kbd>Ctrl+Shift+K</kbd></td><td>项目总览(浏览项目结构)</td></tr>
          <tr><td><kbd>Ctrl+\</kbd></td><td>分屏(主副两模块并列)</td></tr>
          <tr><td><kbd>Ctrl+Z / Ctrl+Y</kbd></td><td>撤销 / 重做(50 步,连续输入自动合并)</td></tr>
          <tr><td><kbd>Alt+↑ / Alt+↓</kbd></td><td>文档编辑器里上下移动当前块</td></tr>
          <tr><td><kbd>/ 空段首</kbd></td><td>斜杠菜单切换块类型</td></tr>
          <tr><td><kbd>Enter / Shift+Enter</kbd></td><td>新段 / 换行</td></tr>
          <tr><td><kbd>Ctrl+Enter</kbd></td><td>批注 / 对话框:提交</td></tr>
          <tr><td><kbd>Ctrl+C / V / D</kbd></td><td>流程与风暴画布:复制 / 粘贴 / 原地复制选中</td></tr>
          <tr><td><kbd>Delete</kbd></td><td>删除选中节点(流程)/ 便签(风暴)</td></tr>
          <tr><td><kbd>Esc</kbd></td><td>关闭对话框 / 面板</td></tr>
        </tbody>
      </table>
    ),
  },
  {
    key: 'workflow',
    title: '典型工作流',
    body: (
      <>
        <p><b>写小说</b>:文档模块建卷章树 → 三视图切换起草 / 结构 / 连读 → 规划里用关系图 / 弧线 / 伏笔梳理 →
          成稿导出生成投稿稿 / 编辑审阅稿 DOCX,或编译 md / txt / fdx</p>
        <p><b>写互动剧本</b>:设定集建人物 → 文档写对白 + 选项 → 生成流程 → 加变量 / 条件 / 检定 →
          演出验证 → 路径测试查覆盖 → 引擎包 zip 交付 Godot / Unity</p>
        <p><b>从长稿导入</b>:工具菜单 →<Q>长稿导入</Q>支持 TXT / Markdown / EPUB / DOCX,预检后一次事务式写入卷章</p>
        <p><b>手机与电脑接力</b>:桌面绑定 OneDrive 文件夹(Obsidian 同一份) → 配好外链网盘并开自动同步 →
          手机网页版拉取同一份作品 → 随手写完再推回</p>
        <p><b>AI 辅助</b>:工具菜单 →<Q>AI 设置</Q>配 Key →<Q>AI 抽取</Q>把长文里的实体 / 场景 / 时间点抽出来,
          走预检通道确认后才写入;模型不会直接改项目</p>
      </>
    ),
  },
];

export default function HelpPanel({ onClose }: { onClose: () => void }) {
  useEscape(true, onClose);
  const [active, setActive] = useState<SectionKey>('overview');
  const sec = SECTIONS.find((s) => s.key === active)!;
  return (
    <div className="palette-backdrop" onClick={onClose}>
      <div className="palette help-panel" onClick={(e) => e.stopPropagation()}>
        <div className="sync-head">
          <Icon name="bulb" size={14} />
          <span>使用指南</span>
          <span className="spacer" />
          <span className="hint" style={{ fontSize: 11 }}>更详细的说明与设计准则见 README.md</span>
          <button className="ghost icon-btn" title="关闭 (Esc)" aria-label="关闭" onClick={onClose}>×</button>
        </div>
        <div className="help-body">
          <nav className="help-nav">
            {SECTIONS.map((s) => (
              <button
                key={s.key}
                className={`help-nav-item ${active === s.key ? 'active' : ''}`}
                onClick={() => setActive(s.key)}
              >{s.title}</button>
            ))}
          </nav>
          <div className="help-content">
            <h3>{sec.title}</h3>
            <div className="help-section">{sec.body}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
