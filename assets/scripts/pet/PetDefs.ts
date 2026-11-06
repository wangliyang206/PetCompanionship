/**
 * 宠物静态定义表（25 只五虫 + 4 只混世四猴）
 * MVP 只实装毛虫系 3 只，其余 22 只定义占位（资源路径留空）。
 * 每系 5 只 = 普通×2、稀有×1、史诗×1、传说×1。
 * 毛虫系 MVP 3 只：团团=普通、长风=稀有、阿绒=史诗。
 */

import { Xi, Rarity, Stage } from '../core/Enums';
import { PetDefStatic, PetLines } from '../core/SaveData';

/** 辅助函数：生成资源路径（Creator 为每个模型生成同名的 Prefab 子资源，路径含同名子目录） */
const M = (stage: Stage, id: string): string => `resources/models/${id}/${id}_${stage}/${id}_${stage}.glb`;
/** 缺少美术资源的物种：阶段模型先用团团占位（B1：其余两只有什么导什么，缺失用团团模型占位） */
const M_FALLBACK = (stage: Stage): string => M(stage, 'mao_tuantuan');
const A = (arr: string[]): string[] => arr;

export const PetDefs: Record<string, PetDefStatic> = {
  // ============ 毛虫系（phase1 3 只 + phase2 2 只） ============
  mao_tuantuan: {
    id: 'mao_tuantuan', xi: Xi.Mao, name: '团团', rarity: Rarity.Common,
    phase: 1, unlockLayer: 1, themeColor: '#D9A066', signature: 'signature_roll',
    models: {
      [Stage.Egg]: M(Stage.Egg, 'mao_tuantuan'),
      [Stage.Baby]: M(Stage.Baby, 'mao_tuantuan'),
      [Stage.Adult]: M(Stage.Adult, 'mao_tuantuan'),
      [Stage.Final]: M(Stage.Final, 'mao_tuantuan'),
    },
    anims: {
      [Stage.Egg]: ['egg_breathe', 'egg_sway'],
      [Stage.Baby]: ['idle', 'happy', 'sad', 'pet', 'feed'],
      [Stage.Adult]: ['idle', 'happy', 'sad', 'pet', 'feed', 'play', 'explore_ready'],
      [Stage.Final]: ['idle', 'happy', 'sad', 'pet', 'feed', 'play', 'explore_ready', 'signature_roll'],
    },
    lines: {
      happy: ['嘿嘿嘿~', '好舒服哦~', '最喜欢你了！'],
      sad: ['呜……别不理团团嘛……', '蹲在这里等……', '我……我没捣乱的……'],
      away: ['你去哪儿了呀，我一直蹲在这里等你……', '呜……你终于回来了……', '我把小饼干都留到过期了呜。'],
      feed: ['好吃~ 再来一口！', '唔唔唔，是小鱼干！', '团团最爱这个啦！'],
      pet: ['眯眼呼噜……', '脑袋蹭蹭~', '爪子扒住你的手不让走~'],
    },
  },

  mao_changfeng: {
    id: 'mao_changfeng', xi: Xi.Mao, name: '长风', rarity: Rarity.Rare,
    phase: 1, unlockLayer: 1, themeColor: '#8FB8C9', signature: 'signature_leap',
    models: { // TODO(美术)：长风模型未产出，四阶段暂用团团占位
      [Stage.Egg]: M_FALLBACK(Stage.Egg),
      [Stage.Baby]: M_FALLBACK(Stage.Baby),
      [Stage.Adult]: M_FALLBACK(Stage.Adult),
      [Stage.Final]: M_FALLBACK(Stage.Final),
    },
    anims: {
      [Stage.Egg]: ['egg_breathe', 'egg_sway'],
      [Stage.Baby]: ['idle', 'happy', 'sad', 'pet', 'feed'],
      [Stage.Adult]: ['idle', 'happy', 'sad', 'pet', 'feed', 'play', 'explore_ready'],
      [Stage.Final]: ['idle', 'happy', 'sad', 'pet', 'feed', 'play', 'explore_ready', 'signature_leap'],
    },
    lines: {
      happy: ['呜……不怕不怕。', '刚才只是……有点吓到啦。', '……我蹭你一下。'],
      sad: ['……（炸毛后耷拉下来）', '我、我只是……想靠一下……', '（缩成一团发抖）'],
      away: ['你……你走了好久哦……（耳朵抽动）', '我一直……守在窗台上的……', '……没、没担心你啦！只是、只是偶然往门口看！'],
      feed: ['……谢、谢谢……（耳朵微微放松）', '唔……好吃……', '……就、就这一次。以后我自己来。'],
      pet: ['唔……（尾巴尖轻轻扫过你的手）', '……不要停。', '……我只是……耳朵比较敏感而已。'],
    },
  },

  mao_arong: {
    id: 'mao_arong', xi: Xi.Mao, name: '阿绒', rarity: Rarity.Epic,
    phase: 1, unlockLayer: 1, themeColor: '#C7B8A1', signature: 'signature_dance',
    models: { // TODO(美术)：阿绒模型未产出，四阶段暂用团团占位
      [Stage.Egg]: M_FALLBACK(Stage.Egg),
      [Stage.Baby]: M_FALLBACK(Stage.Baby),
      [Stage.Adult]: M_FALLBACK(Stage.Adult),
      [Stage.Final]: M_FALLBACK(Stage.Final),
    },
    anims: {
      [Stage.Egg]: ['egg_breathe', 'egg_sway'],
      [Stage.Baby]: ['idle', 'happy', 'sad', 'pet', 'feed'],
      [Stage.Adult]: ['idle', 'happy', 'sad', 'pet', 'feed', 'play', 'explore_ready'],
      [Stage.Final]: ['idle', 'happy', 'sad', 'pet', 'feed', 'play', 'explore_ready', 'signature_dance'],
    },
    lines: {
      happy: ['你知道吗！刚才那只蝴蝶超好看！', '快快快过来看！我表演一个特技！', '今天也是元气满满的阿绒哦~'],
      sad: ['……没人理我……（自己滚一圈卖惨）', '呜呜呜……我表演特技摔倒了……', '呜……你是不是不爱阿绒了嘛……'],
      away: ['——啊——！！！你终于回来了——！！！我以为你把我丢在这要变成标本了——！！！', '呜哇呜呜呜……（抱住你的腿不放）', '我在家把所有能翻的东西都翻过一遍了……那个纸箱子底下真的什么都没有嘛？'],
      feed: ['好吃好吃好吃好吃好吃！！！（连蹦五下）', '你知道吗！我刚才差点就要把盘子舔干净了！', '偷偷告诉你，我的食谱最近更新了要不要听听看！'],
      pet: ['挠这里挠这里！对！就是这里！（原地打滚）', '再左边一丢丢！哦对！哦对了就是这个位置！', '（眯眼瘫软）……阿绒现在是液体了……'],
    },
  },

  // 毛虫系 phase2 占位
  mao_p1_a: placeholderPet('mao_p1_a', Xi.Mao, '待定·甲', Rarity.Common, 1, 2),
  mao_p1_b: placeholderPet('mao_p1_b', Xi.Mao, '待定·乙', Rarity.Legend, 1, 2),

  // ============ 羽虫系（占位） ============
  yu_p1_a: placeholderPet('yu_p1_a', Xi.Yu, '待定·风语', Rarity.Common),
  yu_p1_b: placeholderPet('yu_p1_b', Xi.Yu, '待定·赤翎', Rarity.Rare),
  yu_p1_c: placeholderPet('yu_p1_c', Xi.Yu, '待定·玄羽', Rarity.Epic),
  yu_p2_a: placeholderPet('yu_p2_a', Xi.Yu, '待定·丁', Rarity.Common, 1, 2),
  yu_p2_b: placeholderPet('yu_p2_b', Xi.Yu, '待定·戊', Rarity.Legend, 1, 2),

  // ============ 鳞虫系（占位） ============
  lin_p1_a: placeholderPet('lin_p1_a', Xi.Lin, '待定·小浪', Rarity.Common),
  lin_p1_b: placeholderPet('lin_p1_b', Xi.Lin, '待定·碧渊', Rarity.Rare),
  lin_p1_c: placeholderPet('lin_p1_c', Xi.Lin, '待定·银鳞', Rarity.Epic),
  lin_p2_a: placeholderPet('lin_p2_a', Xi.Lin, '待定·丁', Rarity.Common, 1, 2),
  lin_p2_b: placeholderPet('lin_p2_b', Xi.Lin, '待定·戊', Rarity.Legend, 1, 2),

  // ============ 介虫系（占位） ============
  jie_p1_a: placeholderPet('jie_p1_a', Xi.Jie, '待定·壳壳', Rarity.Common),
  jie_p1_b: placeholderPet('jie_p1_b', Xi.Jie, '待定·玄甲', Rarity.Rare),
  jie_p1_c: placeholderPet('jie_p1_c', Xi.Jie, '待定·霜盔', Rarity.Epic),
  jie_p2_a: placeholderPet('jie_p2_a', Xi.Jie, '待定·丁', Rarity.Common, 1, 2),
  jie_p2_b: placeholderPet('jie_p2_b', Xi.Jie, '待定·戊', Rarity.Legend, 1, 2),

  // ============ 倮虫系（占位） ============
  luo_p1_a: placeholderPet('luo_p1_a', Xi.Luo, '待定·软糖', Rarity.Common),
  luo_p1_b: placeholderPet('luo_p1_b', Xi.Luo, '待定·璃珠', Rarity.Rare),
  luo_p1_c: placeholderPet('luo_p1_c', Xi.Luo, '待定·幽瞳', Rarity.Epic),
  luo_p2_a: placeholderPet('luo_p2_a', Xi.Luo, '待定·丁', Rarity.Common, 1, 2),
  luo_p2_b: placeholderPet('luo_p2_b', Xi.Luo, '待定·戊', Rarity.Legend, 1, 2),
};

