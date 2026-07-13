import type { Project } from './types';
import { uid } from './util';

/**
 * 内置示例项目:《老伦敦寻人记》
 * 横板像素解谜游戏 DEMO 的叙事设计工程,演示全部模块与节点类型。
 */
export function sampleProject(): Project {
  const semId = uid();   // 塞梅尔维斯
  const valId = uid();   // 瓦伦缇娜
  const fanId = uid();   // 范肖先生
  const whitehallId = uid();
  const tunnelId = uid();
  const phoneId = uid();

  const colRomance = uid();
  const colForeshadow = uid();
  const colPuzzle = uid();

  const trackSem = uid(), trackVal = uid();
  const ptBefore = uid(), pt1609 = uid(), pt1627 = uid(), ptFive = uid(), ptChime = uid();

  const n1 = uid(), n2 = uid(), n3 = uid(), n4 = uid(), n5 = uid(),
    n6 = uid(), n6b = uid(), n7 = uid(), n8 = uid(), n9 = uid(),
    n10 = uid(), n11 = uid(), n12 = uid(), n12b = uid(), n13 = uid(), n14 = uid(), n15 = uid();
  const s1 = uid(), s2 = uid(), s3 = uid(), s4 = uid();

  return {
    version: 1,
    name: '老伦敦寻人记',
    flows: [
      {
        id: uid(),
        name: 'DEMO · 雨夜寻人',
        nodes: [
          { id: n1, type: 'fragment', position: { x: 40, y: 200 }, data: { title: 'ACT 0 · 基金会走廊', text: '伦敦的雨季长得就像这条走廊——你永远搞不清楚走了多久,也不知道又在官僚主义的迷宫里拐了几个弯。我叫塞梅尔维斯,基金会高级调查员。今天放假。' } },
          { id: n2, type: 'dialogue', position: { x: 360, y: 200 }, data: { title: '第一条短信', text: '我需要你的帮助,亲爱的塞梅尔维斯 @-‵-,--', speakerId: valId } },
          { id: n3, type: 'dialogue', position: { x: 680, y: 200 }, data: { title: '仅存的回复', text: '……?', speakerId: semId } },
          { id: n4, type: 'dialogue', position: { x: 1000, y: 200 }, data: { title: '第二条短信', text: '很高兴你没把手机扔了。亲爱的,我好像被困在一个讨厌神秘术的盒子里。若死前只能与发霉的空气作伴,只好请求你发挥调查员本能了。帮我出去,价钱随你开,如何?', speakerId: valId } },
          {
            id: n5, type: 'fragment', position: { x: 1320, y: 200 },
            data: {
              title: '谜题 · 时间戳分析',
              text: '双击进入解谜子流程。',
              sub: {
                nodes: [
                  { id: s1, type: 'fragment', position: { x: 40, y: 120 }, data: { title: '便条纸展开', text: '第一条:发送 16:09,接收 16:15。第二条:发送 16:27,接收 16:32。伦敦市中心,五六分钟的延迟不正常。拨号尝试:「您拨打的号码暂时无法接通——」' } },
                  { id: s2, type: 'condition', position: { x: 380, y: 120 }, data: { title: '短信能到,电话不通?', text: 'signal_blocked == true' } },
                  { id: s3, type: 'exit', position: { x: 720, y: 40 }, data: { title: '屏蔽确认', text: '' } },
                  { id: s4, type: 'hub', position: { x: 720, y: 260 }, data: { title: '只是英国的信号', text: '' } },
                ],
                edges: [
                  { id: uid(), source: s1, target: s2 },
                  { id: uid(), source: s2, sourceHandle: 'true', target: s3, label: '存在物理或神秘术屏蔽' },
                  { id: uid(), source: s2, sourceHandle: 'false', target: s4, label: '再等等看' },
                ],
              },
            },
          },
          { id: n6, type: 'instruction', position: { x: 1660, y: 80 }, data: { title: '记下地址', text: 'has_address = true' } },
          { id: n6b, type: 'hub', position: { x: 1660, y: 340 }, data: { title: '假期照常', text: '' } },
          { id: n7, type: 'dialogue', position: { x: 1980, y: 80 }, data: { title: '白厅七号 · 范肖的行规', text: '行规在此——供货商的情报,恕难奉告。', speakerId: fanId } },
          { id: n8, type: 'dialogue', position: { x: 2300, y: 80 }, data: { title: '塞的说法', text: '那我以瓦伦缇娜女士的名义,当场替您拟定一份法律风险告知书。', speakerId: semId } },
          { id: n9, type: 'fragment', position: { x: 2620, y: 80 }, data: { title: '获得软盘', text: '五英寸黑色软盘,编号 LSCC-TPT-LDN-ERR。末尾的 ERR,在任何行业都不是个好词。' } },
          { id: n10, type: 'condition', position: { x: 2940, y: 80 }, data: { title: '整点 · 共振窗口', text: 'resonance_window == true' } },
          { id: n11, type: 'fragment', position: { x: 3260, y: -40 }, data: { title: '雾化穿越', text: '第四声钟声,双向列车交会,裂缝张开最宽的瞬间。她化为黑雾。第六声钟声结束前,她在墙的另一侧重新凝为实体。' } },
          { id: n12, type: 'hub', position: { x: 3260, y: 260 }, data: { title: '等下一班', text: '' } },
          { id: n12b, type: 'instruction', position: { x: 2940, y: 340 }, data: { title: '下一班进站', text: 'resonance_window = true' } },
          { id: n13, type: 'dialogue', position: { x: 3580, y: -40 }, data: { title: '黑暗里的笑声', text: '感谢我的仁慈吧,塞梅尔维斯,还想多逗逗你的。我特地挑了个墙缝最大的屋子等你。', speakerId: valId } },
          { id: n14, type: 'dialogue', position: { x: 3900, y: -40 }, data: { title: '报酬谈判', text: '报酬里应该包含一顿晚饭。……现在说的是晚饭的事。', speakerId: semId } },
          { id: n15, type: 'hub', position: { x: 4220, y: -40 }, data: { title: '晚饭:待定', text: '' } },
        ],
        edges: [
          { id: uid(), source: n1, target: n2 },
          { id: uid(), source: n2, target: n3, label: '三条草稿,删掉两条' },
          { id: uid(), source: n3, target: n4 },
          { id: uid(), source: n4, target: n5 },
          { id: uid(), source: n5, sourceHandle: `exit:${s3}`, target: n6, label: '目标:白厅七号' },
          { id: uid(), source: n5, target: n6b, label: '误判' },
          { id: uid(), source: n6, target: n7 },
          { id: uid(), source: n7, target: n8, label: '放弃亮证件,换个说法' },
          { id: uid(), source: n8, target: n9, label: '范肖举双手投降' },
          { id: uid(), source: n9, target: n10 },
          { id: uid(), source: n10, sourceHandle: 'true', target: n11, label: '现在!' },
          { id: uid(), source: n10, sourceHandle: 'false', target: n12, label: '错过时机' },
          { id: uid(), source: n12, target: n12b, label: '约三分钟' },
          { id: uid(), source: n12b, target: n10 },
          { id: uid(), source: n11, target: n13 },
          { id: uid(), source: n13, target: n14 },
          { id: uid(), source: n14, target: n15 },
        ],
      },
    ],
    entities: [
      {
        id: semId, kind: 'character', name: '塞梅尔维斯', color: '#1b1b19', emoji: '',
        summary: '基金会高级调查员,血食者。极度自律的理性外壳,以及被高级甜点和某人惯坏的品味内芯。今天放假——放到一半。',
        fields: [
          { id: uid(), label: '能力', value: '夜视、雾化(需要缝隙与时机)、犬齿' },
          { id: uid(), label: '职业病', value: '用查案逻辑分析感情问题,随时准备写投诉信' },
          { id: uid(), label: '当前状态', value: '休假中(被迫结束)' },
          { id: uid(), label: '关于那部手机', value: '只是觉得它重量尚可。绝对不是在等谁的短信。' },
        ],
        notes: '', createdAt: Date.now(),
      },
      {
        id: valId, kind: 'character', name: '瓦伦缇娜', color: '#3a3936', emoji: '',
        summary: '古老血食贵族,神秘术强者,以戏弄塞梅尔维斯为人生乐趣。目前被困在一个讨厌神秘术的盒子里,对此的主要不满集中在空气发霉。',
        fields: [
          { id: uid(), label: '身份', value: '血食贵族 · 收藏品爱好者' },
          { id: uid(), label: '称呼习惯', value: '亲爱的' },
          { id: uid(), label: '当前状态', value: '失踪 · 被困于维多利亚时期地下收容室' },
          { id: uid(), label: '求救风格', value: '保持标价的体面:「价钱随你开」' },
        ],
        notes: '', createdAt: Date.now(),
      },
      {
        id: fanId, kind: 'character', name: '范肖先生', color: '#72716b', emoji: '',
        summary: '收藏品交易商,秃头老绅士。姓氏拼作 Featherstonhaugh,念作范肖——这是他给每位访客的第一道谜题,不计分。',
        fields: [
          { id: uid(), label: '立场', value: '行规优先,直到听见「法律风险告知书」' },
        ],
        notes: '', createdAt: Date.now(),
      },
      {
        id: whitehallId, kind: 'location', name: '白厅七号', color: '#565550', emoji: '',
        summary: '维多利亚砖红建筑,没有门牌。对基金会调查员不构成障碍,只是在品味上略显可疑。',
        fields: [
          { id: uid(), label: '细节', value: '特制吸水地毯——这里的客人经常带着大量英国天气进门' },
        ],
        notes: '', createdAt: Date.now(),
      },
      {
        id: tunnelId, kind: 'location', name: '查令十字地下通道', color: '#8e8d86', emoji: '',
        summary: '铁路隧道与下水道之间的夹层。没有砖缝,一体浇筑。建这个收容室的人显然不希望任何人轻易找到出口。',
        fields: [
          { id: uid(), label: '规则', value: '墙内符文干扰,不可使用神秘术;导航靠振动与水声' },
        ],
        notes: '', createdAt: Date.now(),
      },
      {
        id: phoneId, kind: 'item', name: '德制直板手机', color: '#aaa9a1', emoji: '',
        summary: '通讯录里只有一个联系人。持有者坚称留着它是因为重量尚可,且德国电路的严谨设计适合记备忘录。绝对不是在等某人发来什么。绝对不是。',
        fields: [
          { id: uid(), label: '屏幕', value: '复古像素绿,黑暗里唯一的光源' },
        ],
        notes: '', createdAt: Date.now(),
      },
    ],
    brainstormNotes: [
      { id: uid(), text: '核心反差:救援任务 × 被迫结束的假期', color: '#ffffff', position: { x: 120, y: 80 } },
      { id: uid(), text: '手机是两条线之间唯一的通道——短信界面全部用复古像素绿', color: '#e6e4df', position: { x: 430, y: 40 } },
      { id: uid(), text: '瓦伦缇娜的求救也要保持体面:标价、比喻、落款的小鱼', color: '#d8d6d0', position: { x: 430, y: 220 } },
      { id: uid(), text: '结局不写拥抱,写晚饭谈判', color: '#f2f1ee', position: { x: 120, y: 260 } },
      { id: uid(), text: '收集要素「记忆碎片」:暴雨 / 巧克力 / 手机 / 她', color: '#ffffff', position: { x: 740, y: 130 } },
    ],
    brainstormEdges: [],
    outlineColumns: [
      { id: colRomance, title: '感情线', color: '#3a3936' },
      { id: colForeshadow, title: '悬念与伏笔', color: '#72716b' },
      { id: colPuzzle, title: '解谜设计', color: '#8e8d86' },
    ],
    outlineRows: [
      {
        id: uid(), no: 'ACT 0', time: '雨天下午', title: '基金会走廊',
        main: '塞领取新通讯器,假期开始。检视德制手机触发内心独白。',
        cells: {
          [colRomance]: '通讯录只有一个联系人(不点破)',
          [colForeshadow]: '她为什么一直带着这部手机',
          [colPuzzle]: '无,移动与检视教程',
        },
      },
      {
        id: uid(), no: 'ACT 1', time: '16:09–16:32', title: '雨中街道 · 遮阳篷',
        main: '两条求救短信先后抵达,塞注意到时间戳异常。',
        cells: {
          [colRomance]: '三条回复草稿删到只剩「……?」',
          [colForeshadow]: '延迟六分钟 + 电话不通',
          [colPuzzle]: '时间戳逻辑推断(信息全部来自已展示内容)',
        },
      },
      {
        id: uid(), no: 'ACT 2', time: '傍晚五点', title: '白厅七号',
        main: '过接待员一关,讯问范肖,取得软盘与手提包。',
        cells: {
          [colRomance]: '签名小游戏:那个更短的名字听起来不错。不打算进一步解释。',
          [colForeshadow]: '接待员不知道楼上发生了什么',
          [colPuzzle]: '对话博弈:不亮证件,以代理人身份施压',
        },
      },
      {
        id: uid(), no: 'ACT 3', time: '入夜', title: '查令十字地下',
        main: '手电筒、振动与水声导航;一个字的短信之后,气味追踪开启。',
        cells: {
          [colRomance]: '「血」——本能没经过意识批准就接管了呼吸系统',
          [colForeshadow]: '收容室的建造者不想让任何人找到出口',
          [colPuzzle]: '气味浓度指示条导航,走错方向消耗手电电量',
        },
      },
      {
        id: uid(), no: 'ACT 4-5', time: '整点', title: '共振与结局',
        main: '大本钟六声,雾化穿墙。黑暗中的重逢,与一场晚饭谈判。',
        cells: {
          [colRomance]: '靠在一起,听地铁的震动慢慢弱下去',
          [colForeshadow]: '救援小队抵达时间:未知',
          [colPuzzle]: '节奏 QTE:第四声钟声按下确认',
        },
      },
    ],
    timelineTracks: [
      { id: trackSem, name: '明线 · 塞梅尔维斯', color: '#1b1b19' },
      { id: trackVal, name: '暗线 · 瓦伦缇娜', color: '#565550' },
    ],
    timelinePoints: [
      { id: ptBefore, label: '半小时前' },
      { id: pt1609, label: '16:09' },
      { id: pt1627, label: '16:27' },
      { id: ptFive, label: '傍晚五点' },
      { id: ptChime, label: '整点钟声' },
    ],
    timelineEvents: [
      {
        id: uid(), trackId: trackVal, pointId: ptBefore,
        title: '拿起软盘的下一秒', text: '在供货商的收藏品里相中一张软盘,随即被传进没有门窗的盒子。手机电量掉得比法国人的防线还快。',
        entityIds: [valId],
      },
      {
        id: uid(), trackId: trackSem, pointId: pt1609,
        title: '遮阳篷下的第一条短信', text: '发送 16:09,接收 16:15。她盯着像素信封的发送动画,直到屏幕熄灭。',
        entityIds: [semId, phoneId],
      },
      {
        id: uid(), trackId: trackVal, pointId: pt1627,
        title: '标价救援', text: '「帮我出去,价钱随你开,如何?」',
        entityIds: [valId],
      },
      {
        id: uid(), trackId: trackSem, pointId: ptFive,
        title: '白厅七号讯问', text: '一份以瓦伦缇娜名义拟定的法律风险告知书,让行规失去了效力。',
        entityIds: [semId, fanId],
      },
      {
        id: uid(), trackId: trackSem, pointId: ptChime,
        title: '第四声钟声', text: '双向列车交会,裂缝最宽的瞬间,雾化穿越。',
        entityIds: [semId, tunnelId],
      },
      {
        id: uid(), trackId: trackVal, pointId: ptChime,
        title: '挑了个墙缝最大的屋子', text: '「感谢我的仁慈吧,还想多逗逗你的。」',
        entityIds: [valId],
      },
    ],
    researchCards: [
      {
        id: uid(), title: '血食者的能力边界',
        content: '夜视、雾化、犬齿。雾化需要缝隙与时机,并非随时可用;神秘术抑制符文环境下全部失效。这是收容室谜题成立的前提——她不能靠超自然能力走捷径,只能靠调查员的办法。',
        category: '世界观', tags: ['核心设定'], color: '#1b1b19', source: '', pinned: true, createdAt: Date.now(),
      },
      {
        id: uid(), title: '收容室与共振窗口',
        content: '维多利亚堤岸工程时期建造,位于铁路隧道与下水道之间的夹层,一体浇筑、混入抑制符文。大本钟整点报时与双向列车交会的叠加共振,能把约两毫米的裂缝撑到雾化可通过的宽度,窗口期约两声钟响。',
        category: '谜题设计', tags: ['解谜', 'ACT4'], color: '#3a3936', source: '', pinned: false, createdAt: Date.now(),
      },
      {
        id: uid(), title: '时间戳谜题的公平性',
        content: '玩家可见信息:两条短信的发送/接收时间、一次失败的拨号。三条推断全部由已展示信息导出,不依赖设定外知识。解谜游戏的底线是别让玩家猜作者在想什么。',
        category: '谜题设计', tags: ['解谜', 'ACT1'], color: '#72716b', source: '', pinned: false, createdAt: Date.now(),
      },
      {
        id: uid(), title: 'Featherstonhaugh 读作 Fanshaw',
        content: '英国姓氏的拼写与发音是两套独立运行的系统。本作把它用作一道不计分的谜题,以及一次让主角表情像吃到怪味巧克力的机会。',
        category: '世界观', tags: ['考据'], color: '#8e8d86', source: '', pinned: false, createdAt: Date.now(),
      },
      {
        id: uid(), title: '美术与音效基调',
        content: '深色调像素:维多利亚砖红、地铁橙黄、荧光绿短信屏。地下通道段落取消配乐,只保留水声、列车与心跳;QTE 段落让大本钟自己当节拍器。',
        category: '美术与音效', tags: ['美术'], color: '#aaa9a1', source: '', pinned: false, createdAt: Date.now(),
      },
    ],
    researchCategories: ['世界观', '谜题设计', '美术与音效'],
    variables: [
      { id: uid(), name: 'signal_blocked', type: 'boolean', value: 'true', description: '短信能到、电话不通——存在物理或神秘术屏蔽' },
      { id: uid(), name: 'has_address', type: 'boolean', value: 'false', description: '是否已取得白厅七号的地址' },
      { id: uid(), name: 'resonance_window', type: 'boolean', value: 'false', description: '大本钟整点与双向列车交会的共振窗口' },
      { id: uid(), name: 'chocolate_rating', type: 'number', value: '-3', description: '后勤部巧克力的可食用评分(满分 5)' },
    ],
    updatedAt: Date.now(),
  };
}
