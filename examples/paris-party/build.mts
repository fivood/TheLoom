/**
 * 巴黎宴会篇项目生成器
 *
 *   npx tsx examples/paris-party/build.mts
 *
 * 读取 Obsidian 原稿(名单之外 / 宴会风波一则 / 老伦敦寻人记)和马塞尔设定,
 * 产出文件夹格式的 TheLoom 项目:
 *   examples/paris-party/project/{project.json, entities/, documents/}
 *
 * 三篇故事按时间线排列,共享实体、伏笔、弧线与关系网。
 * 用户可在 TheLoom 里对照线索和设定继续写《名单之外》。
 */
import { readFileSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  ArcStage, DocBlock, Document, Entity, EntityRelation, Folder,
  Foreshadow, Project, ResearchCard, TimelineEvent, TimelinePoint,
  TimelineTrack,
} from '../../src/types';
import { normalizeProject } from '../../src/util';
import { entityToMd, documentToMd, projectToFolderJson } from '../../src/storage';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, 'project');

const OBSIDIAN = 'C:\\Users\\fukki\\OneDrive\\Documents\\Obsidian Vault\\1999\\if';

const readSource = (filename: string) =>
  readFileSync(join(OBSIDIAN, filename), 'utf8').split(/\r?\n/);

/* ---------- ID 生成 ---------- */

let seq = 0;
const uid = () => `pp${(++seq).toString(36).padStart(6, '0')}`;

/* ---------- 段落 → 文档块 ---------- */