/** 混世四猴静态定义（独立池：四猴混世，不入十类之种、不在五虫体系内） */
export interface MonkeyDefStatic {
  id: string;
  pool: 'four_monkeys';                // 独立池标记（不复用五系枚举）
  name: string;
  rarity: Rarity;
  phase: 2;                            // 终局内容
  unlockLayer: 2;                      // 二层 · 混世四猴
  models: Partial<Record<Stage, string>>;
  anims: Partial<Record<Stage, string[]>>;
  themeColor: string;
  signature: string;
  lines: PetLines;
}

/** 混世四猴（终局隐藏池，五虫 25 只全完全体后解锁） */
export const FourMonkeys: Record<string, MonkeyDefStatic> = {
  monkey_lingshi: placeholderMonkey('monkey_lingshi', '灵明石猴'),
  monkey_chibi: placeholderMonkey('monkey_chibi', '赤尻马猴'),
  monkey_tongti: placeholderMonkey('monkey_tongti', '通臂猿猴'),
  monkey_biming: placeholderMonkey('monkey_biming', '六耳猕猴'),
};

/** 所有可孵化物种（五虫 25 只） */
export const ALL_SPECIES: PetDefStatic[] = Object.values(PetDefs);

/** MVP 实装池（毛虫系 phase1 3 只）——产蛋/抽取只从这里来，随实装范围扩池 */
export const MVP_SPECIES: PetDefStatic[] = ALL_SPECIES.filter(
  s => s.phase === 1 && s.xi === Xi.Mao,
);

