/* Shared, offline taxonomy. Exact aliases are not inferred synonym relationships.
 * Unknown artist/style tags remain low-confidence evidence, never a guessed genre.
 * Platform/format rules intentionally do not apply to user-authored strict profiles.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BiuMusicDictionary = factory();
})(typeof window === 'object' ? window : this, function () {
  const rows = (type, text) => text.trim().split('\n').map((line) => [type, ...line.trim().split('|')]);
  const entries = [
    ...rows('genre', `
流行|pop
摇滚|rock
独立流行|indie pop
独立摇滚|indie rock
另类摇滚|alternative rock
后摇|post-rock|post rock
数学摇滚|math rock
前卫摇滚|progressive rock|prog rock
迷幻摇滚|psychedelic rock
车库摇滚|garage rock
艺术摇滚|art rock
硬摇滚|hard rock
软摇滚|soft rock
民谣摇滚|folk rock
电子摇滚|electronic rock
噪音摇滚|noise rock
哥特摇滚|gothic rock|goth rock
垃圾摇滚|grunge
英伦摇滚|britpop
梦幻流行|dream pop|dreampop
盯鞋|shoegaze|shoegazing
Slowcore|slowcore
后朋克|post-punk|post punk
朋克|punk
流行朋克|pop punk|pop-punk
硬核朋克|hardcore punk
后硬核|post-hardcore|post hardcore
Emo|emo
Screamo|screamo
新浪潮|new wave
暗潮|darkwave|dark wave
冷潮|coldwave|cold wave
City Pop|citypop|city pop|城市流行
合成器流行|synth-pop|synthpop|synth pop
独立电子|indietronica
电子|electronic|电音|电子音乐
氛围流行|ambient pop
环境音乐|ambient|氛围音乐
暗黑氛围|dark ambient
Drone|drone
实验音乐|experimental music
工业音乐|industrial music
噪音音乐|noise music
具体音乐|musique concrète
House|house|浩室
Deep House|deep house
Tech House|tech house
Progressive House|progressive house
Future House|future house
Electro House|electro house
Tropical House|tropical house
Techno|techno|铁克诺
Minimal Techno|minimal techno
Trance|trance
Psytrance|psytrance|psychedelic trance
Dubstep|dubstep
Drum and Bass|drum and bass|drum & bass|dnb|d&b
Liquid DnB|liquid dnb|liquid drum and bass
Jungle|jungle
Breakbeat|breakbeat
Breakcore|breakcore
UK Garage|uk garage|ukg
Future Bass|future bass
Trap|trap
Phonk|phonk
Drift Phonk|drift phonk
Wave|wave music
Synthwave|synthwave|合成器浪潮
Retrowave|retrowave
Vaporwave|vaporwave|蒸汽波
Chillwave|chillwave
Chillout|chillout|chill out
Downtempo|downtempo
Trip Hop|trip-hop|trip hop
IDM|idm|intelligent dance music
EDM|edm
Eurodance|eurodance
Italo Disco|italo disco
Disco|disco|迪斯科
Nu Disco|nu disco|nu-disco
Hardstyle|hardstyle
Hardcore Techno|hardcore techno
Gabber|gabber
Speedcore|speedcore
Chiptune|chiptune|芯片音乐|8-bit music
Glitch|glitch
Glitch Hop|glitch hop
Hyperpop|hyperpop
Lo-fi|lofi|lo-fi|lo fi
Lo-fi Hip Hop|lofi hip hop|lo-fi hip hop
爵士|jazz|爵士乐
爵士融合|jazz fusion|fusion jazz
酸爵士|acid jazz
顺滑爵士|smooth jazz
自由爵士|free jazz
比波普|bebop
硬波普|hard bop
酷爵士|cool jazz
摇摆爵士|swing jazz
拉丁爵士|latin jazz
波萨诺瓦|bossa nova
吉普赛爵士|gypsy jazz
蓝调|blues|布鲁斯
节奏布鲁斯|rhythm and blues
R&B|rnb|r&b
当代R&B|contemporary r&b
另类R&B|alternative r&b
灵魂乐|soul|灵魂音乐
新灵魂乐|neo soul|neo-soul
放克|funk
P-Funk|p-funk
福音|gospel
说唱|rap
Hip Hop|hip hop|hip-hop|嘻哈
Boom Bap|boom bap
Drill|drill
爵士说唱|jazz rap
另类说唱|alternative hip hop
金属|metal|金属乐
重金属|heavy metal
黑金属|black metal
死亡金属|death metal
旋律死亡金属|melodic death metal
激流金属|thrash metal
力量金属|power metal
前卫金属|progressive metal
交响金属|symphonic metal
哥特金属|gothic metal
厄运金属|doom metal
民谣金属|folk metal
工业金属|industrial metal
新金属|nu metal
金属核|metalcore
死核|deathcore
后金属|post-metal|post metal
泥浆金属|sludge metal
石人金属|stoner metal
Djent|djent
古典|classical|古典音乐
巴洛克|baroque
新古典|neoclassical
现代古典|modern classical
极简主义|minimalism
交响乐|symphony|symphonic music
室内乐|chamber music
管弦乐|orchestral
协奏曲|concerto
奏鸣曲|sonata
歌剧|opera
音乐剧|musical theatre|musical theater
艺术歌曲|art song|lieder
民谣|folk|民谣音乐
独立民谣|indie folk
当代民谣|contemporary folk
新民谣|neofolk
乡村|country|乡村音乐
蓝草|bluegrass
美式根源|americana
凯尔特|celtic
弗拉门戈|flamenco
雷鬼|reggae
斯卡|ska
Dub|dub
Dancehall|dancehall
Reggaeton|reggaeton
拉丁流行|latin pop
萨尔萨|salsa
桑巴|samba
探戈|tango
伦巴|rumba
非洲节拍|afrobeat
Afrobeats|afrobeats
世界音乐|world music
新世纪|new age|新世纪音乐
国风|国风音乐
古风|古风音乐
中国民乐|民乐|民族器乐
戏曲|中国戏曲
京剧|peking opera
昆曲|kunqu
越剧|yue opera
黄梅戏|huangmei opera
粤剧|cantonese opera
评弹|苏州评弹
童谣|nursery rhyme
儿歌|children's music
ACG|acg音乐|二次元音乐
动漫音乐|anime music|anisong|动画歌曲
游戏音乐|video game music|vgm
影视配乐|film score|电影配乐|电视剧配乐
J-Pop|jpop|j-pop|日本流行
J-Rock|jrock|j-rock|日本摇滚
K-Pop|kpop|k-pop|韩国流行
C-Pop|cpop|c-pop|华语流行
Cantopop|粤语流行
昭和歌谣|昭和歌謡
演歌|enka
VOCALOID|vocaloid|术力口
UTAU|utau
Synthesizer V|synthesizer v|synthv
纯音乐|instrumental
轻音乐|easy listening
`),
    ...rows('instrument', `
钢琴|piano
电钢琴|electric piano
管风琴|pipe organ
风琴|organ
大键琴|harpsichord
手风琴|accordion
合成器|synthesizer
吉他|guitar
木吉他|acoustic guitar
电吉他|electric guitar
古典吉他|classical guitar
尤克里里|ukulele
贝斯|bass guitar
小提琴|violin
中提琴|viola
大提琴|cello
低音提琴|double bass
竖琴|harp
曼陀林|mandolin
班卓琴|banjo
长笛|flute
短笛|piccolo
单簧管|clarinet
双簧管|oboe
巴松|bassoon
萨克斯|saxophone|萨克斯风
小号|trumpet
长号|trombone
圆号|french horn
大号|tuba
口琴|harmonica
陶笛|ocarina
风笛|bagpipe
架子鼓|drum kit|爵士鼓
手碟|handpan
马林巴|marimba
木琴|xylophone
颤音琴|vibraphone
卡林巴|kalimba|拇指琴
古筝|guzheng
古琴|guqin
二胡|erhu
琵琶|pipa
扬琴|yangqin
竹笛|dizi
箫|xiao flute
唢呐|suona
笙|sheng
阮|ruan
柳琴|liuqin
马头琴|morin khuur
尺八|shakuhachi
三味线|shamisen
西塔琴|sitar
`),
    ...rows('voice', `
女声|female vocal|female vocals
男声|male vocal|male vocals
童声|children's choir
合唱|choir|choral
无伴奏人声|a cappella|acappella|阿卡贝拉
美声|bel canto
清唱|unaccompanied singing
吟唱|chant
呼麦|throat singing
`),
    ...rows('mood', `
空灵|ethereal
梦幻|dreamy
舒缓|chill|舒缓音乐
宁静|peaceful
忧郁|melancholic|melancholy
伤感|伤感音乐
温柔|温柔音乐
浪漫|romantic
欢快|upbeat
活泼|lively
激昂|激昂音乐
热血|热血音乐
治愈|healing music|治愈系
怀旧|nostalgic
慵懒|laid back|laid-back
孤独|lonely
悲伤|sad music
压抑|压抑音乐
暗黑|dark music
史诗|epic music
诡异|eerie
轻快|轻快音乐
`),
    ...rows('scene', `
深夜|凌晨|late night|late-night
通勤|通勤音乐
学习|适合学习|学习背景|study music
工作|工作背景|工作音乐|work music
睡眠|助眠|睡前|sleep music
冥想|meditation music|冥想音乐
跑步|跑步音乐|running music
健身|健身音乐|workout music
驾驶|车载音乐|开车听|driving music
阅读|阅读音乐|reading music
咖啡馆|咖啡馆音乐|cafe music
瑜伽|瑜伽音乐|yoga music
派对|派对音乐|party music
婚礼|婚礼音乐|wedding music
圣诞|圣诞音乐|christmas music
`),
    ...rows('language', `
日语|日文|日语歌曲|日文歌曲
华语|国语|中文歌曲|华语歌曲
粤语|广东话|粤语歌曲
英语|英文歌曲|英语歌曲
韩语|韩文|韩语歌曲
法语|法文歌曲
德语|德文歌曲
西班牙语|西语歌曲
俄语|俄语歌曲
意大利语|意语歌曲
葡萄牙语|葡语歌曲
闽南语|闽南语歌曲
藏语|藏语歌曲
蒙古语|蒙语歌曲
`),
    ...rows('era', `
60年代|60s|1960s|六十年代
70年代|70s|1970s|七十年代
80年代|80s|1980s|八十年代
90年代|90s|1990s|九十年代
00年代|00s|2000s|零零年代
10年代|2010s
昭和|昭和时代
平成|平成时代
复古|retro
经典老歌|怀旧老歌
`),
    ...rows('artist', `
Beach House|beach house
Slowdive|slowdive
Radiohead|radiohead|电台司令
Cocteau Twins|cocteau twins
My Bloody Valentine|my bloody valentine
Sigur Rós|sigur ros|sigur rós
椎名林檎|椎名林檎
坂本龙一|坂本龍一|ryuichi sakamoto
久石让|久石譲|joe hisaishi
宇多田光|宇多田ヒカル|hikaru utada
山下达郎|山下達郎|tatsuro yamashita
竹内玛莉亚|竹内まりや|mariya takeuchi
`),
    ...rows('format', `
合集|歌单|精选集|playlist|mix|音乐合集|歌曲合集|串烧|金曲串烧|歌单分享|私藏歌单
现场|live|音乐现场|现场演出|演唱会|音乐会|音乐节|livehouse|live house
MV|mv|音乐视频|music video|官方mv|official mv
翻唱|cover|翻唱歌曲|翻唱音乐|歌曲翻唱|音乐翻唱
翻奏|翻奏音乐|乐器翻奏
改编|改编音乐|remix|混音|remixes
歌词版|歌词|歌词视频|歌词同步|动态歌词|带歌词|lyric video|lyrics|lyric
字幕版|字幕|中英字幕|中日字幕|双语字幕|中文字幕|外挂字幕
纯享版|纯享|完整版|完整歌曲|完整版歌曲|全曲|单曲
剪辑版|音乐剪辑|剪辑|cut|节选|片段|音乐片段|歌曲片段
循环版|循环|单曲循环|无限循环|循环播放|一小时循环|小时循环|on repeat|loop
加速版|sped up|speed up|加速|倍速
慢速版|slowed|slowed reverb|slowed and reverb|降速|慢速
伴奏|伴奏版|卡拉ok|karaoke|off vocal
原声带|ost|soundtrack|原声音乐|原声大碟
专辑|album|ep|single|专辑分享|新专辑
试听|试听版|预告|预告片|teaser|demo
音质|高音质|无损|无损音质|无损音乐|超高音质|高清音质|hi-res|hires|hifi|hi-fi|flac|wav|mp3|aac
画质|高清|超清|蓝光|4k|8k|1080p|60fps|hd|uhd
音效|立体声|环绕声|空间音频|杜比全景声|dolby atmos|8d audio|8d音乐|3d音乐
背景音乐|bgm|背景音|background music
`),
  ];
  const generic = new Set(`音乐 视频 歌曲 听歌 听音乐 听曲 听听歌 听歌向 听歌日常 听歌分享 听歌打卡 每日听歌 一起听歌 一起听音乐 沉浸式听歌 随机听歌 随便听听 歌荒 拯救歌荒 告别歌荒 歌荒必听 日推 日推歌曲 日推音乐 日推歌单 日推好歌 日推宝藏歌曲 今日推荐 今日歌曲 今日音乐 今日分享 今日份音乐 每日推荐 每日推歌 每日歌曲 每日音乐 每日分享 每日一歌 每日一曲 每日好歌 每天一首歌 每天一首好歌 每天一首音乐 一天一首歌 一日一曲 好歌 好听 好听的歌 好听到爆 好听到单曲循环 耐听 悦耳 必听 百听不厌 百听不腻 听不腻 越听越好听 神曲 神仙歌曲 神仙音乐 宝藏 宝藏音乐 宝藏歌曲 宝藏歌单 小众 小众音乐 小众歌曲 冷门 冷门音乐 冷门歌曲 热门 热门音乐 热门歌曲 热歌 爆火 全网爆火 火爆全网 抖音热歌 网络热歌 网络神曲 网红歌曲 经典 经典歌曲 经典音乐 经典金曲 金曲 必收 收藏 私藏 珍藏 私人 自用 安利 推荐 分享 music song songs video videos recommendation recommendations recommended daily dailyrecommendation playlistrecommendation musicrecommendation fyp foryou viral trending bilibili 哔哩哔哩 b站 b站音乐 音乐区 音乐综合 音乐推荐 音乐分享 歌曲推荐 歌曲分享 好歌推荐 好歌分享 好曲推荐 好曲分享 推歌 推歌向 歌曲安利 音乐安利 好歌安利 安利音乐 乐曲推荐 乐曲分享 耳机 耳机党 戴上耳机 前奏 前奏杀 开口跪 开口脆 高潮 副歌 高潮部分 副歌部分 旋律 上头 洗脑 好听的旋律 旋律好听 绝美 惊艳 震撼 绝了 太好听了 不火天理难容 泪目 破防 打动人心 直击灵魂 音乐的力量 感受音乐 音乐无国界 无音乐不生活 用音乐表达自己 音乐是解药 原创 自制 自制视频 日常 生活 随拍 娱乐 高能 搬运 转载 转载视频 侵删 侵权删除 仅供欣赏 仅供分享 油管搬运 youtube youtube搬运 萌新 新人 新人up主 up主 bilibili新星计划 必剪 必剪创作 剪映 剪映创作 一键三连 点赞 投币 收藏 关注 点赞关注 关注点赞 求关注 求点赞 求三连 评论 弹幕 转发 支持 感谢支持 记录 分享生活 我的日常`.split(/\s+/));
  const normalized = (v) => String(v || '').normalize('NFKC').toLowerCase().replace(/[\s#＃【】\[\]「」『』《》！!？?，,。·_]+/g, '').trim();
  const genericKeys = new Set([...generic].map(normalized));
  // Match a promotion's grammatical form, not arbitrary substrings such as 音乐/日/听.
  const noiseRules = [
    /征集令|征集活动|创作激励|创作挑战|投稿活动|活动投稿|打卡挑战|挑战赛|新星计划|新星征集|新星征程|星计划|创作计划|创作营|创作季|创作大赛|创作招募|投稿季|投稿大赛|音乐分享官|音乐安利官|音乐推荐官|音乐发现官|音乐合伙人|音乐星推官|音乐星计划|音乐up主扶持|音乐激励计划/,
    /^(?:bilibili|b站|抖音|快手|网易云|网易云音乐|qq音乐|酷狗|酷我|汽水音乐|小红书|spotify|youtube)?(?:音乐)?(?:推荐|分享|安利|日推|热推|热榜|排行榜|热歌榜|飙升榜|新歌榜|流行榜|热搜榜)$/,
    /^(?:每日|每天|今日|今天|日推|私藏|私人|精选|宝藏|小众|冷门|热门|超好听|好听|经典|高质量|高品质|优质|值得收藏|不容错过|强烈推荐|单曲循环的|循环播放的|耳机里的|最近在听的|你一定听过的|那些好听的|那些被遗忘的)+(?:的)?(?:好歌|歌曲|音乐|歌单|金曲|乐曲|推荐|分享|安利|一曲|一歌|一首歌)+(?:推荐|分享|安利|合集|精选|系列|日推|打卡)?$/,
    /^(?:音乐|歌曲|好歌|金曲|听歌|听音乐|日推|推歌)(?:推荐|分享|安利|打卡|日常|向|系列|合集|精选|时间|时刻|频道|站|bot|计划|挑战|第?[一二三四五六七八九十百\d]+[期集天回合]*)+$/,
    /^(?:day|vol|part|ep|第)[.\-\d一二三四五六七八九十百]+(?:期|集|天|回|回合)?$/i,
    /^\d{4}(?:年)?(?:bilibili|b站)?(?:跨年|拜年|新年|毕业)(?:晚会|祭|纪念|季|特别节目)$/,
    /^(?:bilibili|b站)?(?:跨年晚会|毕业歌会|夏日歌会|拜年祭|毕业季|音乐年度盘点|年度音乐盘点)$/,
    /^(?:music|song|songs|playlist)(?:recommendation|recommendations|recommended|sharing|share|discovery|daily|oftheday)$/,
    /^.{1,16}(?:音乐推荐|歌曲推荐|好歌推荐|音乐分享|歌曲分享|歌单推荐|歌单分享)$/,
  ];
  const formatRules = /^(?:\d+(?:首|曲|小时|分钟|h|min))?(?:音乐|歌曲)?(?:合集|歌单|串烧|精选|连播|循环|循环版|单曲循环|无损版|高清版|完整版|纯享版|歌词版|字幕版|现场版|伴奏版|翻唱版|加速版|慢速版)(?:\d+)?$/i;
  function isNoise(name) { const value = normalized(name); return genericKeys.has(value) || noiseRules.some((r) => r.test(value)); }
  function isFormat(name) { return formatRules.test(normalized(name)); }
  return { version: 2, entries, isNoise, isFormat, normalized, genericCount: genericKeys.size, ruleCount: noiseRules.length };
});