function guessSpeaker(text: string): string | null {
  if (!/^[""\u{300c}]/.test(text)) return null;
  if (/瓦伦缇娜[说道问]|^"(感谢|本想|来不及|看着|你真以为|保管好)/.test(text)) return '瓦伦缇娜';
  if (/塞梅尔维斯[说问道]|^"(站住|那个侍者|离……|我还可以|有时候|送出去|你都没有|随便吧|我的额外|你来推荐|现在说的|松手)/.test(text)) return '塞梅尔维斯';
  if (/侍者[说回答一边]/.test(text)) return '侍者';
  if (/接待员[说回]/.test(text)) return '接待员';
  if (/范肖/.test(text)) return '范肖先生';
  if (/^"(晚上好|好的，之后)/.test(text)) return '侍者';
  if (/^"(先不必了|嗯。)/.test(text)) return '塞梅尔维斯';
  return null;
}

function paragraphToBlock(raw: string): DocBlock | null {
  const text = raw.trim().replace(/^[\s　]+/, '');
  if (!text) return null;
  if (/^[\s　]*$/.test(text)) return null;
  if (/^-{3,}$/.test(text)) return null;
  if (/^END$/i.test(text)) return null;

  // 短信标记
  if (/^〔(发件人|回复)[:：]/.test(text)) {
    return { id: uid(), type: 'subheading', level: 3, text: text.replace(/^〔|〕$/g, '') };
  }
  // 短信正文(星号包围)
  if (/^\*[^*]/.test(text) && !/^\*\*/.test(text)) {
    return { id: uid(), type: 'quote', text: text.replace(/^\*+|\*+$/g, '').trim() };
  }

  // 星座专栏引用
  if (/^>\s*\*/.test(text)) {
    const clean = text.replace(/^>\s*\*?\s*/gm, '').replace(/\*$/gm, '').trim();
    return { id: uid(), type: 'quote', text: clean };
  }
  // 信件内容(引用块)
  if (/^>\s/.test(text)) {
    const clean = text.replace(/^>\s*/gm, '').replace(/^\*|\*$/gm, '').trim();
    return { id: uid(), type: 'quote', text: clean };
  }

  const speaker = guessSpeaker(text);
  if (speaker) return { id: uid(), type: 'dialogue', text, speakerId: speaker };
  return { id: uid(), type: 'action', text };
}

/* ---------- 源文件切分 ---------- */

interface SceneSpec {
  story: string;
  chapter: string;
  title: string;
  from: number;
  to: number;
  pov: string;
  location: string;
  time: string;
  tension: number;
  status: 'outline' | 'draft' | 'revising' | 'done';
}

// ---- 名单之外(瓦伦缇娜视角,WIP)
const SRC_MINGDAN = readSource('名单之外.md');

const SCENES_MINGDAN: SceneSpec[] = [
  { story: '名单之外', chapter: '瓦伦缇娜视角',
    title: '邀请函与社交经济学', from: 1, to: 21,
    pov: '瓦伦缇娜', location: '瓦伦缇娜的住所', time: '入秋·宴会前数日',
    tension: 1, status: 'draft' },
  { story: '名单之外', chapter: '瓦伦缇娜视角',
    title: '塞梅尔维斯应该做她的秘书', from: 23, to: 28,
    pov: '瓦伦缇娜', location: '瓦伦缇娜的住所', time: '入秋·宴会前数日',
    tension: 2, status: 'draft' },
  { story: '名单之外', chapter: '瓦伦缇娜视角',
    title: '骑士俱乐部与一个讨厌的名字', from: 29, to: 53,
    pov: '瓦伦缇娜', location: '瓦伦缇娜的住所', time: '宴会前·收到名单',
    tension: 3, status: 'draft' },
];

// ---- 宴会风波一则(塞梅尔维斯视角,完成)
const SRC_YANHUI = readSource('宴会风波一则.md');

const SCENES_YANHUI: SceneSpec[] = [
  { story: '宴会风波一则', chapter: '塞梅尔维斯视角',
    title: '入场', from: 1, to: 28,
    pov: '塞梅尔维斯', location: '巴黎骑士俱乐部·走廊', time: '宴会当晚',
    tension: 2, status: 'done' },
  { story: '宴会风波一则', chapter: '塞梅尔维斯视角',
    title: '甜点桌旁的观察', from: 29, to: 88,
    pov: '塞梅尔维斯', location: '巴黎骑士俱乐部·宴会厅', time: '宴会当晚',
    tension: 2, status: 'done' },
  { story: '宴会风波一则', chapter: '塞梅尔维斯视角',
    title: '贵宾入场', from: 89, to: 147,
    pov: '塞梅尔维斯', location: '巴黎骑士俱乐部·宴会厅', time: '宴会当晚·二十分钟后',
    tension: 3, status: 'done' },
  { story: '宴会风波一则', chapter: '塞梅尔维斯视角',
    title: '一杯被截走的红酒', from: 148, to: 208,
    pov: '塞梅尔维斯', location: '巴黎骑士俱乐部·宴会厅', time: '宴会当晚',
    tension: 4, status: 'done' },
  { story: '宴会风波一则', chapter: '塞梅尔维斯视角',
    title: '失控', from: 209, to: 277,
    pov: '塞梅尔维斯', location: '巴黎骑士俱乐部·宴会厅', time: '宴会当晚',
    tension: 5, status: 'done' },
  { story: '宴会风波一则', chapter: '塞梅尔维斯视角',
    title: '醒来', from: 278, to: 344,
    pov: '塞梅尔维斯', location: '巴黎骑士俱乐部·梳妆室', time: '宴会当晚·两小时后',
    tension: 3, status: 'done' },
];

// ---- 老伦敦寻人记(塞梅尔维斯视角,完成)—— 分段用原文 --- 分隔线
const SRC_LONDON = readSource('老伦敦寻人记.md');

const SCENES_LONDON: SceneSpec[] = [
  { story: '老伦敦寻人记', chapter: '第一章 · 雨季与一条短信',
    title: '白色地狱的走廊', from: 1, to: 45,
    pov: '塞梅尔维斯', location: '圣洛夫基金会总部', time: '雨季某日·下午',
    tension: 1, status: 'done' },
  { story: '老伦敦寻人记', chapter: '第一章 · 雨季与一条短信',
    title: '遮阳篷下的第一条短信', from: 49, to: 113,
    pov: '塞梅尔维斯', location: '咖啡馆遮阳篷', time: '16:15',
    tension: 3, status: 'done' },
  { story: '老伦敦寻人记', chapter: '第一章 · 雨季与一条短信',
    title: '五到六分钟的延迟', from: 117, to: 193,
    pov: '塞梅尔维斯', location: '咖啡馆遮阳篷', time: '16:32',
    tension: 3, status: 'done' },
  { story: '老伦敦寻人记', chapter: '第一章 · 雨季与一条短信',
    title: '一张软盘的来历', from: 197, to: 320,
    pov: '塞梅尔维斯', location: '咖啡馆遮阳篷 → 地铁', time: '16:45',
    tension: 4, status: 'done' },
  { story: '老伦敦寻人记', chapter: '第二章 · 白厅七号',
    title: '威斯敏斯特的雨', from: 325, to: 355,
    pov: '塞梅尔维斯', location: '威斯敏斯特站', time: '17:00',
    tension: 3, status: 'done' },
  { story: '老伦敦寻人记', chapter: '第二章 · 白厅七号',
    title: '红马甲接待员', from: 357, to: 437,
    pov: '塞梅尔维斯', location: '白厅七号·前厅', time: '17:10',
    tension: 2, status: 'done' },
  { story: '老伦敦寻人记', chapter: '第二章 · 白厅七号',
    title: '范肖先生', from: 441, to: 568,
    pov: '塞梅尔维斯', location: '白厅七号·二楼休息室', time: '17:20',
    tension: 4, status: 'done' },
  { story: '老伦敦寻人记', chapter: '第三章 · 编号 LSCC-TPT-LDN-ERR',
    title: '技术档案室', from: 573, to: 668,
    pov: '塞梅尔维斯', location: '白厅街道', time: '17:40',
    tension: 4, status: 'done' },
  { story: '老伦敦寻人记', chapter: '第四章 · 第四下钟声',
    title: '游客止步', from: 673, to: 724,
    pov: '塞梅尔维斯', location: '堤岸夹层通道', time: '17:50',
    tension: 4, status: 'done' },
  { story: '老伦敦寻人记', chapter: '第四章 · 第四下钟声',
    title: '血', from: 725, to: 786,
    pov: '塞梅尔维斯', location: '堤岸夹层通道', time: '17:55',
    tension: 5, status: 'done' },
  { story: '老伦敦寻人记', chapter: '第四章 · 第四下钟声',
    title: '第四下钟声', from: 789, to: 820,
    pov: '塞梅尔维斯', location: '收容室墙缝', time: '18:00',
    tension: 5, status: 'done' },
  { story: '老伦敦寻人记', chapter: '第四章 · 第四下钟声',
    title: '感谢我的仁慈吧', from: 821, to: 953,
    pov: '塞梅尔维斯', location: '收容室', time: '18:05',
    tension: 4, status: 'done' },
];

/* ---------- 实体定义 ---------- */

interface EntitySpec {
  name: string;
  kind: Entity['kind'];
  tech?: string;
  summary: string;
  fields?: { label: string; value: string }[];
}

const ENTITIES: EntitySpec[] = [
  // ---- 角色
  { name: '瓦伦缇娜', kind: 'character', tech: 'valentina',
    summary: '纯血血食怪,活了几个世纪的神秘学家。经营酒馆和画廊,在巴黎骑士俱乐部有比共和国还长的会籍。玩世不恭,对塞梅尔维斯怀有不明说的执念。',
    fields: [
      { label: '种族', value: '纯血血食怪' },
      { label: '年龄', value: '几个世纪' },
      { label: '阵营', value: '前重塑之手(已脱离)' },
      { label: '外貌', value: '苍白皮肤,灰色眼睛,口红颜色不定' },
      { label: '香水', value: '酒红色尾调' },
      { label: '据点', value: '巴黎(画廊/酒馆/骑士俱乐部休息室)' },
      { label: '社交哲学', value: '永远让人以为你在别处' },
    ] },
  { name: '塞梅尔维斯', kind: 'character', tech: 'semmelweis',
    summary: '圣洛夫基金会高级调查员,转化种血食怪。红色瞳孔,天鹅绒斗篷。本名贝拉。孤儿院出身,被瓦伦缇娜转化。',
    fields: [
      { label: '种族', value: '转化种血食怪' },
      { label: '本名', value: '贝拉' },
      { label: '所属', value: '圣洛夫基金会' },
      { label: '职务', value: '高级调查员' },
      { label: '外貌', value: '深棕色长发,红色瞳孔,白缎领巾,天鹅绒斗篷' },
      { label: '转化者', value: '瓦伦缇娜' },
      { label: '训练', value: '侦察、审讯、格斗、神秘术对抗' },
    ] },
  { name: '弗洛里安·德·马赛尔', kind: 'character', tech: 'florian',
    summary: '马赛尔家族族长,约两百岁纯血血食怪。收藏品中间商(表面),违禁品走私网络运营者(实际)。急切的暴发户,瓦伦缇娜的主要对手。在名单上,正常出席宴会。',
    fields: [
      { label: '种族', value: '纯血血食怪' },
      { label: '年龄', value: '约两百岁' },
      { label: '全名', value: 'Florian Antoine de Marcel' },
      { label: '身份', value: '马赛尔家族族长 / 中间商' },
      { label: '与重塑之手', value: '非正式供应商,不在成员名册上' },
      { label: '核心特质', value: '急切——做什么都比必要的速度快一拍' },
      { label: '对瓦伦缇娜', value: '三分嫉妒,三分不服,三分取而代之,一分敬畏' },
      { label: '宴会计划', value: '与中间商谈两件事:一批违禁品交易 + 推销在研嗜血激活药剂' },
      { label: '下药动机', value: '冲动决定——中间商转向瓦伦缇娜后被当众羞辱的愤怒' },
    ] },
  { name: '艾玛', kind: 'character', tech: 'emma',
    summary: '多瑙黎明号列车乘务员,半血血食怪时代就记性很好。瓦伦缇娜和塞梅尔维斯的共同恩人之一,是瓦伦缇娜的线人。',
    fields: [
      { label: '身份', value: '多瑙黎明号列车乘务员' },
      { label: '特长', value: '记住某些让她有理由记住的人' },
    ] },
  { name: '灰西装中间商', kind: 'character', tech: 'grey_suit',
    summary: '专门服务贵族收藏家的中间商,客户名单里掺进了重塑之手成员。与弗洛里安有合作关系。原定当晚与弗洛里安谈生意,但在贵宾通道撞见不在名单上的瓦伦缇娜后,当场判断——和弗洛里安的生意可以推后,和瓦伦缇娜建立关系不能等——主动贴上去陪同入场。',
    fields: [
      { label: '身份', value: '收藏品中间商' },
      { label: '嫌疑', value: '知道瓦伦缇娜行程,可能泄露行踪' },
      { label: '宴会行为', value: '在贵宾通道临时变卦,放弃弗洛里安转向瓦伦缇娜' },
      { label: '对弗洛里安', value: '合作伙伴,但遇到更高价值目标时毫不犹豫地抛弃' },
    ] },
  { name: '假侍者', kind: 'character', tech: 'fake_waiter',
    summary: '俱乐部的侍者,欠弗洛里安人情。弗洛里安在酒台把药剂兑进酒里后,让他端过去送给瓦伦缇娜。酒被塞梅尔维斯截走后立即暴露,逃入人群。',
    fields: [
      { label: '行为', value: '拒绝沿途宾客取酒,直奔瓦伦缇娜' },
      { label: '与弗洛里安', value: '欠人情,被临时指派送酒' },
      { label: '结局', value: '逃逸,尚未查明身份' },
    ] },
  { name: '接待员', kind: 'character',
    summary: '白厅七号前厅的接待员。金属框眼镜、红色马甲,名字普通到记混。',
    fields: [] },
  { name: '范肖先生', kind: 'character', tech: 'fanshaw',
    summary: '收藏家,秃头绅士。姓氏拼作 Featherstonhaugh 读作范肖。软盘经手人。',
    fields: [
      { label: '全名拼法', value: 'Featherstonhaugh' },
    ] },
  { name: '技术档案室接线员', kind: 'character',
    summary: '基金会技术档案室值班员,查询软盘术式编号。', fields: [] },

  // ---- 地点
  { name: '巴黎骑士俱乐部', kind: 'location', tech: 'knights_club',
    summary: '历史比法兰西共和国还长的私人俱乐部。大革命假装倒闭,拿破仑时假装换名,两次大战假装搬家。壁炉上方的画随瓦伦缇娜的喜好更换。',
    fields: [
      { label: '特征', value: '封闭、精准筛选宾客,情报密集' },
      { label: '瓦伦缇娜的特权', value: '专属休息室;不在名单上但随时可出现' },
    ] },
  { name: '瓦伦缇娜的住所', kind: 'location', tech: 'valentina_residence',
    summary: '瓦伦缇娜处理邀请函、翻阅宣传册的地方。有抽屉存放各国各地的邀请函。', fields: [] },
  { name: '多瑙黎明号列车', kind: 'location', tech: 'danube_dawn',
    summary: '东起伊斯坦布尔、西至维也纳的老线,如今贯通到巴黎。基金会管辖后,出差调查员免费乘坐。',
    fields: [] },
  { name: '圣洛夫基金会总部', kind: 'location', tech: 'foundation_hq',
    summary: '走廊长得像走不到尽头的白色地狱拼图。配给处发放通讯器。', fields: [] },
  { name: '白厅七号', kind: 'location', tech: 'whitehall_7',
    summary: '威斯敏斯特区维多利亚时期建筑。神秘学藏品交易所。', fields: [] },
  { name: '堤岸夹层通道', kind: 'location', tech: 'embankment_layer',
    summary: '维多利亚堤岸填河造陆时建在铁路隧道与下水道之间的夹层。墙体混入抑制神秘术的符文。', fields: [] },

  // ---- 阵营
  { name: '圣洛夫基金会', kind: 'faction', tech: 'foundation',
    summary: '管辖超自然事务的组织,雇佣调查员,拥有收容设施和技术档案室。', fields: [] },
  { name: '重塑之手', kind: 'faction', tech: 'reshapers',
    summary: '阿尔卡纳组织,招揽神秘学家的标准极严。高级赞助者和使徒不会在脸上写着身份。',
    fields: [
      { label: '招募标准', value: '比萨维尔街最挑剔的裁缝还严格' },
    ] },
  { name: '马赛尔家族', kind: 'faction', tech: 'marcel_family',
    summary: '1793年恐怖统治时期起源的血食怪家族。"在废墟里捡东西,等世界恢复正常后卖回去"的商业模式沿用两百年。暴发户定位。',
    fields: [
      { label: '起源', value: '1793年法国大革命' },
      { label: '现任族长', value: '弗洛里安·德·马赛尔' },
      { label: '家族规模', value: '纯血不超过五人,另有附庸' },
      { label: '商业模式', value: '每次战争/革命/政权更迭都是采购季' },
    ] },

  // ---- 物品
  { name: '嗜血激活药剂', kind: 'item', tech: 'blood_drug',
    summary: '弗洛里安正在研制的药剂,尚未完善——剂量、发作时间、持续时长都没有精确校准。本意是作为样品展示给中间商看,在他的客户圈里找买家。因中间商临时变卦而被愤怒中的弗洛里安提前投入使用。',
    fields: [
      { label: '效果', value: '放大嗜血本能,听到几十颗心脏跳动,刺激獠牙生长' },
      { label: '研发状态', value: '在研,剂量/发作时间/持续时长均未校准' },
      { label: '原定用途', value: '样品——展示给中间商,在客户圈里找买家' },
      { label: '实际用途', value: '愤怒中兑进酒里,由欠人情的侍者送出' },
      { label: '意外受害者', value: '塞梅尔维斯(截走了酒)' },
      { label: '解毒方式', value: '瓦伦缇娜以吻喂血,压过药效' },
    ] },
  { name: '德产直板手机', kind: 'item', tech: 'phone',
    summary: '瓦伦缇娜在巴黎宴会后留给塞梅尔维斯的手机,通讯录里只有一个联系人。',
    fields: [
      { label: '来历', value: '宴会后瓦伦缇娜的"礼物"' },
      { label: '通讯录', value: '唯一联系人:瓦伦缇娜' },
    ] },
  { name: '传送软盘', kind: 'item', tech: 'floppy',
    summary: '五英寸黑色软盘,编号 LSCC-TPT-LDN-ERR。第六次暴雨前生产,指向伦敦地下,一次性使用。',
    fields: [] },
];

/* ---------- 组装项目 ---------- */

function build(): Project {
  const now = Date.UTC(2026, 7, 9, 12, 0, 0);

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

  // 按故事分卷,按章/视角分章
  const storyOrder = ['名单之外', '宴会风波一则', '老伦敦寻人记'];
  const allScenes = [...SCENES_MINGDAN, ...SCENES_YANHUI, ...SCENES_LONDON];
  const sourceByStory: Record<string, string[]> = {
    '名单之外': SRC_MINGDAN,
    '宴会风波一则': SRC_YANHUI,
    '老伦敦寻人记': SRC_LONDON,
  };

  // 卷文件夹(按故事)
  const folders: Folder[] = [];
  const volumeByStory = new Map<string, Folder>();
  for (let i = 0; i < storyOrder.length; i++) {
    const vol: Folder = {
      id: uid(), name: storyOrder[i], module: 'document',
      documentRole: 'volume', order: i,
    };
    volumeByStory.set(storyOrder[i], vol);
    folders.push(vol);
  }

  // 章文件夹(按 chapter 去重)
  const chapterKey = (story: string, ch: string) => `${story}::${ch}`;
  const chapterByKey = new Map<string, Folder>();
  let chapterOrder = 0;
  for (const scene of allScenes) {
    const key = chapterKey(scene.story, scene.chapter);
    if (chapterByKey.has(key)) continue;
    const vol = volumeByStory.get(scene.story)!;
    const ch: Folder = {
      id: uid(), name: scene.chapter, module: 'document',
      parentId: vol.id, documentRole: 'chapter', order: chapterOrder++,
    };
    chapterByKey.set(key, ch);
    folders.push(ch);
  }

  // 场景文档
  const documents: Document[] = [];
  const docByKey = new Map<string, Document>(); // "story::title" → doc
  let sceneOrder = 0;
  for (const scene of allScenes) {
    const src = sourceByStory[scene.story];
    const raw = src.slice(scene.from - 1, scene.to).join('\n');
    const blocks: DocBlock[] = [];
    for (const para of raw.split(/\n\s*\n/)) {
      const block = paragraphToBlock(para);
      if (!block) continue;
      if (block.speakerId) {
        const speaker = entityByName.get(block.speakerId);
        block.speakerId = speaker ? speaker.id : undefined;
      }
      blocks.push(block);
    }
    const key = chapterKey(scene.story, scene.chapter);
    const doc: Document = {
      id: uid(),
      folderId: chapterByKey.get(key)!.id,
      order: sceneOrder++,
      name: scene.title,
      category: '正文',
      blocks,
      notes: '',
      status: scene.status,
      povId: entityByName.get(scene.pov)?.id,
      locationId: entityByName.get(scene.location)?.id,
      timeLabel: scene.time,
      tension: scene.tension as 1 | 2 | 3 | 4 | 5,
      revision: 1,
      createdAt: now,
      updatedAt: now,
    };
    documents.push(doc);
    docByKey.set(`${scene.story}::${scene.title}`, doc);
  }

  const docId = (story: string, title: string) => {
    const d = docByKey.get(`${story}::${title}`);
    if (!d) throw new Error(`找不到文档: ${story}::${title}`);
    return d.id;
  };
  const entityId = (name: string) => {
    const e = entityByName.get(name);
    if (!e) throw new Error(`找不到实体: ${name}`);
    return e.id;
  };

  // ---- 关系
  const rel = (from: string, to: string, label: string, bidir = false, color = '#565550', note = ''): EntityRelation => ({
    id: uid(), fromId: entityId(from), toId: entityId(to), label, bidirectional: bidir, color, note,
  });
  const relations: EntityRelation[] = [
    rel('瓦伦缇娜', '塞梅尔维斯', '转化者 / 恋人', true, '#8b2252', '瓦伦缇娜转化了塞梅尔维斯,两人的关系在否认与靠近之间反复'),
    rel('瓦伦缇娜', '弗洛里安·德·马赛尔', '对手', false, '#aa3333', '弗洛里安试图取代瓦伦缇娜的影响力;宴会投毒是冲动之举,非深思熟虑的阴谋'),
    rel('瓦伦缇娜', '艾玛', '恩人 → 线人', false, '#565550', '艾玛在列车上为瓦伦缇娜通报塞梅尔维斯的行踪'),
    rel('塞梅尔维斯', '圣洛夫基金会', '雇员', false, '#565550'),
    rel('弗洛里安·德·马赛尔', '马赛尔家族', '族长', false, '#565550'),
    rel('弗洛里安·德·马赛尔', '重塑之手', '非正式供应商', false, '#72716b', '不在成员名册上,以中间人身份服务外围'),
    rel('弗洛里安·德·马赛尔', '灰西装中间商', '合作者', false, '#72716b'),
    rel('灰西装中间商', '重塑之手', '客户名单有交叉', false, '#8e8d86'),
    rel('假侍者', '弗洛里安·德·马赛尔', '欠人情', false, '#aa3333'),
  ];

  // ---- 伏笔(跨故事)
  const foreshadow = (title: string, note: string, plants: [string, string][], payoffs: [string, string][]): Foreshadow => ({
    id: uid(), title, note,
    plants: plants.map(([s, t]) => ({ id: uid(), docId: docId(s, t) })),
    payoffs: payoffs.map(([s, t]) => ({ id: uid(), docId: docId(s, t) })),
    createdAt: now,
  });
  const foreshadows: Foreshadow[] = [
    foreshadow('弗洛里安的名字在名单上',
      '《名单之外》瓦伦缇娜看到名单上弗洛里安的名字皱了眉,但仍决定赴宴。她并不知道弗洛里安当晚会因中间商的背叛而冲动下药。',
      [['名单之外', '骑士俱乐部与一个讨厌的名字']],
      [['宴会风波一则', '醒来']]),
    foreshadow('投毒酒是送给瓦伦缇娜的',
      '侍者端着唯一一杯红酒直奔瓦伦缇娜,被塞梅尔维斯赌气截走。弗洛里安的冲动决定因一个不在他视野里的人而落空。',
      [['宴会风波一则', '一杯被截走的红酒']],
      [['宴会风波一则', '醒来']]),
    foreshadow('瓦伦缇娜以吻喂血',
      '解救失控的塞梅尔维斯的方式是咬破自己嘴唇喂血。宴会上的"恋人"误会由此而来。',
      [['宴会风波一则', '失控']],
      [['老伦敦寻人记', '遮阳篷下的第一条短信']]),
    foreshadow('手机——通讯录里唯一的联系人',
      '宴会后瓦伦缇娜留下的手机成为伦敦篇的救命线索。她从没用它联系过谁,第一条消息就是求救。',
      [['宴会风波一则', '醒来']],
      [['老伦敦寻人记', '遮阳篷下的第一条短信']]),
    foreshadow('占星术有其道理',
      '塞梅尔维斯翻到会刊星座栏"请不要回避那些你一直不敢正视的感受",嗤之以鼻——然后瓦伦缇娜就出现了。',
      [['宴会风波一则', '入场']],
      [['宴会风波一则', '贵宾入场']]),
    foreshadow('天鹅绒斗篷的边界',
      '斗篷能让她混进宴会、骗过侍者,却无法教她怎样接近瓦伦缇娜身边那群人。',
      [['宴会风波一则', '贵宾入场']],
      [['老伦敦寻人记', '白色地狱的走廊']]),
    foreshadow('瓦伦缇娜教过的雾化',
      '不经意的指点成了穿墙的唯一手段。',
      [['老伦敦寻人记', '一张软盘的来历']],
      [['老伦敦寻人记', '第四下钟声']]),
    foreshadow('装死骗过她一次',
      '最初就被这个人装死骗过——这次"受困"同样是半个谎。',
      [['老伦敦寻人记', '一张软盘的来历']],
      [['老伦敦寻人记', '感谢我的仁慈吧']]),
    foreshadow('瓦伦缇娜提到的秘书幻想',
      '名单之外里瓦伦缇娜幻想塞梅尔维斯做她的秘书,暗示她对这个调查员的关注远超表面。',
      [['名单之外', '塞梅尔维斯应该做她的秘书']],
      []),  // payoff 待写
  ];

  // ---- 角色弧线
  const arcs: ArcStage[] = [
    // 塞梅尔维斯:从否认到承认
    { id: uid(), entityId: entityId('塞梅尔维斯'), title: '专业的调查员',
      note: '来宴会盯梢中间商,不想见瓦伦缇娜。', docId: docId('宴会风波一则', '入场'), order: 0 },
    { id: uid(), entityId: entityId('塞梅尔维斯'), title: '斗篷的边界',
      note: '看着瓦伦缇娜被人围住,心里不太舒服。', docId: docId('宴会风波一则', '贵宾入场'), order: 1 },
    { id: uid(), entityId: entityId('塞梅尔维斯'), title: '赌气截酒',
      note: '出于嫉妒截走了送给瓦伦缇娜的酒。', docId: docId('宴会风波一则', '一杯被截走的红酒'), order: 2 },
    { id: uid(), entityId: entityId('塞梅尔维斯'), title: '獠牙与心跳',
      note: '药效发作,在众人面前几乎失控。', docId: docId('宴会风波一则', '失控'), order: 3 },
    { id: uid(), entityId: entityId('塞梅尔维斯'), title: '每天带着那台手机',
      note: '拒绝承认在等消息,理由全是借口。', docId: docId('老伦敦寻人记', '白色地狱的走廊'), order: 4 },
    { id: uid(), entityId: entityId('塞梅尔维斯'), title: '为她走进雨里',
      note: '不走官方流程,不等一周。', docId: docId('老伦敦寻人记', '技术档案室'), order: 5 },
    { id: uid(), entityId: entityId('塞梅尔维斯'), title: '松开攥着的手指',
      note: '发现被骗,却先确认了脉搏是真的。', docId: docId('老伦敦寻人记', '感谢我的仁慈吧'), order: 6 },

    // 瓦伦缇娜:从社交计算到暴露真心
    { id: uid(), entityId: entityId('瓦伦缇娜'), title: '社交经济学家',
      note: '维持社交形象最经济的方式是让人以为你在别处。', docId: docId('名单之外', '邀请函与社交经济学'), order: 0 },
    { id: uid(), entityId: entityId('瓦伦缇娜'), title: '秘书幻想',
      note: '想象塞梅尔维斯帮她处理邀请函时的表情,嘴角扬起。', docId: docId('名单之外', '塞梅尔维斯应该做她的秘书'), order: 1 },
    { id: uid(), entityId: entityId('瓦伦缇娜'), title: '为可能赴约',
      note: '用一个可能去抵消一个肯定——神秘学家和理性毫不沾边。', docId: docId('名单之外', '骑士俱乐部与一个讨厌的名字'), order: 2 },
    { id: uid(), entityId: entityId('瓦伦缇娜'), title: '以吻喂血',
      note: '当众咬破嘴唇,把血推进塞梅尔维斯口中。', docId: docId('宴会风波一则', '失控'), order: 3 },
    { id: uid(), entityId: entityId('瓦伦缇娜'), title: '留下线索和手机',
      note: '替她写调查报告,留下一台只有自己联系方式的手机。', docId: docId('宴会风波一则', '醒来'), order: 4 },
    { id: uid(), entityId: entityId('瓦伦缇娜'), title: '我只是想看你自愿来找我',
      note: '故意困在盒子里等塞梅尔维斯来救。', docId: docId('老伦敦寻人记', '感谢我的仁慈吧'), order: 5 },
  ];

  // ---- 时间线
  const trackParty: TimelineTrack = { id: uid(), name: '巴黎宴会篇', color: '#8b2252' };
  const trackLondon: TimelineTrack = { id: uid(), name: '伦敦寻人篇', color: '#565550' };

  const partyPoints: TimelinePoint[] = [
    '宴会前数日·邀请函', '宴会前·收到名单', '宴会当晚·入场',
    '宴会当晚·瓦伦缇娜入场', '宴会当晚·投毒',
    '宴会当晚·失控与吻', '宴会当晚·两小时后醒来',
  ].map((label) => ({ id: uid(), label }));
  const londonPoints: TimelinePoint[] = [
    '16:09 发信', '16:15 收到', '16:32 第二封', '17:00 大本钟',
    '17:20 范肖', '17:40 档案室', '17:55 闻到血', '18:00 整点共振',
  ].map((label) => ({ id: uid(), label }));

  const timelineEvents: TimelineEvent[] = [
    { id: uid(), trackId: trackParty.id, pointId: partyPoints[0].id,
      title: '瓦伦缇娜收到邀请函', text: '处理十几份邀请,全部用"另一场"推掉',
      entityIds: [entityId('瓦伦缇娜')], documentIds: [docId('名单之外', '邀请函与社交经济学')] },
    { id: uid(), trackId: trackParty.id, pointId: partyPoints[1].id,
      title: '名单上看到弗洛里安', text: '皱眉——去则遇讨厌的人,不去则确定见不到塞梅尔维斯',
      entityIds: [entityId('瓦伦缇娜'), entityId('弗洛里安·德·马赛尔')],
      documentIds: [docId('名单之外', '骑士俱乐部与一个讨厌的名字')] },
    { id: uid(), trackId: trackParty.id, pointId: partyPoints[2].id,
      title: '塞梅尔维斯入场', text: '乔装为宾客执行基金会任务,拒绝了入口的香槟',
      entityIds: [entityId('塞梅尔维斯')], documentIds: [docId('宴会风波一则', '入场')] },
    { id: uid(), trackId: trackParty.id, pointId: partyPoints[3].id,
      title: '瓦伦缇娜从贵宾门入场', text: '中间商在贵宾通道临时变卦,放弃弗洛里安转向瓦伦缇娜陪同入场。弗洛里安在人群中目睹全过程',
      entityIds: [entityId('瓦伦缇娜'), entityId('灰西装中间商'), entityId('弗洛里安·德·马赛尔')],
      documentIds: [docId('宴会风波一则', '贵宾入场')] },
    { id: uid(), trackId: trackParty.id, pointId: partyPoints[4].id,
      title: '弗洛里安冲动下药', text: '被中间商当众抛弃后的愤怒——手里恰好有在研药剂样品,俱乐部恰好有个欠他人情的侍者',
      entityIds: [entityId('弗洛里安·德·马赛尔'), entityId('假侍者'), entityId('嗜血激活药剂')],
      documentIds: [] },
    { id: uid(), trackId: trackParty.id, pointId: partyPoints[4].id,
      title: '投毒酒被截走', text: '塞梅尔维斯出于赌气截走送给瓦伦缇娜的红酒。弗洛里安看到一个陌生女人拿走了酒,花了好几秒才理解发生了什么',
      entityIds: [entityId('塞梅尔维斯'), entityId('假侍者'), entityId('弗洛里安·德·马赛尔')],
      documentIds: [docId('宴会风波一则', '一杯被截走的红酒')] },
    { id: uid(), trackId: trackParty.id, pointId: partyPoints[5].id,
      title: '瓦伦缇娜以吻喂血', text: '当众咬破嘴唇压制塞梅尔维斯的嗜血本能',
      entityIds: [entityId('瓦伦缇娜'), entityId('塞梅尔维斯')],
      documentIds: [docId('宴会风波一则', '失控')] },
    { id: uid(), trackId: trackParty.id, pointId: partyPoints[6].id,
      title: '塞梅尔维斯在梳妆室醒来', text: '发现调查线索、半杯酒和一台手机',
      entityIds: [entityId('塞梅尔维斯')], documentIds: [docId('宴会风波一则', '醒来')] },

    { id: uid(), trackId: trackLondon.id, pointId: londonPoints[0].id,
      title: '瓦伦缇娜发出求救', text: '我需要你的帮助,亲爱的塞梅尔维斯',
      entityIds: [entityId('瓦伦缇娜')], documentIds: [docId('老伦敦寻人记', '遮阳篷下的第一条短信')] },
    { id: uid(), trackId: trackLondon.id, pointId: londonPoints[3].id,
      title: '大本钟五点报时', text: '距离求救已近一小时',
      entityIds: [], documentIds: [docId('老伦敦寻人记', '威斯敏斯特的雨')] },
    { id: uid(), trackId: trackLondon.id, pointId: londonPoints[4].id,
      title: '说服范肖取得软盘', text: '软盘存在严重缺陷……',
      entityIds: [entityId('塞梅尔维斯'), entityId('范肖先生')],
      documentIds: [docId('老伦敦寻人记', '范肖先生')] },
    { id: uid(), trackId: trackLondon.id, pointId: londonPoints[6].id,
      title: '闻到瓦伦缇娜的血', text: '血腥味从窄缝里涌进来',
      entityIds: [entityId('塞梅尔维斯')], documentIds: [docId('老伦敦寻人记', '血')] },
    { id: uid(), trackId: trackLondon.id, pointId: londonPoints[7].id,
      title: '第四下钟声·雾化穿越', text: '钟声与列车交会的共振窗口',
      entityIds: [entityId('塞梅尔维斯'), entityId('瓦伦缇娜')],
      documentIds: [docId('老伦敦寻人记', '第四下钟声')] },
  ];

  // ---- 资料卡(马塞尔设定完整录入)
  const marcelSetting = readFileSync(
    join(OBSIDIAN, '随便写-一些设定', '瓦伦缇娜的死对头-马塞尔家族.md'), 'utf8');
  const researchCards: ResearchCard[] = [
    { id: uid(), title: '弗洛里安·德·马赛尔与马赛尔家族(完整设定)',
      content: marcelSetting,
      category: '角色设定', tags: ['对手', '马赛尔家族', '弗洛里安'],
      pinned: true, createdAt: now, updatedAt: now },
    { id: uid(), title: '巴黎宴会事件复盘(塞梅尔维斯推理)',
      content: [
        '■ 酒是送给瓦伦缇娜的,侍者知道里面有问题',
        '■ 瓦伦缇娜不在公开名单,但有人安排了贵宾通道',
        '■ 酒在她露面后才从侧厅送出 → 至少一次实时确认',
        '■ 对方知道瓦伦缇娜是血食怪',
        '■ 目的:在众人面前暴露血食怪身份 → 摧毁社交形象',
        '■ 药剂不像成品——发作速度和持续时间不稳定,像是在研样品',
        '■ 灰西装中间商跟着瓦伦缇娜从贵宾门出现,可能知情',
        '',
        '塞梅尔维斯的盲区:她合理推测这是一次有预谋的行动,',
        '但实际上弗洛里安的决定是临时起意——这条推理线索会把她引向',
        '错误的方向(去找"幕后策划者",而真正的动机只是当众被羞辱后的愤怒)',
        '',
        '瓦伦缇娜写在背面的名字 → 嫌疑人(待确认是否为重塑之手)',
      ].join('\n'),
      category: '调查线索', tags: ['宴会', '投毒', '待追查', '信息差'],
      pinned: true, createdAt: now, updatedAt: now },
    { id: uid(), title: '完整事件逻辑(作者视角)',
      content: [
        '■ 宴会开始前',
        '弗洛里安在名单上,正常出席。他和中间商事先约好今晚谈两件事:一批新的违禁品交易,以及他手头一种还在研制中的嗜血激活药剂——想让中间商在客户圈里找买家。药剂装在小容器里随身携带,本意是作为样品展示。',
        '',
        '■ 瓦伦缇娜到场',
        '弗洛里安在厅里等中间商来找他。贵宾门开了,他看见中间商走进来——但中间商身边跟着瓦伦缇娜。',
        '他立刻明白发生了什么:中间商在贵宾通道撞见不在名单上的瓦伦缇娜,当场判断——和弗洛里安谈生意可以推后,和瓦伦缇娜建立关系不能等。于是主动贴上去,跟着她走进了大厅。',
        '弗洛里安站在人群里,看着自己的生意伙伴以他非常熟悉的姿态——殷勤、主动、微微前倾——围着瓦伦缇娜转。这个画面他已经看过无数次了。每一次都是同一个剧本:不管他花多长时间经营一段关系,只要瓦伦缇娜出现在同一个房间里,所有人都会自动转向她。',
        '',
        '■ 决定下药',
        '这不是一个深思熟虑的计划。这是一个被当众羞辱的人在愤怒中做出的冲动决定。',
        '他手里恰好有药剂样品。他在俱乐部恰好有一个欠他人情的侍者。他需要做的只是在酒台把药剂兑进一杯酒里,让那个侍者端过去。',
        '原本这种药剂是要等完善之后才投入使用的——剂量、发作时间、持续时长都还没有精确校准。但他现在不想等了。他看着中间商对瓦伦缇娜点头哈腰的背影,做出了今晚最差的一个决定。',
        '',
        '■ 塞梅尔维斯截酒',
        '弗洛里安不认识塞梅尔维斯。他甚至没有注意到她。他的全部注意力都在瓦伦缇娜身上——等着看药效发作后她会怎样在所有人面前失控。',
        '所以当一个穿着天鹅绒斗篷的年轻女人从侧面截走了那杯酒的时候,他花了好几秒才理解发生了什么。',
        '然后他看到那个女人喝掉了酒,走向瓦伦缇娜,然后——',
        '然后瓦伦缇娜搂着她往贵宾门走了。',
        '整个过程安静、迅速、看起来像一对情侣提前离席。',
        '弗洛里安站在人群里,手里端着一杯他完全没有动过的香槟,等待着一场没有发生的灾难。',
      ].join('\n'),
      category: '剧情笔记', tags: ['弗洛里安', '完整逻辑', '事件链'],
      pinned: true, createdAt: now, updatedAt: now },
    { id: uid(), title: '各视角信息差(作者视角)',
      content: [
        '■ 塞梅尔维斯看到的',
        '瓦伦缇娜和嫌疑人一起从贵宾门出现。她不知道弗洛里安的存在,不知道药酒,不知道中间商是临时变卦才跟着瓦伦缇娜的。她只看到"瓦伦缇娜又和可疑的人搅在一起了"。',
        '',
        '■ 瓦伦缇娜看到的',
        '中间商在主动攀附她。她知道弗洛里安在名单上,进入大厅后可能扫到过他的位置,但没有把他和后来那杯酒联系起来——至少不是立刻。她对弗洛里安的判断仍然是"不值得注意的晚辈"。直到她事后追查侍者,才会发现这条线指向弗洛里安。',
        '',
        '■ 弗洛里安看到的',
        '他看到了全过程,但理解错了因果。他看到一个陌生女人截走了酒,看到她走向瓦伦缇娜,看到她在瓦伦缇娜怀里失控——他可能以为这个女人是瓦伦缇娜的随从或恋人,主动替主人试酒。他不知道这是一个基金会调查员,不知道她是因为赌气才拿走了那杯酒。',
        '',
        '■ 中间商看到的',
        '他什么都不知道。他正在和瓦伦缇娜交谈,突然有个年轻女人冲过来,说了几句不太连贯的话,然后瓦伦缇娜就搂着她离开了。他可能短暂地感到被冷落,然后继续在宴会厅里寻找下一个值得攀附的人。',
      ].join('\n'),
      category: '剧情笔记', tags: ['信息差', '多视角', '误解'],
      pinned: true, createdAt: now, updatedAt: now },
    { id: uid(), title: '待写内容清单',
      content: [
        '□ 《名单之外》后续:瓦伦缇娜在宴会中的视角(从入场到发现塞梅尔维斯)',
        '□ 《名单之外》后续:瓦伦缇娜处理事后(留下线索、安排梳妆室、写信)',
        '□ 弗洛里安视角的短篇(可选)',
        '□ 宴会后瓦伦缇娜对弗洛里安的反击',
        '□ 玫瑰胸针事件(与《临时保护行动》联动)',
      ].join('\n'),
      category: '待办', tags: ['写作计划'],
      pinned: true, createdAt: now, updatedAt: now },
  ];

  // ---- 组装
  const project: Project = {
    version: 1,
    name: '巴黎宴会篇(跨故事工作台)',
    workspacePreset: 'novel',
    flows: [],
    entities,
    brainstormNotes: [], brainstormEdges: [],
    outlineColumns: [], outlineRows: [],
    timelineTracks: [trackParty, trackLondon],
    timelinePoints: [...partyPoints, ...londonPoints],
    timelineEvents,
    maps: [],
    researchCards,
    researchCategories: ['角色设定', '调查线索', '剧情笔记', '待办'],
    variables: [],
    assets: [],
    documents,
    documentCategories: ['正文'],
    attachments: {},
    folders,
    relations,
    foreshadows,
    arcs,
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
console.log(`  ${project.entities.length} 实体 · ${project.foreshadows?.length ?? 0} 伏笔 · ${project.arcs?.length ?? 0} 弧线阶段`);
console.log(`  ${project.timelineEvents.length} 时间线事件 · ${project.relations?.length ?? 0} 关系`);
console.log(`  ${project.researchCards.length} 资料卡`);
