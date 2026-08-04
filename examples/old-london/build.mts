/**
 * 《老伦敦寻人记》正式示例生成器(R22-1)
 *
 *   npx tsx examples/old-london/build.mts
 *
 * 从 source.md(原稿)按场景表切分正文,再叠加实体、伏笔、时间线、
 * 角色弧线与一条可游玩的解谜流程,产出**文件夹格式**的项目:
 *   examples/old-london/project/{project.json, entities/, documents/}
 *
 * 生成结果经 normalizeProject 规范化,可直接被应用打开、被 CLI 导出。
 * 内容结构是这份示例的重点 —— 正文一字不改,只做结构化。
 */
import { readFileSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  ArcStage, DocBlock, Document, Entity, Flow, FlowEdge, FlowNode, Folder,
  Foreshadow, Project, TimelineEvent, TimelinePoint, TimelineTrack, Variable,
} from '../../src/types';
import { normalizeProject } from '../../src/util';
import { entityToMd, documentToMd, projectToFolderJson } from '../../src/storage';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, 'project');

/* ---------- 正文:按行号切分场景 ---------- */

const lines = readFileSync(join(here, 'source.md'), 'utf8').split(/\r?\n/);

interface SceneSpec {
  chapter: string;
  title: string;
  from: number;   // 1 起,含
  to: number;     // 含
  /**
   * 从场景里排除的行段(闭区间)。
   * 作为公开示例略去的段落写在这里 —— 原稿 source.md 始终保持完整,
   * 不在源文件上做删改。
   */
  skip?: [number, number][];
  /** 场景元数据 */
  pov: string;
  location: string;
  time: string;
  tension: number;
}

/** 章 → 场景。行号对应 source.md,分章依据是原稿里的 --- 分隔符 */
const SCENES: SceneSpec[] = [
  { chapter: '第一章 · 雨季与一条短信', title: '白色地狱的走廊', from: 1, to: 45,
    pov: '塞梅尔维斯', location: '圣洛夫基金会总部', time: '雨季某日 下午', tension: 1 },
  { chapter: '第一章 · 雨季与一条短信', title: '遮阳篷下的第一条短信', from: 49, to: 113,
    pov: '塞梅尔维斯', location: '咖啡馆遮阳篷', time: '16:15', tension: 3 },
  { chapter: '第一章 · 雨季与一条短信', title: '五到六分钟的延迟', from: 117, to: 193,
    pov: '塞梅尔维斯', location: '咖啡馆遮阳篷', time: '16:32', tension: 3 },
  { chapter: '第一章 · 雨季与一条短信', title: '一张软盘的来历', from: 197, to: 320,
    pov: '塞梅尔维斯', location: '咖啡馆遮阳篷', time: '16:45', tension: 4 },

  { chapter: '第二章 · 白厅七号', title: '威斯敏斯特的雨', from: 325, to: 355,
    pov: '塞梅尔维斯', location: '威斯敏斯特站', time: '17:00 大本钟报时', tension: 3 },
  { chapter: '第二章 · 白厅七号', title: '红马甲接待员', from: 357, to: 437,
    pov: '塞梅尔维斯', location: '白厅七号 前厅', time: '17:10', tension: 2 },
  { chapter: '第二章 · 白厅七号', title: '范肖先生', from: 441, to: 568,
    pov: '塞梅尔维斯', location: '白厅七号 二楼休息室', time: '17:20', tension: 4 },

  { chapter: '第三章 · 编号 LSCC-TPT-LDN-ERR', title: '技术档案室', from: 573, to: 668,
    pov: '塞梅尔维斯', location: '白厅街道', time: '17:40', tension: 4 },

  { chapter: '第四章 · 第四下钟声', title: '游客止步', from: 673, to: 724,
    pov: '塞梅尔维斯', location: '堤岸夹层通道', time: '17:50', tension: 4 },
  { chapter: '第四章 · 第四下钟声', title: '血', from: 725, to: 786,
    pov: '塞梅尔维斯', location: '堤岸夹层通道', time: '17:55', tension: 5 },
  { chapter: '第四章 · 第四下钟声', title: '第四下钟声', from: 789, to: 820,
    pov: '塞梅尔维斯', location: '收容室墙缝', time: '18:00 整点报时', tension: 5 },
  // 885-906 是吸血段落,作为公开示例略去;原稿在 source.md 里完整保留
  { chapter: '第四章 · 第四下钟声', title: '感谢我的仁慈吧', from: 821, to: 953,
    skip: [[885, 906]],
    pov: '塞梅尔维斯', location: '收容室', time: '18:05', tension: 4 },
];

