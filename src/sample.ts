import type { Project } from './types';
import { uid } from './util';

/**
 * 内置示例项目:《老伦敦寻人记》
 * 横板像素解谜游戏 DEMO 的叙事设计工程,演示全部模块与节点类型:
 * 白检定(可重试)/ 红检定(仅一次)/ fallback 兜底结局 / seen() 台词变化 /
 * 变量资源(电量)/ 嵌套子流程 / 出口引脚 / SVG 地图标记。
 */

/** 威斯敏斯特核心区底图(内嵌 SVG,1000×750) */
const MAP_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 750" font-family="system-ui,sans-serif">
<rect width="1000" height="750" fill="#edeae3"/>
<rect x="60" y="270" width="250" height="230" rx="60" fill="#d4d8c8"/>
<text x="185" y="390" font-size="15" fill="#8a8d7d" text-anchor="middle">圣詹姆斯公园</text>
<path d="M 455 760 C 505 615 555 465 635 345 C 710 235 805 165 1010 125 L 1010 265 C 845 300 760 345 700 435 C 630 540 585 645 555 760 Z" fill="#b9c6cb"/>
<text x="800" y="235" font-size="16" fill="#7d9199" transform="rotate(-20 800 235)">泰晤士河</text>
<rect x="300" y="140" width="80" height="90" fill="#dcd8cf"/>
<rect x="420" y="200" width="90" height="120" fill="#dcd8cf"/>
<rect x="330" y="330" width="60" height="200" fill="#dcd8cf"/>
<rect x="420" y="360" width="80" height="150" fill="#dcd8cf"/>
<rect x="360" y="620" width="150" height="90" fill="#d3cec4"/>
<text x="435" y="672" font-size="12" fill="#8f897c" text-anchor="middle">议会大厦</text>
<path d="M 400 120 L 400 615" stroke="#fbfaf7" stroke-width="16" fill="none"/>
<path d="M 400 118 C 520 106 640 100 780 96" stroke="#fbfaf7" stroke-width="13" fill="none"/>
<path d="M 470 640 C 520 520 560 430 640 330 C 690 265 748 214 835 176" stroke="#fbfaf7" stroke-width="12" fill="none"/>
<path d="M 418 152 L 588 268" stroke="#fbfaf7" stroke-width="9" fill="none"/>
<path d="M 400 610 L 470 640" stroke="#fbfaf7" stroke-width="12" fill="none"/>
<path d="M 400 300 L 332 300 M 400 430 L 326 430" stroke="#fbfaf7" stroke-width="7" fill="none"/>
<text x="388" y="352" font-size="13" fill="#8f897c" transform="rotate(-90 388 352)">白厅</text>
<text x="600" y="88" font-size="12" fill="#8f897c">河岸街</text>
<text x="592" y="432" font-size="12" fill="#8f897c" transform="rotate(-49 592 432)">维多利亚堤岸</text>
<path d="M 455 646 L 662 600" stroke="#d8d3c8" stroke-width="14"/>
<text x="548" y="638" font-size="11" fill="#8f897c" transform="rotate(-12 548 638)">威斯敏斯特桥</text>
<path d="M 648 208 L 800 305" stroke="#c9c4b8" stroke-width="9" stroke-dasharray="14 7"/>
<text x="742" y="240" font-size="11" fill="#8f897c" transform="rotate(33 742 240)">亨格福德铁路桥</text>
<path d="M 470 655 C 522 532 566 438 648 336 C 698 273 752 224 838 186" stroke="#6b6a63" stroke-width="3" fill="none" stroke-dasharray="11 7"/>
<text x="700" y="330" font-size="11" fill="#6b6a63" transform="rotate(-40 700 330)">区域线(地下)</text>
<path d="M 430 720 C 445 675 458 640 470 606 C 486 564 510 540 545 525" stroke="#8c2f2f" stroke-width="3" fill="none" stroke-dasharray="2 7"/>
<text x="452" y="695" font-size="11" fill="#8c2f2f" transform="rotate(-70 452 695)">朱比利延长线 · 在建</text>
<circle cx="470" cy="600" r="8" fill="#fbfaf7" stroke="#1b1b19" stroke-width="3"/>
<rect x="458" y="597" width="24" height="6" fill="#1b1b19"/>
<circle cx="640" cy="190" r="8" fill="#fbfaf7" stroke="#1b1b19" stroke-width="3"/>
<rect x="628" y="187" width="24" height="6" fill="#1b1b19"/>
<circle cx="612" cy="255" r="6" fill="#fbfaf7" stroke="#1b1b19" stroke-width="2.5"/>
<text x="628" y="268" font-size="10" fill="#6b6a63">堤岸站</text>
<circle cx="400" cy="110" r="17" fill="#dcd8cf" stroke="#c6c1b5"/>
<circle cx="400" cy="110" r="3" fill="#8f897c"/>
<text x="400" y="84" font-size="12" fill="#8f897c" text-anchor="middle">特拉法加广场</text>
<rect x="443" y="596" width="13" height="32" fill="#6b5b45"/>
<circle cx="449.5" cy="604" r="4.5" fill="#e8e2d2" stroke="#4a4136"/>
<rect x="386" y="372" width="26" height="20" fill="#7a5a4a"/>
<rect x="330" y="142" width="34" height="24" fill="#8f8878"/>
<circle cx="428" cy="176" r="5" fill="#b08a4f"/>
<g transform="translate(935,70)"><path d="M 0 -26 L 8 8 L 0 2 L -8 8 Z" fill="#4a4a45"/><text y="28" text-anchor="middle" font-size="13" fill="#4a4a45">N</text></g>
<text x="40" y="58" font-size="26" fill="#1b1b19" font-weight="600">老伦敦 · 威斯敏斯特核心区</text>
<text x="40" y="80" font-size="13" fill="#8f897c">千禧年后 · 常年有雨</text>
<text x="40" y="726" font-size="11" fill="#a09a8c">比例仅供叙事参考 · 收容夹层位于区域线与下水道之间</text>
</svg>`;

export function sampleProject(): Project {
  const semId = uid();   // 塞梅尔维斯
  const valId = uid();   // 瓦伦缇娜
  const fanId = uid();   // 范肖先生
  const foundationId = uid();  // 基金会(阵营)
  const whitehallId = uid();   // 白厅七号
  const tunnelId = uid();      // 查令十字地下通道
  const containId = uid();     // 堤岸夹层收容室
  const phoneId = uid();       // 德制直板手机
  const floppyId = uid();      // 传送软盘

  const trackSem = uid(), trackVal = uid();
  const ptBefore = uid(), pt1609 = uid(), pt1627 = uid(), ptFive = uid(), ptChime = uid();

  const paletteId = uid();

  // ACT 0-1
  const n1 = uid(), n2 = uid(), nR1 = uid(), nR2 = uid(), nR3 = uid(), n4 = uid(), n5 = uid();
  const n6 = uid(), n6f = uid(), n6c = uid();
  // 时间戳子流程
  const s1 = uid(), s2 = uid(), s3 = uid(), s4 = uid();
  // ACT 2
  const n7 = uid(), c1 = uid(), c2 = uid(), c3 = uid(), cBluffFail = uid(), cAlarm = uid();
  const nFan = uid(), d1 = uid(), d2 = uid(), d3 = uid(), dGive = uid(), dConfess = uid(), dStubborn = uid();
  const nGot = uid();
  // ACT 3
  const n8 = uid(), e1 = uid(), e2 = uid();
  // ACT 4 + 地下子流程
  const nUnder = uid();
  const u1 = uid(), u2 = uid(), u3 = uid(), u4 = uid(), u5 = uid(), u6 = uid(), u6b = uid(), u7 = uid(), u8 = uid(), u9 = uid(), uexit = uid();
  // 结局
  const nChime = uid(), nA = uid(), nB = uid(), nC = uid(), vA = uid(), vB = uid(), nNeg = uid(), nEndA = uid();

  return {
    version: 1,
    name: '老伦敦寻人记',
    flows: [
      {
        id: uid(),
        name: 'DEMO · 雨夜寻人',
        technicalName: 'demo_rain_night',
        nodes: [
          /* ---------- ACT 0-1 · 遮阳篷与短信 ---------- */
          { id: n1, type: 'fragment', position: { x: 40, y: 300 }, data: { title: 'ACT 0 · 遮阳篷下', text: '伦敦的雨季长得就像基金会迟迟走不到尽头的走廊。我叫塞梅尔维斯,基金会高级调查员,今天放假。后勤部的怪味巧克力还黏在牙上,兜里那部德制直板手机突然震了。' } },
          { id: n2, type: 'dialogue', position: { x: 360, y: 300 }, data: { title: '第一条短信 · 16:09', text: '我需要你的帮助,亲爱的塞梅尔维斯 @-‵-,--', speakerId: valId } },
          { id: nR1, type: 'dialogue', position: { x: 680, y: 120 }, data: { title: '回敬一句', text: '堂堂瓦伦缇娜也有做不到的事吗?', speakerId: semId, technicalName: 'reply_mock' } },
          { id: nR2, type: 'dialogue', position: { x: 680, y: 300 }, data: { title: '仅存的回复', text: '……?', speakerId: semId, technicalName: 'reply_dot' } },
          { id: nR3, type: 'hub', position: { x: 680, y: 480 }, data: { title: '装没看见', text: '', technicalName: 'reply_silent' } },
          { id: n4, type: 'dialogue', position: { x: 1000, y: 300 }, data: { title: '第二条短信', text: '很高兴你没把手机扔了。亲爱的,我好像被困在一个讨厌神秘术的盒子里。若死前只能与发霉的空气作伴,只好请求你发挥调查员本能了。帮我出去,价钱随你开,如何?', speakerId: valId } },
          {
            id: n5, type: 'fragment', position: { x: 1320, y: 300 },
            data: {
              title: '谜题 · 时间戳分析',
              text: '双击进入解谜子流程。判断错误不会卡关——但会晚出发。',
              technicalName: 'puzzle_timestamp',
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
          { id: n6, type: 'instruction', position: { x: 1640, y: 180 }, data: { title: '记下地址 · 察觉延迟', text: 'has_address = true; delay_noticed = true' } },
          { id: n6f, type: 'dialogue', position: { x: 1640, y: 460 }, data: { title: '第三条短信 · 迟来的地址', text: '半小时前我确实身在伦敦。那张肇事的软盘应该还在原处(还有我的手提包)。交易所地址是威斯敏斯特区白厅七号——噢我那朋友叫费瑟斯顿霍(Featherstonhaugh)', speakerId: valId } },
          { id: n6c, type: 'instruction', position: { x: 1960, y: 460 }, data: { title: '迟来的出发', text: 'has_address = true; late_start = true; battery -= 10' } },

          /* ---------- ACT 2 · 白厅七号 ---------- */
          { id: n7, type: 'fragment', position: { x: 2280, y: 300 }, data: { title: 'ACT 2 · 白厅七号门厅', text: '维多利亚砖红建筑,没有门牌。戴金属框眼镜的接待员正用两根食指一下一下敲键盘,铭牌上是「菲尔」「比尔」「威尔」之类一眼就会记混的名字。' } },
          { id: c1, type: 'dialogue', position: { x: 2600, y: 120 }, data: { title: '亮明身份', text: '是,我是塞梅尔维斯,今天是来找她的。……签名可真是浪费生命,不过跟 Featherstonhaugh 一比似乎又没那么可悲。', speakerId: semId, technicalName: 'front_honest' } },
          { id: c2, type: 'check', position: { x: 2600, y: 320 }, data: { title: '谎称有预约', text: '「范肖先生半小时前刚约的我,雨天口信慢,您懂的。」', checkExpr: 'cunning', checkDc: 9 } },
          { id: cBluffFail, type: 'dialogue', position: { x: 2920, y: 320 }, data: { title: '接待员推了推镜框', text: '没有预约的话,恐怕……啊,等等,您是塞梅尔维斯小姐?瓦伦缇娜女士吩咐过,要按她的级别接待您。', speakerId: fanId } },
          { id: c3, type: 'check', position: { x: 2600, y: 540 }, data: { title: '趁乱直接上楼', text: '接待员敲键盘的间隙足够长。红检定:只有一次机会,失败会惊动整个门厅。', checkExpr: 'resolve', checkDc: 11, checkRed: true, technicalName: 'sneak_upstairs' } },
          { id: cAlarm, type: 'instruction', position: { x: 2920, y: 540 }, data: { title: '惊动门厅', text: 'alarm = true' } },
          { id: nFan, type: 'fragment', position: { x: 3240, y: 300 }, data: { title: 'ACT 2 · 二楼书房', text: '秃头老绅士在排满书柜的休息室来回踱步,挠着后脑勺仅存的几缕白发。沙发上放着那只手提包,书桌上是五英寸黑色软盘。' } },
          { id: d1, type: 'dialogue', position: { x: 3560, y: 120 }, data: { title: '法律风险告知书', text: '我可以不问软盘的来历。但那次使用机会已经被瓦伦缇娜女士「替你」用掉了——如果您觉得价格不公道,我非常乐意当场拟一份法律风险告知书,以瓦伦缇娜女士的名义。', speakerId: semId, technicalName: 'legal_threat' } },
          { id: d2, type: 'check', position: { x: 3560, y: 320 }, data: { title: '亮证件施压', text: '基金会调查员证件拍在桌上。若刚才惊动过门厅(alarm),他的戒备会让施压更难。', checkExpr: 'resolve - (alarm ? 2 : 0)', checkDc: 9 } },
          { id: d3, type: 'check', position: { x: 3560, y: 540 }, data: { title: '替他着想的说法', text: '「您也不希望瓦伦缇娜女士在这失踪的消息传开吧?配合我,我替您在她面前美言几句。」', checkExpr: 'cunning + 1', checkDc: 10 } },
          { id: dGive, type: 'dialogue', position: { x: 3880, y: 120 }, data: { title: '范肖投降', text: '呃……塞梅尔维斯小姐,只要别让瓦伦缇娜女士投诉,软盘随你处置,现在它是你的了。', speakerId: fanId } },
          { id: dConfess, type: 'dialogue', position: { x: 3880, y: 320 }, data: { title: '范肖全招', text: '软盘是三个月前一位「处理非生物危险品」的中间人抵的账……编号我从没敢查。手提包和软盘您都拿走,拜托了。', speakerId: fanId } },
          { id: dStubborn, type: 'dialogue', position: { x: 3880, y: 540 }, data: { title: '行规在此', text: '这行的要求不能透露供货商情报,请恕我无法说明,塞梅尔维斯小姐。', speakerId: fanId } },
          { id: nGot, type: 'fragment', position: { x: 4200, y: 300 }, data: { title: '软盘与手提包', text: '五英寸黑色软盘,基金会与拉普拉斯的徽记,编号 LSCC-TPT-LDN-ERR。末尾的 ERR,在任何行业都不是个好词。', technicalName: 'got_floppy' } },

          /* ---------- ACT 3 · 出发前的选择 ---------- */
          { id: n8, type: 'fragment', position: { x: 4520, y: 300 }, data: { title: 'ACT 3 · 雨中的选择', text: '大本钟傍晚五点的钟声被雨吞了尾音。距离求救已近一小时。是先走官方流程,还是直接下去?' } },
          { id: e1, type: 'fragment', position: { x: 4840, y: 180 }, data: { title: '致电技术档案室', text: '编号查询:堤岸工程时期的收容室,建在铁路隧道和下水道主管之间的夹层,墙体浇筑时混入抑制神秘术的符文。「如果您确认了具体位置,可以开启通讯器的定位发送功能,我们会派人前往。」', technicalName: 'call_archive' } },
          { id: e2, type: 'hub', position: { x: 4840, y: 440 }, data: { title: '官方流程太慢', text: '', technicalName: 'skip_protocol' } },

          /* ---------- ACT 4 · 地下夹层 ---------- */
          {
            id: nUnder, type: 'fragment', position: { x: 5160, y: 300 },
            data: {
              title: 'ACT 4 · 查令十字 · 维修通道',
              text: '站台最西端的铁门,螺旋台阶,然后是完全的黑暗。双击进入导航子流程。',
              sub: {
                nodes: [
                  { id: u1, type: 'fragment', position: { x: 40, y: 220 }, data: { title: '铁门之后', text: '空气污浊的狭长通道,漂浮的尘埃或许都来自上个世纪。血食怪的夜视在纯黑里也只是扩大虚无——导航靠手、靠耳朵、靠头顶几分钟一次的列车振动。' } },
                  { id: u2, type: 'check', position: { x: 360, y: 220 }, data: { title: '摸墙辨向', text: '右手扶墙,数着振动往南。白检定:走错还能折返重试,但要付出时间(和瓦伦缇娜的电量)。', checkExpr: 'focus', checkDc: 8 } },
                  { id: u3, type: 'hub', position: { x: 360, y: 460 }, data: { title: '死路 · 折返', text: '' } },
                  { id: u4, type: 'condition', position: { x: 680, y: 220 }, data: { title: '她的手机还有电吗?', text: 'battery > 0' } },
                  { id: u5, type: 'dialogue', position: { x: 1000, y: 120 }, data: { title: '一个字的短信', text: '血', speakerId: valId } },
                  { id: u6, type: 'check', position: { x: 1000, y: 360 }, data: { title: '嗅觉搜索', text: '没有短信指引,只能张开鼻腔在裂缝间捕捉那股她认得的气味。白检定,可反复尝试。', checkExpr: 'focus + 2', checkDc: 9 } },
                  { id: u6b, type: 'hub', position: { x: 1000, y: 560 }, data: { title: '只有铁锈味', text: '' } },
                  { id: u7, type: 'fragment', position: { x: 1320, y: 220 }, data: { title: '找到裂缝', text: '列车交会的瞬间,裂缝张开一毫米,血腥味涌进通道——只有淡淡的一抹,若不是对这股血液来源有本能的记忆,她会把它当成铁轨润滑油的金属味忽略掉。', technicalName: 'found_crack' } },
                  { id: u8, type: 'condition', position: { x: 1640, y: 220 }, data: { title: '有支援渠道吗?', text: 'backup_ready == true' } },
                  { id: u9, type: 'instruction', position: { x: 1960, y: 120 }, data: { title: '按下定位发送', text: 'position_sent = true' } },
                  { id: uexit, type: 'exit', position: { x: 2280, y: 220 }, data: { title: '裂缝前就位', text: '' } },
                ],
                edges: [
                  { id: uid(), source: u1, target: u2 },
                  { id: uid(), source: u2, sourceHandle: 'success', target: u4, label: '沿振动最强的方向' },
                  { id: uid(), source: u2, sourceHandle: 'fail', target: u3, label: '拐进承重桩夹缝' },
                  { id: uid(), source: u3, target: u2, label: '折返重来', effect: 'battery -= 15' },
                  { id: uid(), source: u4, sourceHandle: 'true', target: u5 },
                  { id: uid(), source: u4, sourceHandle: 'false', target: u6, label: '屏幕早就黑了' },
                  { id: uid(), source: u5, target: u7, label: '循着那个字面向的方向' },
                  { id: uid(), source: u6, sourceHandle: 'success', target: u7, label: '那抹她认得的血腥味' },
                  { id: uid(), source: u6, sourceHandle: 'fail', target: u6b },
                  { id: uid(), source: u6b, target: u6, label: '换一段墙再闻' },
                  { id: uid(), source: u7, target: u8 },
                  { id: uid(), source: u8, sourceHandle: 'true', target: u9 },
                  { id: uid(), source: u8, sourceHandle: 'false', target: uexit, label: '没有支援渠道' },
                  { id: uid(), source: u9, target: uexit },
                ],
              },
            },
          },

          /* ---------- 整点共振与三种结局 ---------- */
          { id: nChime, type: 'check', position: { x: 5480, y: 300 }, data: { title: '整点共振 · 雾化时机', text: '大本钟报时与双向列车交会叠加,裂缝撑到最宽只有两声钟响。红检定:错过了,窗口不会再来。', checkExpr: 'resolve + semelvie.雾化熟练', checkDc: 12, checkRed: true, technicalName: 'resonance_leap' } },
          { id: nA, type: 'fragment', position: { x: 5800, y: 120 }, data: { title: '雾化穿越', text: '第四声钟声,裂缝张开最宽的瞬间。她化为黑雾——彻底失去重量的一瞬,世界在感知层面上变成另一种质地。第六声钟声结束前,她在墙的另一侧重新凝为实体。' } },
          { id: nB, type: 'fragment', position: { x: 5800, y: 360 }, data: { title: '结局 B · 七日之后', text: '窗口关闭。好在定位已经发出——救援小队按信号点拆墙,用了七天。瓦伦缇娜把新陈代谢降到冰点,像根树枝一样躺着等,出来的第一句话是把晚饭改成了一周的连续赔偿。', technicalName: 'ending_rescue' } },
          { id: nC, type: 'fragment', position: { x: 5800, y: 560 }, data: { title: '结局 C · 薛定谔的血食怪', text: '窗口关闭,而没有任何人知道这里。塞梅尔维斯守在裂缝边,数着一班又一班再也叠不出共振的列车。她终于理解了这个词:在墙被凿开之前,瓦伦缇娜既活着,又不。', technicalName: 'ending_dark' } },
          { id: vA, type: 'dialogue', position: { x: 6120, y: 40 }, data: { title: '黑暗里的笑声 · 记仇版', text: '感谢我的仁慈吧,塞梅尔维斯。顺带一提,「堂堂瓦伦缇娜」那句我可记下了——晚饭的账单会体现的。', speakerId: valId } },
          { id: vB, type: 'dialogue', position: { x: 6120, y: 220 }, data: { title: '黑暗里的笑声', text: '感谢我的仁慈吧,塞梅尔维斯,还想多逗逗你的。我特地挑了个墙缝最大的屋子等你。', speakerId: valId } },
          { id: nNeg, type: 'dialogue', position: { x: 6440, y: 120 }, data: { title: '报酬谈判', text: '我的额外报酬里应该包含一顿晚饭。……现在说的是晚饭的事。你来推荐——不许趁机灌酒,也不能是英国菜。', speakerId: semId } },
          { id: nEndA, type: 'hub', position: { x: 6760, y: 120 }, data: { title: '结局 A · 晚饭:待定', text: '', technicalName: 'ending_dinner' } },
        ],
        edges: [
          /* ACT 0-1 */
          { id: uid(), source: n1, target: n2 },
          { id: uid(), source: n2, target: nR1, label: '回敬一句(她会记住的)', effect: 'battery -= 5' },
          { id: uid(), source: n2, target: nR2, label: '只发一个问号' },
          { id: uid(), source: n2, target: nR3, label: '装没看见', effect: 'battery -= 10' },
          { id: uid(), source: nR1, target: n4, label: '十五分钟后' },
          { id: uid(), source: nR2, target: n4, label: '十五分钟后' },
          { id: uid(), source: nR3, target: n4, label: '半小时后,手机还是震了' },
          { id: uid(), source: n4, target: n5 },
          { id: uid(), source: n5, sourceHandle: `exit:${s3}`, target: n6, label: '屏蔽确认 → 目标:白厅七号' },
          { id: uid(), source: n5, target: n6f, label: '误判 · 先回家躺平' },
          { id: uid(), source: n6, target: n7 },
          { id: uid(), source: n6f, target: n6c },
          { id: uid(), source: n6c, target: n7 },
          /* ACT 2 · 门厅 */
          { id: uid(), source: n7, target: c1, label: '亮明身份,签访客簿' },
          { id: uid(), source: n7, target: c2, label: '谎称与范肖有约(白检定)' },
          { id: uid(), source: n7, target: c3, label: '趁乱直接上楼(红检定)' },
          { id: uid(), source: c1, target: nFan },
          { id: uid(), source: c2, sourceHandle: 'success', target: nFan, label: '他放行了' },
          { id: uid(), source: c2, sourceHandle: 'fail', target: cBluffFail, label: '被识破' },
          { id: uid(), source: cBluffFail, target: c1, label: '只得亮明身份' },
          { id: uid(), source: c3, sourceHandle: 'success', target: nFan, label: '悄无声息' },
          { id: uid(), source: c3, sourceHandle: 'fail', target: cAlarm, label: '「女士?!那边不能——」' },
          { id: uid(), source: cAlarm, target: nFan, label: '带着一楼的骚动上楼' },
          /* ACT 2 · 书房谈判 */
          { id: uid(), source: nFan, target: d1, label: '以瓦伦缇娜的名义拟告知书' },
          { id: uid(), source: nFan, target: d2, label: '亮证件施压(白检定)' },
          { id: uid(), source: nFan, target: d3, label: '替他着想的说法(白检定)' },
          { id: uid(), source: d1, target: dGive },
          { id: uid(), source: dGive, target: nGot, effect: 'has_floppy = true' },
          { id: uid(), source: d2, sourceHandle: 'success', target: dConfess, label: '他招了' },
          { id: uid(), source: d2, sourceHandle: 'fail', target: dStubborn },
          { id: uid(), source: d3, sourceHandle: 'success', target: dConfess, label: '他软下来了' },
          { id: uid(), source: d3, sourceHandle: 'fail', target: dStubborn },
          { id: uid(), source: dStubborn, target: d1, label: '换个说法' },
          { id: uid(), source: dConfess, target: nGot, effect: 'has_floppy = true; got_intel = true' },
          { id: uid(), source: nGot, target: n8 },
          /* ACT 3 */
          { id: uid(), source: n8, target: e1, label: '先打给技术档案室' },
          { id: uid(), source: n8, target: e2, label: '不等官方流程,直接下去' },
          { id: uid(), source: e1, target: nUnder, effect: 'backup_ready = true' },
          { id: uid(), source: e2, target: nUnder },
          /* ACT 4 → 结局 */
          { id: uid(), source: nUnder, sourceHandle: `exit:${uexit}`, target: nChime, label: '等下一个整点' },
          { id: uid(), source: nChime, sourceHandle: 'success', target: nA, label: '第四声钟声,现在!' },
          { id: uid(), source: nChime, sourceHandle: 'fail', target: nB, condition: 'position_sent == true', label: '错过了——但救援知道位置' },
          { id: uid(), source: nChime, sourceHandle: 'fail', target: nC, fallback: true, label: '错过了,而且没人知道这里' },
          { id: uid(), source: nA, target: vA, condition: 'seen("reply_mock")' },
          { id: uid(), source: nA, target: vB, fallback: true },
          { id: uid(), source: vA, target: nNeg },
          { id: uid(), source: vB, target: nNeg },
          { id: uid(), source: nNeg, target: nEndA },
        ],
      },
    ],
    entities: [
      {
        id: semId, kind: 'character', name: '塞梅尔维斯', color: '#1b1b19', emoji: '',
        technicalName: 'semelvie',
        summary: '基金会高级调查员,血食者。极度自律的理性外壳,以及被高级甜点和某人惯坏的品味内芯。今天放假——放到一半。',
        fields: [
          { id: uid(), label: '能力', value: '夜视、雾化(需要缝隙与时机)、犬齿' },
          { id: uid(), label: '雾化熟练', value: '2' },
          { id: uid(), label: '职业病', value: '用查案逻辑分析感情问题,随时准备写投诉信' },
          { id: uid(), label: '当前状态', value: '休假中(被迫结束)' },
          { id: uid(), label: '关于那部手机', value: '只是觉得它重量尚可。绝对不是在等谁的短信。' },
          { id: uid(), label: '所属', value: foundationId, type: 'entity', filterKind: 'faction' },
          { id: uid(), label: '搭档', value: valId, type: 'entity', filterKind: 'character' },
        ],
        notes: '脚本寻址示例:红检定「整点共振」的技能表达式是 resolve + semelvie.雾化熟练——实体字段可以直接被脚本读取。', createdAt: Date.now(),
      },
      {
        id: valId, kind: 'character', name: '瓦伦缇娜', color: '#3a3936', emoji: '',
        technicalName: 'valentine',
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
          { id: uid(), label: '弱点', value: '血食怪圈子的差评比基金会的传票可怕得多' },
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
        summary: '站台最西端一扇维修铁门,螺旋台阶通向堤岸工程时期的原始夹层。没有砖缝,一体浇筑。',
        fields: [
          { id: uid(), label: '规则', value: '墙内符文干扰,不可使用神秘术;导航靠振动与水声' },
        ],
        notes: '', createdAt: Date.now(),
      },
      {
        id: containId, kind: 'location', name: '堤岸夹层收容室', color: '#3a3936', emoji: '',
        technicalName: 'containment_vault',
        summary: '维多利亚堤岸填河造陆时建在铁路隧道与下水道主管之间的收容设施,原始图纸毁于二战轰炸。设计上专门存放需要单独隔离的神秘学物品——不含活人,也不含血食怪。',
        fields: [
          { id: uid(), label: '弱点', value: '朱比利延长线施工的振动让部分墙体出现裂缝;整点钟声 + 双向列车交会 = 共振窗口' },
        ],
        notes: '', createdAt: Date.now(),
      },
      {
        id: phoneId, kind: 'item', name: '德制直板手机', color: '#aaa9a1', emoji: '',
        summary: '通讯录里只有一个联系人。持有者坚称留着它是因为重量尚可,且德国电路的严谨设计适合记备忘录。绝对不是在等某人发来什么。绝对不是。',
        fields: [
          { id: uid(), label: '屏幕', value: '复古像素绿,黑暗里唯一的光源' },
          { id: uid(), label: '持有者', value: semId, type: 'entity', filterKind: 'character' },
        ],
        notes: '', createdAt: Date.now(),
      },
      {
        id: floppyId, kind: 'item', name: '传送软盘 LSCC-TPT-LDN-ERR', color: '#565550', emoji: '',
        technicalName: 'floppy_err',
        summary: '五英寸黑色软盘,基金会与拉普拉斯的徽记。设计用途:运送需要单独隔离的非生物神秘学物品。一次性,已损耗。末尾的 ERR 代表「错误」——在任何行业都不是个好词。',
        fields: [
          { id: uid(), label: '异常点', value: '徒手接触即触发生命体传送——除非被传送者「从各种意义上都不算活着」' },
        ],
        notes: '', createdAt: Date.now(),
      },
      {
        id: foundationId, kind: 'faction', name: '基金会', color: '#565550', emoji: '',
        summary: '管理神秘事件的组织,视夜行种为稀缺人力。塞的雇主,同时也是她投诉信的常年收件人。',
        fields: [
          { id: uid(), label: '风格', value: '公文腔:签 24 小时待命的不平等条约,却给员工发怪味巧克力' },
        ],
        notes: '', createdAt: Date.now(),
      },
    ],
    entityTemplates: {
      character: [
        '欲望',
        '恐惧',
        { label: '所属', type: 'entity', filterKind: 'faction' },
      ],
    },
    brainstormNotes: [
      { id: uid(), text: '核心反差:救援任务 × 被迫结束的假期', color: '#ffffff', position: { x: 120, y: 80 } },
      { id: uid(), text: '手机是两条线之间唯一的通道——短信界面全部用复古像素绿', color: '#e6e4df', position: { x: 430, y: 40 } },
      { id: uid(), text: '瓦伦缇娜的求救也要保持体面:标价、比喻、落款的小鱼', color: '#d8d6d0', position: { x: 430, y: 220 } },
      { id: uid(), text: '结局不写拥抱,写晚饭谈判', color: '#f2f1ee', position: { x: 120, y: 260 } },
      { id: uid(), text: '失败分支也是内容:B 结局要有 B 结局的尊严', color: '#ffffff', position: { x: 740, y: 40 } },
      { id: uid(), text: '红检定只用在「叙事上真的不可重来」的地方:闯门厅、共振窗口', color: '#e6e4df', position: { x: 740, y: 200 } },
    ],
    brainstormEdges: [],
    outlineColumns: [],
    outlineRows: [],
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
        entityIds: [valId, floppyId],
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
        title: '白厅七号讯问', text: '三条路:告知书、施压、软话。检定失败也拿得到软盘——只是拿不到来历。',
        entityIds: [semId, fanId, floppyId],
      },
      {
        id: uid(), trackId: trackSem, pointId: ptChime,
        title: '第四声钟声', text: '双向列车交会,裂缝最宽的瞬间,雾化穿越。红检定:错过即三种结局分流。',
        entityIds: [semId, containId],
      },
      {
        id: uid(), trackId: trackVal, pointId: ptChime,
        title: '挑了个墙缝最大的屋子', text: '「感谢我的仁慈吧,还想多逗逗你的。」',
        entityIds: [valId],
      },
    ],
    maps: [
      {
        id: uid(),
        name: '威斯敏斯特 · 雨夜',
        image: 'data:image/svg+xml;utf8,' + encodeURIComponent(MAP_SVG),
        imageWidth: 1000,
        imageHeight: 750,
        markers: [
          { id: uid(), x: 0.347, y: 0.205, label: '基金会总部', entityId: foundationId, color: '#1b1b19' },
          { id: uid(), x: 0.428, y: 0.235, label: '咖啡馆遮阳篷 · 16:09', color: '#b08a4f' },
          { id: uid(), x: 0.399, y: 0.509, label: '白厅七号', entityId: whitehallId },
          { id: uid(), x: 0.47, y: 0.8, label: '威斯敏斯特站', color: '#565550' },
          { id: uid(), x: 0.449, y: 0.816, label: '大本钟', color: '#6b5b45' },
          { id: uid(), x: 0.64, y: 0.253, label: '查令十字站 · 维修铁门', entityId: tunnelId },
          { id: uid(), x: 0.588, y: 0.545, label: '瓦伦缇娜 · 受困点', entityId: valId, color: '#8c2f2f', fromPointId: ptBefore },
        ],
        regions: [
          {
            id: uid(),
            label: '堤岸夹层 · 收容区',
            entityId: containId,
            color: '#8c2f2f',
            points: [
              { x: 0.48, y: 0.858 }, { x: 0.512, y: 0.742 }, { x: 0.548, y: 0.64 },
              { x: 0.594, y: 0.532 }, { x: 0.644, y: 0.442 }, { x: 0.688, y: 0.386 },
              { x: 0.712, y: 0.412 }, { x: 0.668, y: 0.472 }, { x: 0.622, y: 0.556 },
              { x: 0.578, y: 0.652 }, { x: 0.545, y: 0.752 }, { x: 0.516, y: 0.878 },
            ],
          },
        ],
      },
    ],
    researchCards: [
      {
        id: uid(), title: '血食者的能力边界',
        content: '夜视、雾化、犬齿。雾化需要缝隙与时机,并非随时可用;神秘术抑制符文环境下全部失效。这是收容室谜题成立的前提——她不能靠超自然能力走捷径,只能靠调查员的办法。',
        category: '世界观', tags: ['核心设定'], color: '#1b1b19', source: '', pinned: true, createdAt: Date.now(),
      },
      {
        id: uid(), title: '白检定与红检定的分工',
        content: '白检定 = 可重试,失败的代价是资源(时间、电量);红检定 = 仅一次,失败即锁定结果,直接改变叙事走向。设计准则:红检定只用在「叙事上真的不可重来」的节点——闯门厅、整点共振。玩家要能在检定前从文案里读出这是哪一种。',
        category: '谜题设计', tags: ['检定', '核心设定'], color: '#3a3936', source: '', pinned: true, createdAt: Date.now(),
      },
      {
        id: uid(), title: '失败分支的成本设计',
        content: '本 DEMO 的失败树:谎称预约失败 → 绕回亮明身份(损失面子);施压失败 → 行规顿挫 → 换法律告知书(损失情报 got_intel);共振失败 → 若发过定位则 B 结局(损失七天),否则 C 结局(损失一切)。原则:早期选择(是否联系档案室)决定晚期失败的兜底——用 fallback 边实现。',
        category: '谜题设计', tags: ['分支', '结局'], color: '#565550', source: '', pinned: false, createdAt: Date.now(),
      },
      {
        id: uid(), title: '收容室与共振窗口',
        content: '维多利亚堤岸工程时期建造,位于铁路隧道与下水道之间的夹层,一体浇筑、混入抑制符文。大本钟整点报时与双向列车交会的叠加共振,能把约两毫米的裂缝撑到雾化可通过的宽度,窗口期约两声钟响。对应红检定 resonance_leap,技能表达式演示实体属性寻址:resolve + semelvie.雾化熟练。',
        category: '谜题设计', tags: ['解谜', 'ACT4'], color: '#3a3936', source: '', pinned: false, createdAt: Date.now(),
      },
      {
        id: uid(), title: '时间戳谜题的公平性',
        content: '玩家可见信息:两条短信的发送/接收时间、一次失败的拨号。三条推断全部由已展示信息导出,不依赖设定外知识。解谜游戏的底线是别让玩家猜作者在想什么。判断错误不卡关:第三条短信会把地址直接给出,代价是 late_start 与电量。',
        category: '谜题设计', tags: ['解谜', 'ACT1'], color: '#72716b', source: '', pinned: false, createdAt: Date.now(),
      },
      {
        id: uid(), title: 'Featherstonhaugh 读作 Fanshaw',
        content: '英国姓氏的拼写与发音是两套独立运行的系统。本作把它用作一道不计分的谜题,以及一次让主角表情像吃到怪味巧克力的机会。',
        category: '世界观', tags: ['考据'], color: '#8e8d86', source: '', pinned: false, createdAt: Date.now(),
      },
      {
        id: uid(), title: '美术与音效基调',
        content: '深色调像素:维多利亚砖红、地铁橙黄、荧光绿短信屏。地下通道段落取消配乐,只保留水声、列车与心跳;共振段落让大本钟自己当节拍器。地图底图用同一套灰调 + 砖红点缀(见配色表「雨夜伦敦」)。',
        category: '美术与音效', tags: ['美术'], color: '#aaa9a1', source: '', pinned: false, createdAt: Date.now(),
      },
    ],
    researchCategories: ['世界观', '谜题设计', '美术与音效'],
    variables: [
      { id: uid(), name: 'signal_blocked', type: 'boolean', value: 'true', description: '短信能到、电话不通——存在物理或神秘术屏蔽' },
      { id: uid(), name: 'has_address', type: 'boolean', value: 'false', description: '是否已取得白厅七号的地址' },
      { id: uid(), name: 'delay_noticed', type: 'boolean', value: 'false', description: '玩家是否自己推理出了短信延迟异常' },
      { id: uid(), name: 'late_start', type: 'boolean', value: 'false', description: '误判时间戳谜题,晚出发' },
      { id: uid(), name: 'alarm', type: 'boolean', value: 'false', description: '闯楼失败惊动门厅,范肖谈判难度 +2' },
      { id: uid(), name: 'has_floppy', type: 'boolean', value: 'false', description: '取得传送软盘' },
      { id: uid(), name: 'got_intel', type: 'boolean', value: 'false', description: '范肖交代了软盘来历(检定成功才有)' },
      { id: uid(), name: 'backup_ready', type: 'boolean', value: 'false', description: '联系过技术档案室,可发送定位召唤救援' },
      { id: uid(), name: 'position_sent', type: 'boolean', value: 'false', description: '已发送定位——决定共振失败后走 B 还是 C 结局' },
      { id: uid(), name: 'battery', type: 'number', value: '40', description: '瓦伦缇娜手机剩余电量(%),各处选择会消耗它' },
      { id: uid(), name: 'cunning', type: 'number', value: '2', description: '检定属性 · 话术' },
      { id: uid(), name: 'focus', type: 'number', value: '3', description: '检定属性 · 感知与专注' },
      { id: uid(), name: 'resolve', type: 'number', value: '2', description: '检定属性 · 胆量与意志' },
      { id: uid(), name: 'chocolate_rating', type: 'number', value: '-3', description: '后勤部巧克力的可食用评分(满分 5)' },
    ],
    assets: [],
    documents: [
      {
        id: uid(),
        name: 'ACT 1 · 雨中短信草稿',
        technicalName: 'act1_draft',
        category: '剧本草稿',
        notes: '先把对白按剧本块写顺,再「转为流程」生成节点图。块类型左到右对应流程节点;选项块转出的分支引脚在流程编辑器里继续补画。',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        blocks: [
          { id: uid(), type: 'heading', text: '遮阳篷下 · 16:09' },
          { id: uid(), type: 'action', text: '雨打在遮阳篷上,塞梅尔维斯把新发的通讯器塞回口袋,从外套内衬掏出那部德制直板手机。' },
          { id: uid(), type: 'dialogue', speakerId: valId, text: '我需要你的帮助,亲爱的塞梅尔维斯 @-‵-,--' },
          { id: uid(), type: 'choice', text: '如何回复?', choices: [
            { id: uid(), label: '回敬一句(她会记住的)' },
            { id: uid(), label: '只发一个问号' },
            { id: uid(), label: '装没看见' },
          ] },
          { id: uid(), type: 'dialogue', speakerId: valId, text: '很高兴你没把手机扔了。亲爱的,我好像被困在一个讨厌神秘术的盒子里。帮我出去,价钱随你开,如何?' },
          { id: uid(), type: 'condition', condition: 'signal_blocked == true', text: '' },
          { id: uid(), type: 'instruction', instruction: 'has_address = true; delay_noticed = true', text: '' },
          { id: uid(), type: 'note', text: '流程版在 condition 处分出「误判 · 先回家躺平」支线:第三条短信补发地址,代价 late_start 与电量。' },
        ],
      },
    ],
    documentCategories: ['剧本草稿', '设计文档'],
    attachments: {},
    folders: [],
    nodeTemplates: {},
    palettes: [
      {
        id: paletteId,
        name: '雨夜伦敦',
        colors: ['#10151f', '#233246', '#5a3b32', '#8c2f2f', '#b08a4f', '#7b8d94', '#c9c5ba', '#e6e2d8'],
      },
    ],
    activePaletteId: paletteId,
    updatedAt: Date.now(),
  };
}
