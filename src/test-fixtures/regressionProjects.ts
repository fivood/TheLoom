import type { Project } from '../types';

function emptyProject(name: string): Project {
  return {
    version: 1,
    name,
    flows: [],
    entities: [],
    brainstormNotes: [],
    brainstormEdges: [],
    outlineColumns: [],
    outlineRows: [],
    timelineTracks: [],
    timelinePoints: [],
    timelineEvents: [],
    maps: [],
    researchCards: [],
    researchCategories: [],
    variables: [],
    assets: [],
    documents: [],
    documentCategories: [],
    attachments: {},
    folders: [],
    units: [],
    annotations: [],
    docSnapshots: [],
    relations: [],
    arcs: [],
    foreshadows: [],
    palettes: [],
    savedQueries: [],
    updatedAt: 1_700_000_000_000,
  };
}

export function longNovelRegressionProject(): Project {
  const project = emptyProject('长篇回归样例');
  project.folders = [
    { id: 'folder-volume-1', module: 'document', name: '第一卷', parentId: null, order: 0 },
    { id: 'folder-chapter-1', module: 'document', name: '第一章 雾站', parentId: 'folder-volume-1', order: 0 },
    { id: 'folder-chapter-2', module: 'document', name: '第二章 回声', parentId: 'folder-volume-1', order: 1 },
    { id: 'folder-characters', module: 'entity', name: '主要角色', parentId: null, order: 0 },
    { id: 'folder-research', module: 'research', name: '城市考据', parentId: null, order: 0 },
  ];
  project.folders[0].documentRole = 'volume';
  project.folders[1].documentRole = 'chapter';
  project.folders[2].documentRole = 'chapter';
  project.entities = [
    {
      id: 'entity-lin', folderId: 'folder-characters', order: 0, kind: 'character', name: '林默',
      technicalName: 'lin_mo', aliases: ['阿默'], color: '#333333', emoji: '林', summary: '调查记者',
      fields: [{ id: 'field-lin-goal', label: '目标', value: '找到失踪的姐姐' }], notes: '', createdAt: 1,
    },
    {
      id: 'entity-qiao', folderId: 'folder-characters', order: 1, kind: 'character', name: '乔夏',
      technicalName: 'qiao_xia', color: '#555555', emoji: '乔', summary: '车站值班员', fields: [], notes: '', createdAt: 2,
    },
    {
      id: 'entity-station', kind: 'location', name: '白榆站', technicalName: 'baiyu_station',
      color: '#777777', emoji: '站', summary: '停用多年的山间车站', fields: [], notes: '', createdAt: 3,
    },
  ];
  project.units = [{
    id: 'unit-station-line', kind: 'line', title: '', text: '末班车三年前就停了。',
    speakerId: 'entity-qiao', createdAt: 10, updatedAt: 10,
  }];
  project.documents = [
    {
      id: 'doc-platform', folderId: 'folder-chapter-1', order: 0, name: '空站台', technicalName: 'v1c1_platform',
      category: '正文', notes: '建立失踪案与车站的联系', status: 'done', wordTarget: 1800,
      povId: 'entity-lin', locationId: 'entity-station', timeLabel: '第 1 日 · 21:10', tension: 2, revision: 2,
      blocks: [
        { id: 'block-platform-1', type: 'paragraph', flowRole: 'none', text: '雾从铁轨尽头漫上来，吞掉了白榆站的旧钟。' },
        { id: 'block-platform-2', type: 'dialogue', unitId: 'unit-station-line', speakerId: 'entity-qiao', text: '末班车三年前就停了。' },
      ],
      createdAt: 10, updatedAt: 20,
    },
    {
      id: 'doc-locker', folderId: 'folder-chapter-1', order: 1, name: '寄存柜', technicalName: 'v1c1_locker',
      category: '正文', notes: '', status: 'revising', wordTarget: 2200, povId: 'entity-lin',
      locationId: 'entity-station', timeLabel: '第 1 日 · 22:00', tension: 4, revision: 2,
      blocks: [{ id: 'block-locker-1', type: 'paragraph', flowRole: 'none', text: '第七码盘后藏着一张被水泡皱的车票。' }],
      createdAt: 11, updatedAt: 21,
    },
    {
      id: 'doc-tunnel', folderId: 'folder-chapter-2', order: 0, name: '隧道回声', technicalName: 'v1c2_tunnel',
      category: '正文', notes: '', status: 'draft', wordTarget: 2400, povId: 'entity-lin',
      locationId: 'entity-station', timeLabel: '第 2 日 · 凌晨', tension: 5, revision: 1,
      blocks: [{ id: 'block-tunnel-1', type: 'paragraph', flowRole: 'none', text: '回声比脚步多了一次。' }],
      createdAt: 12, updatedAt: 22,
    },
  ];
  project.documentCategories = ['正文'];
  project.outlineColumns = [{ id: 'outline-clue', title: '失踪线', color: '#444444' }];
  project.outlineRows = [
    { id: 'outline-chapter-1', no: '1', time: '第 1 日', title: '雾站', main: '林默进入白榆站', cells: { 'outline-clue': '发现旧车票' } },
    { id: 'outline-chapter-2', no: '2', time: '第 2 日', title: '回声', main: '追入封闭隧道', cells: { 'outline-clue': '回声暴露同行者' } },
  ];
  project.outlineRows[0].chapterFolderId = 'folder-chapter-1';
  project.outlineRows[1].documentId = 'doc-tunnel';
  project.timelineTracks = [{ id: 'track-main', name: '主线', color: '#444444' }];
  project.timelinePoints = [
    { id: 'point-night-1', label: '第 1 日夜' },
    { id: 'point-dawn-2', label: '第 2 日凌晨' },
  ];
  project.timelineEvents = [
    { id: 'event-ticket', trackId: 'track-main', pointId: 'point-night-1', title: '发现旧车票', text: '', entityIds: ['entity-lin'] },
    { id: 'event-echo', trackId: 'track-main', pointId: 'point-dawn-2', title: '进入封闭隧道', text: '', entityIds: ['entity-lin', 'entity-qiao'] },
  ];
  project.timelineEvents[0].documentIds = ['doc-locker'];
  project.timelineEvents[1].documentIds = ['doc-tunnel'];
  project.researchCards = [{
    id: 'research-station', folderId: 'folder-research', order: 0, title: '山区支线停运记录', content: '用于核对停运年份。',
    category: '考据', tags: ['铁路'], color: '#888888', source: '地方志', pinned: true, createdAt: 30,
  }];
  project.researchCategories = ['考据'];
  project.relations = [{ id: 'relation-lin-qiao', fromId: 'entity-lin', toId: 'entity-qiao', label: '互相试探' }];
  project.arcs = [
    { id: 'arc-lin-1', entityId: 'entity-lin', title: '拒绝求助', note: '', docId: 'doc-platform', order: 0 },
    { id: 'arc-lin-2', entityId: 'entity-lin', title: '接受同行', note: '', docId: 'doc-tunnel', order: 1 },
  ];
  project.foreshadows = [{
    id: 'foreshadow-ticket', title: '第七码盘', note: '车票编号对应隧道岔口',
    plants: [{ id: 'plant-ticket', docId: 'doc-locker', note: '发现车票' }],
    payoffs: [{ id: 'payoff-ticket', docId: 'doc-tunnel', note: '按编号找到岔口' }],
    createdAt: 40,
  }];
  project.annotations = [{
    id: 'annotation-locker', docId: 'doc-locker', blockId: 'block-locker-1', text: '补充触觉细节', createdAt: 50,
  }];
  project.docSnapshots = [{
    id: 'snapshot-platform', docId: 'doc-platform', label: '第二稿', revision: 2,
    blocks: structuredClone(project.documents[0].blocks), createdAt: 60,
  }];
  return project;
}