/** 按系查询 */
export function getSpeciesByXi(xi: Xi): PetDefStatic[] {
  return ALL_SPECIES.filter(s => s.xi === xi);
}

/** 按 id 查询（返回 undefined 表示不存在） */
export function getSpecies(id: string): PetDefStatic | undefined {
  return PetDefs[id];
}

/** 辅助：快速生成占位定义 */
function placeholderPet(
  id: string, xi: Xi, name: string, rarity: Rarity,
  unlockLayer: 1 | 2 | 3 | 4 | 5 = 1,
  phase: 1 | 2 = 1,
): PetDefStatic {
  return {
    id, xi, name, rarity,
    phase, unlockLayer,
    themeColor: '#CCCCCC',
    signature: 'signature_placeholder',
    models: {},
    anims: {
      [Stage.Egg]: ['egg_breathe', 'egg_sway'],
      [Stage.Baby]: ['idle', 'happy', 'sad', 'pet', 'feed'],
      [Stage.Adult]: ['idle', 'happy', 'sad', 'pet', 'feed', 'play', 'explore_ready'],
      [Stage.Final]: ['idle', 'happy', 'sad', 'pet', 'feed', 'play', 'explore_ready', 'signature_placeholder'],
    },
    lines: {
      happy: ['~'], sad: ['……'], away: ['……'], feed: ['~'], pet: ['~'],
    },
  };
}

/** 辅助：生成混世四猴占位定义（独立池，全传说） */
function placeholderMonkey(id: string, name: string): MonkeyDefStatic {
  return {
    id,
    pool: 'four_monkeys',
    name,
    rarity: Rarity.Legend,
    phase: 2,
    unlockLayer: 2,
    themeColor: '#CCCCCC',
    signature: 'signature_placeholder',
    models: {},
    anims: {
      [Stage.Egg]: ['egg_breathe', 'egg_sway'],
      [Stage.Baby]: ['idle', 'happy', 'sad', 'pet', 'feed'],
      [Stage.Adult]: ['idle', 'happy', 'sad', 'pet', 'feed', 'play', 'explore_ready'],
      [Stage.Final]: ['idle', 'happy', 'sad', 'pet', 'feed', 'play', 'explore_ready', 'signature_placeholder'],
    },
    lines: {
      happy: ['~'], sad: ['……'], away: ['……'], feed: ['~'], pet: ['~'],
    },
  };
}

// A 是占位变量，用于让上面 M/A 辅助函数可用（避免 TS 未使用警告）
void A;
