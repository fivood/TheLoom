import { useState } from 'react';
import Icon from './Icon';

/**
 * 帮助面板 · 按模块列出用途、上手动作与常用快捷键。
 * 顶栏「?」按钮打开;新用户从这里能快速理解每个 tab 干什么、
 * 键盘怎么用、找不到功能时上哪找。
 */

type SectionKey = 'overview' | 'flow' | 'documents' | 'entities' | 'planning'
  | 'other' | 'shortcuts' | 'workflow';

interface Section { key: SectionKey; title: string; body: React.ReactNode }

const SECTIONS: Section[] = [
  {
    key: 'overview',
    title: '开始',
    body: (
      <>
        <p>TheLoom 是本地优先的叙事设计工具:小说、剧本、互动叙事都能装,数据默认存本机。</p>
        <ul>
          <li><b>网页版</b>:数据在浏览器 localStorage;换机器前先「工具 → 存储管理 → 全部导出为 zip」</li>
          <li><b>桌面版</b>:项目槽位可绑定本地文件夹,和 Obsidian 兼容;绑定后可清浏览器镜像</li>
          <li><b>示例项目</b>:「项目菜单 ▾」→「新建 · 载入示例」载入「老伦敦寻人记」—— 覆盖全部模块的完整参考</li>
        </ul>
      </>
    ),
  },
  {
    key: 'flow',
    title: '流程',
    body: (
      <>
        <p>节点式分支叙事编辑器。工具栏点节点按钮 → 在画布中央添加;拖线连接;双击剧情片段进入子流程。</p>
        <ul>
          <li><b>对白 / 剧情片段 / 汇聚点 / 条件 / 指令 / 检定 / 跳转 / 出口</b>:8 类节点覆盖大多数场景</li>
          <li><b>选项</b>:汇聚点的每条出边就是一个玩家选项,标签即选项文字</li>
          <li><b>条件 / 指令</b>:引用变量;<code>seen("节点技术名")</code> / <code>实体.字段</code> 高级用法见资料卡</li>
          <li><b>演出 / 路径测试</b>:工具栏「演出」逐步播放;「路径测试」检查覆盖率与卡死死循环</li>
          <li><b>查看为剧本</b>:反向生成一份剧本文档,可与流程共享叙事单元</li>
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
          <li><b>三视图</b>:「写作」快速起草 · 「结构」拖排块与流程角色 · 「连续稿」通读全文</li>
          <li><b>斜杠菜单</b>:空段首输入 <code>/</code> 切换块类型(对白 / 选项 / 场景锚点等)</li>
          <li><b>生成流程</b>:一键把含对白 / 选项的文档转成流程节点图,双向同步</li>
          <li><b>场景元数据</b>:右栏可设状态 / 字数目标 / POV / 张力,喂给规划模块</li>
          <li><b>批注 / 快照 / 修订轮次</b>:右栏可折叠区,改稿留痕</li>
        </ul>
      </>
    ),
  },
  {
    key: 'entities',
    title: '实体 / 资源 / 资料',
    body: (
      <>
        <p>素材库三件套 —— 角色 / 地点 / 物品 / 阵营 / 设定;图片音视频文件;考据与灵感卡片。</p>
        <ul>
          <li><b>实体</b>:字段可用模板批量套用;角色可作为流程对白说话人</li>
          <li><b>技术名</b>:英文标识符,脚本里用 <code>技术名.字段名</code> 读值</li>
          <li><b>资源</b>:哈希去重、视频缩略图、原文件按需落盘</li>
          <li><b>资料卡</b>:分类 / 标签 / 置顶 / 全文搜索,写世界观和考据用</li>
        </ul>
      </>
    ),
  },
  {
    key: 'planning',
    title: '规划',
    body: (
      <>
        <p>叙事宏观视图,五个子视图切换:</p>
        <ul>
          <li><b>关系图</b>:实体间拖线;节点位置会持久化</li>
          <li><b>角色弧线</b>:每个角色一条阶段轨迹,可关联具体场景文档</li>
          <li><b>伏笔台账</b>:埋设 / 回收位置,自动状态推导</li>
          <li><b>登场统计</b>:角色 × 章节的对白 / POV / 弧线聚合表</li>
          <li><b>场景卡片墙 / 节奏图</b>:章内拖排 · 字数 + 张力时间线</li>
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
          <li><b>大纲</b>:罗琳式表格,行 = 章、列 = 剧情线</li>
          <li><b>时间线</b>:轨道 × 时间点矩阵;事件可关联实体,与地图 / 演出时间过滤联动</li>
          <li><b>地图</b>:底图 + 标记 + 区域 + 矢量形状(路径 / 矩形 / 椭圆 / 文字);图层显隐锁定</li>
          <li><b>风暴</b>:便签自由画布,双击空白新建,拖线关联</li>
          <li><b>变量</b>:布尔 / 数值 / 文本,流程 condition 和 instruction 里可读写</li>
        </ul>
      </>
    ),
  },
  {
    key: 'shortcuts',
    title: '快捷键',
    body: (
      <table className="var-table">
        <tbody>
          <tr><td><kbd>Ctrl+K</kbd></td><td>全局搜索(找具体对象)</td></tr>
          <tr><td><kbd>Ctrl+Shift+K</kbd></td><td>项目总览(浏览项目结构)</td></tr>
          <tr><td><kbd>Ctrl+\</kbd></td><td>分屏(主副两模块并列)</td></tr>
          <tr><td><kbd>Ctrl+Z / Ctrl+Y</kbd></td><td>撤销 / 重做(50 步,连续输入自动合并)</td></tr>
          <tr><td><kbd>Alt+↑ / Alt+↓</kbd></td><td>文档里移动场景(卷章树内)</td></tr>
          <tr><td><kbd>/ 空段首</kbd></td><td>斜杠菜单切换块类型</td></tr>
          <tr><td><kbd>Enter / Shift+Enter</kbd></td><td>新段 / 换行</td></tr>
          <tr><td><kbd>Ctrl+Enter</kbd></td><td>批注 / 对话框:提交</td></tr>
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
        <p><b>写小说</b>:文档模块建卷章树 → 三视图切换起草 / 结构 / 连读 → 规划里用关系图 / 弧线 / 伏笔梳理 → 章节编译导出 md / txt / fdx</p>
        <p><b>写互动剧本</b>:实体建人物 → 文档写对白 + 选项 → 生成流程 → 加变量 / 条件 / 检定 → 演出验证 → 路径测试查覆盖 → 引擎包 zip 交付 Godot / Unity</p>
        <p><b>从长稿导入</b>:工具菜单 →「TXT / Markdown / EPUB / DOCX / MOBI 稿件」预检后一次事务式写入卷章</p>
        <p><b>从材料 AI 生成</b>:工具菜单 →「AI 设置」配 Key →「完整项目导入」输入多份材料 → 计划审阅 → 生成 → 预检导入(小说 / 互动剧本两种)</p>
      </>
    ),
  },
];

export default function HelpPanel({ onClose }: { onClose: () => void }) {
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
          <button className="ghost icon-btn" onClick={onClose}>×</button>
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