export function puzzleGameRegressionProject(): Project {
  const project = emptyProject('互动解谜回归样例');
  project.entities = [
    {
      id: 'entity-player', kind: 'character', name: '调查员', technicalName: 'investigator',
      color: '#333333', emoji: '调', summary: '', fields: [{ id: 'field-sense', label: 'sense', value: '2' }], notes: '', createdAt: 1,
    },
    {
      id: 'entity-house', kind: 'location', name: '回声宅邸', technicalName: 'echo_manor',
      color: '#666666', emoji: '宅', summary: '', fields: [], notes: '', createdAt: 2,
    },
  ];
  project.variables = [
    { id: 'variable-clues', name: 'clues', type: 'number', value: '0', description: '已发现线索数' },
    { id: 'variable-key', name: 'has_key', type: 'boolean', value: 'false', description: '是否拿到铜钥匙' },
  ];
  project.assets = [{
    id: 'asset-rain', name: '门厅雨声', kind: 'audio', mime: 'audio/ogg', size: 128,
    tags: ['环境音'], source: '自制', license: '自有版权', notes: '', technicalName: 'sfx_hall_rain',
    hash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', ext: 'ogg', createdAt: 3,
  }];
  project.units = [
    { id: 'unit-start', kind: 'line', title: '抵达宅邸', text: '门在身后自行合拢。', speakerId: 'entity-player', createdAt: 10, updatedAt: 10 },
    {
      id: 'unit-choice', kind: 'choice', title: '', text: '如何行动？',
      choices: [{ id: 'choice-search', label: '搜查书房' }, { id: 'choice-leave', label: '离开宅邸' }],
      createdAt: 11, updatedAt: 11,
    },
    { id: 'unit-search', kind: 'scene', title: '书房机关', text: '双层书架后藏着铜钥匙。', createdAt: 12, updatedAt: 12 },
    { id: 'unit-clue', kind: 'instruction', title: '', text: 'clues += 1; has_key = true', createdAt: 13, updatedAt: 13 },
    { id: 'unit-success', kind: 'line', title: '暗门开启', text: '钥匙转动，墙后的风吹灭了灯。', createdAt: 14, updatedAt: 14 },
    { id: 'unit-fail', kind: 'line', title: '机关反噬', text: '错误的齿轮咬住了锁芯。', createdAt: 15, updatedAt: 15 },
    { id: 'unit-leave', kind: 'line', title: '暂时撤退', text: '调查员记下门牌，退回雨里。', createdAt: 16, updatedAt: 16 },
  ];
  project.flows = [{
    id: 'flow-manor', name: '宅邸序章', technicalName: 'manor_intro', documentId: 'doc-manor-script',
    nodes: [
      {
        id: 'node-start', type: 'dialogue', position: { x: 0, y: 0 },
        data: { title: '抵达宅邸', text: '门在身后自行合拢。', speakerId: 'entity-player', technicalName: 'arrive_manor', unitId: 'unit-start' },
      },
      {
        id: 'node-choice', type: 'hub', position: { x: 260, y: 0 },
        data: { title: '如何行动？', text: '', technicalName: 'first_choice', unitId: 'unit-choice' },
      },
      {
        id: 'node-search', type: 'fragment', position: { x: 520, y: -100 },
        data: {
          title: '书房机关', text: '双层书架后藏着铜钥匙。', technicalName: 'study_puzzle', unitId: 'unit-search',
          sub: {
            nodes: [
              {
                id: 'node-clue', type: 'instruction', position: { x: 0, y: 0 },
                data: { title: '取得钥匙', text: 'clues += 1; has_key = true', technicalName: 'take_brass_key', unitId: 'unit-clue' },
              },
              { id: 'node-search-exit', type: 'exit', position: { x: 260, y: 0 }, data: { title: '完成搜查', text: '', technicalName: 'finish_search' } },
            ],
            edges: [{ id: 'edge-clue-exit', source: 'node-clue', target: 'node-search-exit' }],
          },
        },
      },
      {
        id: 'node-check', type: 'check', position: { x: 780, y: -100 },
        data: { title: '开启暗门', text: '', technicalName: 'unlock_hidden_door', checkExpr: 'clues', checkDc: 1, checkRed: true },
      },
      {
        id: 'node-success', type: 'dialogue', position: { x: 1040, y: -180 },
        data: { title: '暗门开启', text: '钥匙转动，墙后的风吹灭了灯。', technicalName: 'ending_open', unitId: 'unit-success' },
      },
      {
        id: 'node-fail', type: 'dialogue', position: { x: 1040, y: 0 },
        data: { title: '机关反噬', text: '错误的齿轮咬住了锁芯。', technicalName: 'ending_lock', unitId: 'unit-fail' },
      },
      {
        id: 'node-leave', type: 'dialogue', position: { x: 520, y: 140 },
        data: { title: '暂时撤退', text: '调查员记下门牌，退回雨里。', technicalName: 'ending_leave', unitId: 'unit-leave' },
      },
    ],
    edges: [
      { id: 'edge-start-choice', source: 'node-start', target: 'node-choice' },
      { id: 'edge-choice-search', source: 'node-choice', target: 'node-search', label: '搜查书房', choiceId: 'choice-search' },
      { id: 'edge-choice-leave', source: 'node-choice', target: 'node-leave', label: '离开宅邸', choiceId: 'choice-leave' },
      { id: 'edge-search-check', source: 'node-search', sourceHandle: 'exit:node-search-exit', target: 'node-check' },
      { id: 'edge-check-success', source: 'node-check', sourceHandle: 'success', target: 'node-success' },
      { id: 'edge-check-fail', source: 'node-check', sourceHandle: 'fail', target: 'node-fail' },
    ],
  }];
  project.documents = [{
    id: 'doc-manor-script', name: '宅邸序章剧本', linkedFlowId: 'flow-manor', technicalName: 'manor_intro_script',
    category: '互动剧本', notes: '', status: 'done',
    blocks: [{
      id: 'block-choice', type: 'choice', unitId: 'unit-choice', text: '如何行动？',
      choices: [{ id: 'choice-search', label: '搜查书房' }, { id: 'choice-leave', label: '离开宅邸' }],
    }],
    createdAt: 20, updatedAt: 20,
  }];
  project.documentCategories = ['互动剧本'];
  project.attachments = { 'node-start': ['asset-rain'] };
  return project;
}

export function legacyRegressionProject(): Project {
  return {
    version: 1,
    name: 'v0.9 升级回归样例',
    flows: [{
      id: 'legacy-flow', name: '旧流程', nodes: [{
        id: 'legacy-node', type: 'dialogue', position: { x: 10, y: 20 },
        data: { title: '旧对白', text: '不要忘记我。', speakerId: 'legacy-entity', technicalName: 'legacy_line' },
      }], edges: [],
    }],
    entities: [{
      id: 'legacy-entity', kind: 'character', name: '旧角色', color: '#333333', emoji: '', summary: '',
      fields: [{ id: 'legacy-field', label: '动机', value: '守住旧车站' }], notes: '', technicalName: 'legacy_character', createdAt: 1,
    }],
    documents: [{
      id: 'legacy-document', name: '旧场景', category: '正文', notes: '',
      blocks: [{ id: 'legacy-block', type: 'dialogue', text: '不要忘记我。', speakerId: 'legacy-entity' }],
      createdAt: 2, updatedAt: 3,
    }],
    variables: [{ id: 'legacy-variable', name: 'remembered', type: 'boolean', value: 'false', description: '' }],
    entityTemplates: { character: ['动机', '秘密'] },
    updatedAt: 4,
  } as unknown as Project;
}