/** 说话人识别:引号段落里出现谁的特征就归给谁 */
function guessSpeaker(text: string): string | null {
  if (!/^[“"]/.test(text)) return null;
  if (/塞梅尔维斯说道|塞梅尔维斯[说问]/.test(text)) return '塞梅尔维斯';
  if (/接待员说|接待员/.test(text)) return '接待员';
  if (/范肖/.test(text)) return '范肖先生';
  return null;
}

/** 一段原文 → 文档块。对白进 dialogue,短信进 quote,其余 action */
function paragraphToBlock(raw: string, uid: () => string): DocBlock | null {
  const text = raw.trim();
  if (!text) return null;
  // Obsidian 导出的空行占位
  if (/^[\s　]*$/.test(text)) return null;
  // 场景分隔线
  if (/^-{3,}$/.test(text)) return null;

  // 短信:〔发件人:瓦伦缇娜〕 / *正文*
  if (/^〔(发件人|回复)[:：]/.test(text)) {
    return { id: uid(), type: 'subheading', level: 3, text: text.replace(/^〔|〕$/g, '') };
  }
  if (/^\*/.test(text)) {
    return { id: uid(), type: 'quote', text: text.replace(/^\*+|\*+$/g, '').trim() };
  }

  const speaker = guessSpeaker(text);
  if (speaker) return { id: uid(), type: 'dialogue', text, speakerId: speaker };
  return { id: uid(), type: 'action', text };
}

/* ---------- 实体 ---------- */

let seq = 0;
const uid = () => `ol${(++seq).toString(36).padStart(6, '0')}`;

interface EntitySpec {
  name: string;
  kind: Entity['kind'];
  tech?: string;
  summary: string;
  fields?: { label: string; value: string }[];
}

const ENTITIES: EntitySpec[] = [
  { name: '塞梅尔维斯', kind: 'character', tech: 'semmelweis',
    summary: '圣洛夫基金会高级调查员,血食怪。红色瞳孔,天鹅绒斗篷。本名贝拉。',
    fields: [
      { label: '所属', value: '圣洛夫基金会' }, { label: '职务', value: '高级调查员' },
      { label: '本名', value: '贝拉' }, { label: '效率', value: '3' }, { label: '克制', value: '2' },
    ] },
  { name: '瓦伦缇娜', kind: 'character', tech: 'valentina',
    summary: '老血食怪,神秘学家。基金会与重塑之手的老熟人。惯于用麻烦作为邀请。',
    fields: [
      { label: '阵营', value: '重塑之手' }, { label: '年岁', value: '很老' },
      { label: '香水', value: '酒红色的尾调' },
    ] },
  { name: '接待员', kind: 'character',
    summary: '白厅七号前厅的接待员。金属框眼镜、红色马甲,用两根食指敲键盘。名字普通到一眼记混。' },
  { name: '范肖先生', kind: 'character', tech: 'fanshaw',
    summary: '收藏家,秃头老绅士。姓氏拼作 Featherstonhaugh,读作范肖。软盘的经手人。',
    fields: [{ label: '配合度', value: '2' }] },
  { name: '技术档案室接线员', kind: 'character',
    summary: '基金会技术档案室值班员。负责查询软盘术式编号。' },

  { name: '圣洛夫基金会总部', kind: 'location', tech: 'foundation_hq',
    summary: '走廊长得像走不到尽头的白色地狱拼图。配给处发放通讯器。' },
  { name: '白厅七号', kind: 'location', tech: 'whitehall_7',
    summary: '威斯敏斯特区的维多利亚时期建筑,深褐色砖墙,没有门牌的木门。神秘学藏品交易所。' },
  { name: '查令十字站', kind: 'location', tech: 'charing_cross',
    summary: '区域线车站。站台最西端有一扇维修通道铁门,后面的螺旋台阶通到堤岸工程时期的原始夹层。' },
  { name: '堤岸夹层通道', kind: 'location', tech: 'embankment_layer',
    summary: '维多利亚堤岸填河造陆时,建在铁路隧道与下水道主管之间的夹层。墙体浇筑时混入了抑制神秘术的符文。' },
  { name: '收容室', kind: 'location', tech: 'containment_cell',
    summary: '十二到十六平米、高四米以上的密闭空间,隔绝一切神秘术。没有门窗。' },
  { name: '大本钟', kind: 'location', tech: 'big_ben',
    summary: '整点报时的低频钟声会沿地面向下传导,是定位夹层位置的关键参照。' },

  { name: '传送软盘 LSCC-TPT-LDN-ERR', kind: 'item', tech: 'floppy',
    summary: '五英寸黑色软盘,印着基金会与拉普拉斯的徽记。第六次暴雨前生产,指向伦敦地下,一次性使用。ERR 代表错误。' },
  { name: '德产直板手机', kind: 'item', tech: 'phone',
    summary: '瓦伦缇娜几个月前硬塞的手机,通讯录里预先录入的唯一联系人就是她。黑白屏幕。' },
  { name: '基金会通讯器', kind: 'item', tech: 'comm',
    summary: '配给处新领的升级款,抗摔长续航,可在危机时刻充当板砖。带定位发送功能。' },
  { name: '难吃的巧克力', kind: 'item', tech: 'chocolate',
    summary: '从茶水间顺来的新牌子,甜得发腻,像在糖浆和色拉油里埋了十几年。咬了一口就重新包好放回口袋。' },
];

/* ---------- 解谜流程 ---------- */

const VARIABLES: Variable[] = [
  // 初值 60 是刻意的:读短信 -5、每问一条线索 -15,于是
  //   问 0-1 条 → 电量够但线索不足,摸错墙
  //   问 2 条   → 25% 电量 + 2 条线索,恰好通往真结局
  //   问 3 条   → 线索满但电量只剩 10%,她在里面等成薛定谔的血食怪
  // 三个结局都可达,且构成真正的取舍 —— 路径测试会盯着这一点
  { id: uid(), name: 'battery', type: 'number', value: '60', description: '瓦伦缇娜手机剩余电量;每次通信都在消耗' },
  { id: uid(), name: 'clue_delay', type: 'boolean', value: 'false', description: '察觉到收发消息有五到六分钟延迟' },
  { id: uid(), name: 'clue_water', type: 'boolean', value: 'false', description: '问出了水流声 → 地下水道附近' },
  { id: uid(), name: 'clue_bell', type: 'boolean', value: 'false', description: '问出了整点五下响动 → 大本钟传导' },
  { id: uid(), name: 'clue_train', type: 'boolean', value: 'false', description: '问出了几分钟一次的振动 → 铁路夹层' },
  { id: uid(), name: 'has_floppy', type: 'boolean', value: 'false', description: '从范肖先生处取得传送软盘' },
  { id: uid(), name: 'got_intel', type: 'boolean', value: 'false', description: '技术档案室查到了收容室的历史与入口' },
  { id: uid(), name: 'position_sent', type: 'boolean', value: 'false', description: '已用通讯器发送定位,救援小队在路上' },
  { id: uid(), name: 'clues', type: 'number', value: '0', description: '已掌握的定位线索数;决定能否锁定裂缝' },
];

const node = (id: string, type: FlowNode['type'], data: Partial<FlowNode['data']>, x: number, y: number): FlowNode =>
  ({ id, type, position: { x, y }, data: { title: '', text: '', ...data } });
const edge = (source: string, target: string, extra: Partial<FlowEdge> = {}): FlowEdge =>
  ({ id: `e-${source}-${target}`, source, target, ...extra });

/**
 * 主线:短信问询(每次耗电,能换线索)→ 取软盘 → 查档案 → 下地 → 共振窗口。
 * 三个失败结局:电量耗尽、线索不足摸错墙、错过整点窗口。
 */
const flowNodes: FlowNode[] = [
  node('start', 'dialogue', { title: '遮阳篷下', text: '手心突然传来了毫无预兆的震动。', speakerId: '塞梅尔维斯', technicalName: 'opening' }, 0, 0),
  node('read_sms', 'instruction', { title: '读第一条短信', text: 'clue_delay = true; battery -= 5' }, 220, 0),
  node('ask_hub', 'hub', { title: '要问她什么?' }, 440, 0),

  node('ask_room', 'instruction', { title: '问房间大小与声音', text: 'clue_water = true; clues += 1; battery -= 15' }, 660, -160),
  node('ask_bell', 'instruction', { title: '问整点前后的响动', text: 'clue_bell = true; clues += 1; battery -= 15' }, 660, 0),
  node('ask_train', 'instruction', { title: '问振动的间隔', text: 'clue_train = true; clues += 1; battery -= 15' }, 660, 160),
  node('stop_asking', 'dialogue', { title: '省点电', text: '保留电量,等我消息。', speakerId: '塞梅尔维斯' }, 660, 320),

  node('battery_check', 'condition', { title: '还有电吗', text: 'battery > 20' }, 880, 0),
  node('end_battery', 'dialogue', { title: '结局 · 薛定谔的血食怪', text: '屏幕再没有亮起。她要靠救援队一间间扫描,至少一周。', technicalName: 'ending_battery' }, 1100, 200),

  node('to_whitehall', 'dialogue', { title: '白厅七号', text: '那扇没有门牌的木门虚掩着。', speakerId: '塞梅尔维斯' }, 1100, 0),
  node('persuade', 'check', { title: '说服范肖先生', checkExpr: '3', checkDc: 8, checkRed: false,
    text: '您提供的软盘存在严重缺陷……' }, 1320, 0),
  node('got_floppy', 'instruction', { title: '取得软盘', text: 'has_floppy = true' }, 1540, -100),
  node('no_floppy', 'dialogue', { title: '空手而归', text: '这行的要求不能透露供货商情报。', speakerId: '范肖先生' }, 1540, 120),

  node('archive', 'instruction', { title: '技术档案室', text: 'got_intel = true' }, 1760, 0),
  node('descend', 'dialogue', { title: '游客止步', text: '她掏出便携手电,钻进空气污浊的狭长通道。', speakerId: '塞梅尔维斯' }, 1980, 0),

  node('locate', 'condition', { title: '线索够不够锁定裂缝', text: 'clues >= 2' }, 2200, 0),
  node('end_lost', 'dialogue', { title: '结局 · 摸错了墙', text: '通道有几百米长,她在错误的一段来回摸索,直到整点过去。', technicalName: 'ending_lost' }, 2420, 220),

  node('smell_blood', 'dialogue', { title: '血', text: '血腥味从那道窄缝里涌进来,只有淡淡的一抹。', speakerId: '塞梅尔维斯', technicalName: 'found_crack' }, 2420, -60),
  node('send_position', 'instruction', { title: '发送定位', text: 'position_sent = true' }, 2640, -60),
  node('window_hub', 'hub', { title: '还有五分钟到整点' }, 2860, -60),

  node('wait_window', 'check', { title: '等第四下钟声与列车交会', checkExpr: 'clues', checkDc: 6, checkRed: true,
    text: '上下两条线的横向振动造成了墙体错位,钟声带来纵向震动。' }, 3080, -60),
  node('end_missed', 'dialogue', { title: '结局 · 错过的共振', text: '裂缝只张开一毫米就合上了。下一个整点还有五十九分钟。', technicalName: 'ending_missed' }, 3300, 160),

  node('mist', 'fragment', { title: '雾化穿越', text: '彻底失去重量的一瞬,世界在感知层面上变成另一种质地。',
    sub: {
      nodes: [
        node('mist_in', 'dialogue', { title: '第五下钟声', text: '她化成了黑雾。' }, 0, 0),
        node('mist_out', 'exit', { title: '墙的另一侧' }, 220, 0),
      ],
      edges: [edge('mist_in', 'mist_out')],
    } }, 3300, -60),

  node('reunion', 'dialogue', { title: '感谢我的仁慈吧', text: '一双手从身后伸过来环住了她的腰。', speakerId: '瓦伦缇娜', technicalName: 'reunion' }, 3520, -60),
  node('true_end', 'dialogue', { title: '结局 A · 晚饭:待定',
    text: '你来推荐——不许趁机灌酒,也不能是英国菜。', speakerId: '塞梅尔维斯', technicalName: 'ending_true' }, 3740, -60),
];

const flowEdges: FlowEdge[] = [
  edge('start', 'read_sms'),
  edge('read_sms', 'ask_hub'),
  edge('ask_hub', 'ask_room', { label: '问房间大小、听到什么', once: true }),
  edge('ask_hub', 'ask_bell', { label: '问整点前后有没有异响', once: true }),
  edge('ask_hub', 'ask_train', { label: '问振动的间隔', once: true }),
  edge('ask_hub', 'stop_asking', { label: '不再追问,替她省电' }),
  edge('ask_room', 'ask_hub'),
  edge('ask_bell', 'ask_hub'),
  edge('ask_train', 'ask_hub'),
  edge('stop_asking', 'battery_check'),
  edge('battery_check', 'to_whitehall', { sourceHandle: 'true' }),
  edge('battery_check', 'end_battery', { sourceHandle: 'false' }),
  edge('to_whitehall', 'persuade'),
  edge('persuade', 'got_floppy', { sourceHandle: 'success' }),
  edge('persuade', 'no_floppy', { sourceHandle: 'fail' }),
  edge('got_floppy', 'archive'),
  edge('no_floppy', 'archive'),
  edge('archive', 'descend'),
  edge('descend', 'locate'),
  edge('locate', 'smell_blood', { sourceHandle: 'true' }),
  edge('locate', 'end_lost', { sourceHandle: 'false' }),
  edge('smell_blood', 'send_position'),
  edge('send_position', 'window_hub'),
  edge('window_hub', 'wait_window', { label: '守住裂缝,等整点' }),
  edge('wait_window', 'mist', { sourceHandle: 'success' }),
  edge('wait_window', 'end_missed', { sourceHandle: 'fail' }),
  edge('mist', 'reunion'),
  edge('reunion', 'true_end'),
];

/* ---------- 组装项目 ---------- */

function build(): Project {
  const now = Date.UTC(2026, 4, 25, 12, 25, 25);

  const entities: Entity[] = ENTITIES.map((spec, i) => ({
    id: uid(),
    kind: spec.kind,
    name: spec.name,
    color: ['#3a3936', '#565550', '#72716b', '#8e8d86'][i % 4],
    emoji: '',
    summary: spec.summary,
    fields: (spec.fields ?? []).map((f) => ({ id: uid(), label: f.label, value: f.value })),
    notes: '',
    technicalName: spec.tech,
    createdAt: now,
  }));
  const entityByName = new Map(entities.map((e) => [e.name, e]));

  // 卷 → 章 文件夹
  const volume: Folder = { id: uid(), name: '老伦敦寻人记', module: 'document', documentRole: 'volume', order: 0 };
  const folders: Folder[] = [volume];
  const chapterByName = new Map<string, Folder>();
  let chapterOrder = 0;
  for (const scene of SCENES) {
    if (chapterByName.has(scene.chapter)) continue;
    const chapter: Folder = {
      id: uid(), name: scene.chapter, module: 'document',
      parentId: volume.id, documentRole: 'chapter', order: chapterOrder++,
    };
    chapterByName.set(scene.chapter, chapter);
    folders.push(chapter);
  }

  // 场景文档
  const documents: Document[] = [];
  const docByTitle = new Map<string, Document>();
  let sceneOrder = 0;
  for (const scene of SCENES) {
    const skipped = (line: number) => (scene.skip ?? []).some(([a, b]) => line >= a && line <= b);
    const raw = lines
      .slice(scene.from - 1, scene.to)
      .filter((_, i) => !skipped(scene.from + i))
      .join('\n');
    const blocks: DocBlock[] = [];
    for (const para of raw.split(/\n\s*\n/)) {
      const block = paragraphToBlock(para, uid);
      if (!block) continue;
      if (block.speakerId) {
        const speaker = entityByName.get(block.speakerId);
        block.speakerId = speaker ? speaker.id : undefined;
      }
      blocks.push(block);
    }
    const doc: Document = {
      id: uid(),
      folderId: chapterByName.get(scene.chapter)!.id,
      order: sceneOrder++,
      name: scene.title,
      category: '正文',
      blocks,
      notes: '',
      status: 'done',
      povId: entityByName.get(scene.pov)?.id,
      locationId: entityByName.get(scene.location)?.id,
      timeLabel: scene.time,
      tension: scene.tension,
      revision: 1,
      createdAt: now,
      updatedAt: now,
    };
    documents.push(doc);
    docByTitle.set(scene.title, doc);
  }

  const docId = (title: string) => docByTitle.get(title)!.id;
  const entityId = (name: string) => entityByName.get(name)!.id;

  // 流程:把节点里的说话人名字换成实体 id
  const resolveSpeakers = (nodes: FlowNode[]): FlowNode[] => nodes.map((n) => {
    const data = { ...n.data };
    if (typeof data.speakerId === 'string') {
      data.speakerId = entityByName.get(data.speakerId)?.id;
    }
    if (data.sub) data.sub = { nodes: resolveSpeakers(data.sub.nodes), edges: data.sub.edges };
    return { ...n, data };
  });

  const flow: Flow = {
    id: uid(), name: '寻人:从短信到第四下钟声', technicalName: 'old_london_case',
    documentId: docId('遮阳篷下的第一条短信'),
    nodes: resolveSpeakers(flowNodes),
    edges: flowEdges,
  };

  // 伏笔:首尾呼应的五条
  const foreshadow = (title: string, note: string, plants: string[], payoffs: string[]): Foreshadow => ({
    id: uid(), title, note,
    plants: plants.map((t) => ({ id: uid(), docId: docId(t) })),
    payoffs: payoffs.map((t) => ({ id: uid(), docId: docId(t) })),
    createdAt: now,
  });
  const foreshadows: Foreshadow[] = [
    foreshadow('难吃的巧克力', '开头咬一口就包回口袋,结尾换成"晚饭:待定"的邀约。',
      ['白色地狱的走廊'], ['感谢我的仁慈吧']),
    foreshadow('通讯录里唯一的联系人', '她从没用它联系过谁,而第一条消息正是求救。',
      ['白色地狱的走廊'], ['遮阳篷下的第一条短信']),
    foreshadow('宴会上被灌酒', '上次行动的检讨书,兑现在结尾"不许趁机灌酒"。',
      ['遮阳篷下的第一条短信'], ['感谢我的仁慈吧']),
    foreshadow('瓦伦缇娜教过的雾化', '不经意的指点,成了穿墙的唯一手段。',
      ['一张软盘的来历'], ['第四下钟声']),
    foreshadow('装死骗过她一次', '最初就被这个人装死骗过 —— 这次"受困"同样是半个谎。',
      ['一张软盘的来历'], ['感谢我的仁慈吧']),
  ];

  // 角色弧线:塞梅尔维斯的情绪线
  const arcs: ArcStage[] = [
    { id: uid(), entityId: entityId('塞梅尔维斯'), title: '拒绝承认在等消息', note: '每天带着那台手机,理由全是借口。', docId: docId('白色地狱的走廊'), order: 0 },
    { id: uid(), entityId: entityId('塞梅尔维斯'), title: '调查员本能接管情绪', note: '假设她真的遇到麻烦,开始推理延迟。', docId: docId('五到六分钟的延迟'), order: 1 },
    { id: uid(), entityId: entityId('塞梅尔维斯'), title: '为她走进雨里', note: '不走官方流程,不等一周。', docId: docId('技术档案室'), order: 2 },
    { id: uid(), entityId: entityId('塞梅尔维斯'), title: '闻到血的那一刻', note: '本能先于意识接管了呼吸。', docId: docId('血'), order: 3 },
    { id: uid(), entityId: entityId('塞梅尔维斯'), title: '松开攥着的手指', note: '发现被骗,却先确认了脉搏是真的。', docId: docId('感谢我的仁慈吧'), order: 4 },
  ];

  // 时间线:一个下午
  const track: TimelineTrack = { id: uid(), name: '寻人当日', color: '#565550' };
  const points: TimelinePoint[] = [
    '16:09 发信', '16:15 收到', '16:27 第二封', '16:32 收到',
    '17:00 大本钟报时', '17:02 五下响动', '17:40 技术档案室', '18:00 整点共振',
  ].map((label) => ({ id: uid(), label }));
  const timelineEvents: TimelineEvent[] = [
    { id: uid(), trackId: track.id, pointId: points[0].id, title: '瓦伦缇娜发出求救', text: '我需要你的帮助,亲爱的塞梅尔维斯', entityIds: [entityId('瓦伦缇娜')], documentIds: [docId('遮阳篷下的第一条短信')] },
    { id: uid(), trackId: track.id, pointId: points[1].id, title: '塞梅尔维斯收到', text: '延迟六分钟 —— 第一个线索', entityIds: [entityId('塞梅尔维斯')], documentIds: [docId('遮阳篷下的第一条短信')] },
    { id: uid(), trackId: track.id, pointId: points[3].id, title: '确认信号屏蔽', text: '五到六分钟的延迟在市中心不正常', entityIds: [entityId('塞梅尔维斯')], documentIds: [docId('五到六分钟的延迟')] },
    { id: uid(), trackId: track.id, pointId: points[4].id, title: '大本钟五点报时', text: '距离求救已近一小时', entityIds: [], documentIds: [docId('威斯敏斯特的雨')] },
    { id: uid(), trackId: track.id, pointId: points[5].id, title: '墙壁五下响动', text: '整点钟声传导 —— 她离市政区不远', entityIds: [entityId('瓦伦缇娜')], documentIds: [docId('范肖先生')] },
    { id: uid(), trackId: track.id, pointId: points[6].id, title: '查到软盘编号', text: '堤岸工程时期的夹层收容室', entityIds: [entityId('技术档案室接线员')], documentIds: [docId('技术档案室')] },
    { id: uid(), trackId: track.id, pointId: points[7].id, title: '第四下钟声', text: '钟声与列车交会形成共振高峰', entityIds: [entityId('塞梅尔维斯'), entityId('瓦伦缇娜')], documentIds: [docId('第四下钟声')] },
  ];

  const project: Project = {
    version: 1,
    name: '老伦敦寻人记',
    workspacePreset: 'novel',
    flows: [flow],
    entities,
    brainstormNotes: [], brainstormEdges: [],
    outlineColumns: [], outlineRows: [],
    timelineTracks: [track], timelinePoints: points, timelineEvents,
    maps: [],
    researchCards: [], researchCategories: [],
    variables: VARIABLES,
    assets: [], documents, documentCategories: ['正文'],
    attachments: {},
    folders,
    foreshadows,
    arcs,
    engineExportConfigs: [{
      id: uid(), name: 'Godot 自包含包',
      entities: 'referenced', assets: 'referenced',
      bundle: { assetFiles: true, runtime: true, checksums: true },
      gate: { script: true, audit: true, paths: true, tests: true, blockOnWarnings: false },
      createdAt: now, updatedAt: now,
    }],
    // 选择序列照着 trace.mts 的实际走向写,不是猜的
    flowTests: [
      // 注意:hub 的选项随 once 消耗会重新编号,第 4 步的「省电」下标是 1 不是 3
      { id: uid(), name: '真结局 · 问两条线索后穿墙', flowRef: 'old_london_case', seed: 7,
        choices: [0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0],
        assertions: [
          { kind: 'nodeVisited', node: 'ending_true', expect: true },
          { kind: 'nodeVisited', node: 'found_crack', expect: true },
          { kind: 'variable', name: 'position_sent', op: '==', value: 'true' },
          { kind: 'variable', name: 'clues', op: '==', value: '2' },
        ], updatedAt: now },
      { id: uid(), name: '失败 · 一条线索都不问就下地', flowRef: 'old_london_case', seed: 7,
        choices: [0, 3, 0, 0, 0, 0],
        assertions: [
          { kind: 'nodeVisited', node: 'ending_lost', expect: true },
          { kind: 'nodeVisited', node: 'ending_true', expect: false },
          { kind: 'variable', name: 'clues', op: '==', value: '0' },
        ], updatedAt: now },
      { id: uid(), name: '失败 · 追问到电量耗尽', flowRef: 'old_london_case', seed: 7,
        choices: [0, 0, 0, 0, 0, 0, 0, 0],
        assertions: [
          { kind: 'nodeVisited', node: 'ending_battery', expect: true },
          { kind: 'nodeVisited', node: 'ending_true', expect: false },
          { kind: 'variable', name: 'clues', op: '==', value: '3' },
        ], updatedAt: now },
    ],
    updatedAt: now,
  };

  return normalizeProject(project);
}

/* ---------- 写出文件夹项目 ---------- */

function sanitize(name: string): string {
  return name.replace(/[\\/:*?"<>|#^[\]]/g, ' ').replace(/\s+/g, ' ').trim();
}

const project = build();
rmSync(outDir, { recursive: true, force: true });
mkdirSync(join(outDir, 'entities'), { recursive: true });
mkdirSync(join(outDir, 'documents'), { recursive: true });

writeFileSync(join(outDir, 'project.json'), projectToFolderJson(project));

const idToName = new Map(project.entities.map((e) => [e.id, e.name]));
for (const entity of project.entities) {
  writeFileSync(join(outDir, 'entities', `${sanitize(entity.name)}.md`), entityToMd(entity, undefined, idToName));
}

// 文档按 卷/章 目录铺开,与应用的文件夹模式一致
const folderPath = (folderId: string | undefined): string => {
  const parts: string[] = [];
  let current = project.folders.find((f) => f.id === folderId);
  while (current) {
    parts.unshift(sanitize(current.name));
    current = current.parentId ? project.folders.find((f) => f.id === current!.parentId) : undefined;
  }
  return parts.join('/');
};
for (const doc of project.documents) {
  const dir = join(outDir, 'documents', ...folderPath(doc.folderId).split('/'));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${sanitize(doc.name)}.md`), documentToMd(doc, project.entities));
}

const words = project.documents.reduce((sum, d) =>
  sum + d.blocks.reduce((n, b) => n + (b.text?.length ?? 0), 0), 0);
console.log(`✓ 生成 ${outDir}`);
console.log(`  ${project.documents.length} 场景 / ${project.folders.length} 卷章 / 约 ${words} 字`);
console.log(`  ${project.entities.length} 实体 · ${project.foreshadows?.length ?? 0} 伏笔 · ${project.arcs?.length ?? 0} 弧线阶段 · ${project.timelineEvents.length} 时间线事件`);
console.log(`  流程 ${project.flows[0].nodes.length} 节点 / ${project.flows[0].edges.length} 连线 · ${project.variables.length} 变量 · ${project.flowTests?.length ?? 0} 回归测试`);
