// 弟子取名：移植自主仓 naming.ts（种子确定性、避重、性别字池），去掉子嗣继承分支
//（简化版取消结缘/师徒，无血脉代际）。
import { sha256 } from "./hash.js";

export type DiscipleNameGenerationInput = {
  seed: string;
  ordinal: number;
  usedNames?: Iterable<string>;
};

export type DiscipleNameGender = "male" | "female";

export type DiscipleNameProfile = {
  name: string;
  gender: DiscipleNameGender;
};

const DISCIPLE_SURNAMES = [
  "赵",
  "钱",
  "孙",
  "李",
  "周",
  "吴",
  "郑",
  "王",
  "冯",
  "陈",
  "沈",
  "韩",
  "杨",
  "朱",
  "秦",
  "许",
  "何",
  "吕",
  "张",
  "曹",
  "严",
  "华",
  "金",
  "魏",
  "陶",
  "姜",
  "谢",
  "邹",
  "柏",
  "云",
  "苏",
  "潘",
  "葛",
  "范",
  "彭",
  "郎",
  "鲁",
  "马",
  "苗",
  "凤",
  "花",
  "方",
  "俞",
  "任",
  "袁",
  "柳",
  "顾",
  "孟",
  "黄",
  "穆",
  "萧",
  "尹",
  "姚",
  "邵",
  "湛",
  "汪",
  "禹",
  "狄",
  "戴",
  "宋",
  "庞",
  "舒",
  "项",
  "董",
  "梁",
  "杜",
  "阮",
  "蓝",
  "季",
  "贾",
  "江",
  "童",
  "颜",
  "郭",
  "林",
  "徐",
  "丘",
  "骆",
  "高",
  "夏",
  "蔡",
  "田",
  "樊",
  "胡",
  "凌",
  "霍",
  "万",
  "柯",
  "管",
  "卢",
  "莫",
  "房",
  "裘",
  "解",
  "宗",
  "丁",
  "宣",
  "洪",
  "左",
  "石",
  "崔",
  "程",
  "邢",
  "裴",
  "陆",
  "荣",
  "翁",
  "荀",
  "封",
  "靳",
  "段",
  "富",
  "巫",
  "焦",
  "巴",
  "牧",
  "山",
  "谷",
  "侯",
  "秋",
  "伊",
  "宫",
  "甘",
  "武",
  "符",
  "刘",
  "景",
  "龙",
  "叶",
  "黎",
  "白",
  "怀",
  "蒲",
  "卓",
  "蔺",
  "蒙",
  "池",
  "乔",
  "闻",
  "谭",
  "姬",
  "冉",
  "桑",
  "桂",
  "牛",
  "燕",
  "温",
  "庄",
  "晏",
  "柴",
  "慕",
  "连",
  "艾",
  "易",
  "廖",
  "耿",
  "弘",
  "欧",
  "师",
  "冷",
  "辛",
  "简",
  "曾",
  "沙",
  "丰",
  "关",
  "权",
  "楚",
  "法",
  "汝",
  "海",
  "商",
  "牟",
  "佘",
  "言",
  "福",
  "司马",
  "上官",
  "欧阳",
  "夏侯",
  "诸葛",
  "闻人",
  "东方",
  "赫连",
  "皇甫",
  "尉迟",
  "公孙",
  "仲孙",
  "轩辕",
  "令狐",
  "宇文",
  "长孙",
  "慕容",
  "鲜于",
  "司徒",
  "司空",
  "端木",
  "巫马",
  "乐正",
  "拓拔",
  "谷梁",
  "百里",
  "东郭",
  "南门",
  "呼延",
  "梁丘",
  "左丘",
  "南宫",
  "云隐",
  "洛水",
  "沧月",
  "听风",
  "疏影",
  "寒山",
  "流云",
  "青丘",
  "玄夜",
  "白露",
  "观澜",
  "归墟",
  "凌霄",
  "栖霞",
  "望舒",
  "墨羽",
] as const;

const MALE_NAME_CHARACTERS = uniqueCharacters(
  "乐飞福皇嘉达佰美元致春帅亮名欧特辰康讯鹏腾澜津启博扬索蓝昂兴聚鸿略卡姬安众汇圣卓宇国普绿斯业媛意盛雄琛钧冠策毓楠榕伊铭齐风航弘义昭良纨彬富颜麒韬鸣朋斌行时泰娜磊民琴芳芯友志清坚庆若德彪宏芝萍霄伟刚勇毅俊峰强军平丽苑芸保东文辉力明玲健世彩朗郎旺融誉际巨骄为诚妙顺领迅英虹尼迈群拓建秋宸江雷天仪优聪垒蕾瀚玫琪淑骁永吉先君依昌哲营惠羽希舒曙廷渲霭凝立玉静同颖宜林奇政冰影红尚川州帝悦情洁滋祥艳珊薰滟禾竹多帆秀贝仑青枫琰波笑宗雨涵纪亭甜禹垚园娟琳金新中加亚信华豪奥珠翠雅凯和鑫创宝星联晨尔海瑞科锦易威玛日伦道发唯一才月欢泽诗香鼎麦邦克凡利思泓品庭展朔轩育晓眉通骏振聆翌迎常浩益杰途丰壹智超正劲韧谦逊恭俭让仁礼忠孝廉节操守恒远大存高汉沧擎寰岚岳峻涛浪潮汐瀑泉溪涧森柏松梅兰桂苍碧洲原野旷垠锋钊铠铖铮剑戟戈矛弓矢御驾驭驰骋冲杀伐征战讨定乱曦昕昀晟晔曜炜煜灿焕烁炽炎焱煌荧莹晶照临显赫荣光玄虚灵真逸尘神无量极至深莫测变幻化修悟彻觉醒参透澈洞悉命注数劫渡厄难险阻夷坦荡凛肃穆庄严",
);

const FEMALE_NAME_CHARACTERS = uniqueCharacters(
  "乐飞美元春亮名澜津蓝姬安汇圣卓宇绿斯媛意雄琛钧冠策毓楠榕伊风航弘义昭良纨彬富颜鸣行时娜民琴芳芯友清庆若芝萍平丽苑芸保东文明玲彩为妙领迅英虹芬馨尼秋倩宸江天仪优聪垒蕾玫琪淑骁永吉先君依惠羽希舒曙渲梦瑜菏凤叶芃霭凝立玉静同颖宜林奇政冰影红悦情洁滋祥艳珊薰滟禾竹秀贝仑青琰波笑宗雨涵纪亭甜禹园娟琳华珠翠雅和宝星晨百蔓莓曼尔瑞玛柔淞渺发唯一才月丹涟欢薇泽诗香鼎碧麦利思滢萱盈泓品庭展朔轩育晓眉聆翌迎枝丰壹智婷岚云淼蓓慧微菡资湘会菁萌语芊赫寒茗珂爽阳臻燕霖霏爱灿蓉景馥筠露鹤荔湾菲可巧飘漪琬瑗祎桃杏樱梨棠蔷芙蕖莲荷菱荻芦兰芷蘅芜苹莉茉荼蘼瑰花葩蕊朵苞瓣柯茎根株苗秧翡瑾璇玑琅瑚珀琥瑙琦璐钗钏镯环铃铛钰银锦绣缎绸绫纱绢绮素皙黛朱砂绛紫绯彤婉娴贤敏俐伶乖温慈善纯真烂漫泼开方贵端庄俏妩媚婀窈娉袅幽恬淡泊宁致远怡欣愉畅快满溢夜霜雯霓絮茫朦胧曦晖皓皎望弦闪烁耀映辉歌舞词赋瑟琵琶筝笛箫笙管音律韵调声曲谱戏演绎奏响吟诵咏叹悠扬脆嘹低回宛缠绵悱恻仙子姑射灵逸脱俗胎蜕涅槃凰鸾鸳蝶瑶琼阁蟾宫嫦娥袖翩跹",
);

const MAX_NAME_ATTEMPTS = 64;

function uniqueCharacters(source: string): readonly string[] {
  return [...new Set([...source])];
}

function pick<T>(items: readonly T[], index: number): T {
  const item = items[index];
  if (item === undefined) throw new Error("disciple_name_library_invalid");
  return item;
}

function assertInput(input: DiscipleNameGenerationInput): void {
  if (
    typeof input.seed !== "string" ||
    input.seed.trim().length === 0 ||
    !Number.isInteger(input.ordinal) ||
    input.ordinal < 1 ||
    // 上限 10000：主仓遗留为 300；简化版 NPC 宗门按月自动招募（长战役/千局调平），
    // 编号会持续增长，放行至长跑安全量级（避重仍由 usedNames + 64 次重试保证）。
    input.ordinal > 10_000
  ) {
    throw new TypeError("disciple_name_generation_input_invalid");
  }
}

export function generateDiscipleProfile(input: DiscipleNameGenerationInput): DiscipleNameProfile {
  assertInput(input);
  const usedNames = new Set(input.usedNames ?? []);

  for (let attempt = 0; attempt < MAX_NAME_ATTEMPTS; attempt += 1) {
    const digest = sha256(`${input.seed.trim()}:disciple-name:${input.ordinal}:${attempt}`);
    const gender: DiscipleNameGender = digest.readUInt8(0) % 2 === 0 ? "male" : "female";
    const genderPool = gender === "male" ? MALE_NAME_CHARACTERS : FEMALE_NAME_CHARACTERS;
    const surname = pick(DISCIPLE_SURNAMES, digest.readUInt16BE(1) % DISCIPLE_SURNAMES.length);
    const first = pick(genderPool, digest.readUInt16BE(3) % genderPool.length);
    const twoCharacterGivenName = digest.readUInt8(5) % 2 === 0;
    const second = twoCharacterGivenName
      ? pick(genderPool, digest.readUInt16BE(6) % genderPool.length)
      : "";
    const name = `${surname}${first}${second}`;
    if (!usedNames.has(name)) return { name, gender };
  }

  throw new Error("disciple_name_generation_exhausted");
}

export function generateDiscipleName(input: DiscipleNameGenerationInput): string {
  return generateDiscipleProfile(input).name;
}
