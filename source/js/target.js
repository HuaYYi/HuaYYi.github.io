var target_selec =[
    {
        action:"https://www.baidu.com/s",
        name:"wd",
        placeholder:"百度一下，你就知道",
        innerText:"百度"
    },
    {
        action:"https://www.sogou.com/web",
        name:"query",
        placeholder:"搜狗搜索",
        innerText:"搜狗"
    },
    {
        action:"https://www.so.com/s",
        name:"q",
        placeholder:"360搜索",
        innerText:"360"
    },
    {
        action:"https://huaban.com/search/",
        name:"q",
        placeholder:"搜索你喜欢的",
        innerText:"花瓣"
    },
]
var target_url =[
    {
        kind:"设计素材",
        href:"https://www.iconfont.cn/",
        img:"https://image.uisdc.com/wp-content/uploads/2021/03/sdcnav-1-icon.png",
        title:"IconFont",
        describe:"国内最著名的图标搜索及管理平台，300万个图标下载"
    },
    {
        kind:"设计素材",
        href:"https://iconpark.oceanengine.com/",
        img:"https://lf1-cdn2-tos.bytegoofy.com/bydesign/iconparksite/logo.svg",
        title:"IconParK",
        describe:"这里有你需要的图标，也有属于你的风格，让工作变得更轻松"
    },
    {
        kind:"设计素材",
        href:"https://ibaotu.com/guanggao/1-0-0-0-3-1.html?spm=uisdc",
        img:"https://image.uisdc.com/wp-content/uploads/2018/08/sdcnav-1-11.png",
        title:"包图网",
        describe:"推荐！1000万套原创品质商用素材，效率神器"
    },
    {
        kind:"设计素材",
        href:"https://huaban.com/",
        img:"https://image.uisdc.com/wp-content/uploads/2018/08/sdcnav-8-2.png",
        title:"花瓣网",
        describe:"设计师寻找灵感的必备站点，启发设计灵感"
    },
    {
        kind:"设计素材",
        href:"https://www.zcool.com.cn/",
        img:"https://image.uisdc.com/wp-content/uploads/2018/08/sdcnav-2-10.png",
        title:"站酷",
        describe:"综合性设计分享网站，原创设计交流平台"
    },
    {
        kind:"设计素材",
        href:"https://uiiiuiii.com/tool/typeface",
        img:"https://image.uisdc.com/wp-content/uploads/2018/08/sdcnav-10-1.png",
        title:"免费商用字体",
        describe:"超全！免费可商用中文+英文字体，含应用场景"
    },
    {
        kind:"设计工具",
        href:"https://www.fococlipping.com/",
        img:"https://image.uisdc.com/wp-content/uploads/2021/08/nav-fococlipping.png",
        title:"FocoClipping 在线抠图",
        describe:"强大的在线抠图神器！3秒出图全自动超方便"
    },
    {
        kind:"设计工具",
        href:"https://color.adobe.com/zh/",
        img:"https://image.uisdc.com/wp-content/uploads/2018/08/sdcnav-5-1.png",
        title:"Adobe Color",
        describe:"网页设计师配色的最佳之选"
    },
    {
        kind:"设计工具",
        href:"https://uigradients.com/",
        img:"https://image.uisdc.com/wp-content/uploads/2018/08/sdcnav-5-4.png",
        title:"uiGradients",
        describe:"今年流行的渐变！点击屏幕两侧按钮可选更多色彩"
    },
    {
        kind:"设计工具",
        href:"https://colordrop.io/",
        img:"https://image.uisdc.com/wp-content/uploads/2018/08/sdcnav-5-11.png",
        title:"ColorDrop",
        describe:"让寻找配色方案成为信手拈来的事情"
    },
    {
        kind:"设计工具",
        href:"https://js.design/?source=uisdc&plan=rmtj",
        img:"https://image.uisdc.com/wp-content/uploads/2021/06/nav-js-design.png",
        title:"即时设计",
        describe:"推荐！免费专业级UI设计工具，可云端协作的Sketch"
    },
    {
        kind:"前端开发",
        href:"https://www.w3school.com.cn/",
        img:"https://image.uisdc.com/wp-content/uploads/2018/08/sdcnav-16-4-1.png",
        title:"w3school在线教程",
        describe:"必备！全球最大的中文Web技术教程"
    },
    {
        kind:"影视媒体",
        href:"https://www.bilibili.com/",
        img:"https://image.uisdc.com/wp-content/uploads/2018/08/sdcnav-15-8.png",
        title:"B站",
        describe:"国内知名视频弹幕网站，有最及时的动漫新番"
    },
    {
        kind:"影视媒体",
        href:"https://www.huya.com/",
        img:"https://image.uisdc.com/wp-content/uploads/2020/01/nav2020-huya.png",
        title:"虎牙",
        describe:"弹幕式互动直播平台"
    },
        {
        kind:"影视媒体",
        href:"http://www.ximiyy.com/",
        img:"http://www.ximiyy.com/favicon.ico",
        title:"西米影院",
        describe:"西米影院收集整理最新最新电影,最新电视剧,最新动画片在线观看，致力打造专业在线视频网站."
    },
    {
        kind:"设计素材",
        href:"https://www.jamendo.com/start",
        img:"https://image.uisdc.com/wp-content/uploads/2020/07/sdcnav-jamendo.png",
        title:"Jamendo Music",
        describe:"质量很高的免费音乐素材下载平台"
    },
    {
        kind:"设计素材",
        href:"https://www.bensound.com/",
        img:"https://image.uisdc.com/wp-content/uploads/2020/07/sdcnav-bensound.png",
        title:"Bensound",
        describe:"独特有质感的免费背景音乐素材站点"
    },
    {
        kind:"云存储",
        href:"https://www.aliyundrive.com/sign/in?spm=aliyundrive.index.0.0.2d836020qNsbQk",
        img:"https://gw.alicdn.com/imgextra/i3/O1CN01aj9rdD1GS0E8io11t_!!6000000000620-73-tps-16-16.ico",
        title:"阿里云盘",
        describe:"速度快、不打扰、够安全、易于分享的网盘"
    },
    {
        kind:"云存储",
        href:"https://www.lanzou.com/",
        img:"https://www.lanzou.com//favicon.ico",
        title:"蓝奏云",
        describe:"来这里，下载无限制，无验证码，畅快淋漓尽致！"
    },
    {
        kind:"前端开发",
        href:"https://www.runoob.com/",
        img:"https://static.runoob.com/images/favicon.ico",
        title:"菜鸟教程",
        describe:"学的不仅是技术，更是梦想！"
    },
    {
        kind:"前端开发",
        href:"https://youzan.github.io/vant/v3/#/zh-CN",
        img:"https://img.yzcdn.cn/vant/logo.png",
        title:"Vant",
        describe:"轻量、可靠的移动端 Vue 组件库"
    },
    {
        kind:"前端开发",
        href:"https://nutui.jd.com/#/",
        img:"https://img14.360buyimg.com/imagetools/jfs/t1/167902/2/8762/791358/603742d7E9b4275e3/e09d8f9a8bf4c0ef.png",
        title:"NutUI",
        describe:"京东风格的轻量级移动端 Vue 组件库"
    },
    {
        kind:"前端开发",
        href:"https://element.eleme.cn/#/zh-CN",
        img:"https://element.eleme.cn/favicon.ico",
        title:"Element",
        describe:"Element，一套为开发者、设计师和产品经理准备的基于 Vue 2.0 的桌面端组件库"
    },
    {
        kind:"云存储",
        href:"https://github.com/",
        img:"https://github.githubassets.com/favicons/favicon.png",
        title:"GitHub",
        describe:"在云中给您的代码一个家"
    },
    {
        kind:"云存储",
        href:"https://gitee.com/",
        img:"https://assets.gitee.com/assets/favicon-9007bd527d8a7851c8330e783151df58.ico",
        title:"Gitee",
        describe:"基于 Git 的代码托管和研发协作平台"
    },
    {
        kind:"设计工具",
        href:"https://kt.fkw.com/",
        img:"https://kt.fkw.com/favicon.ico",
        title:"凡科快图",
        describe:"让设计更简单"
    },
    {
        kind:"设计素材",
        href:"http://www.1ppt.com/",
        img:"http://www.1ppt.com/favicon.ico",
        title:"第一PPT",
        describe:"专注PowerPoint素材下载！"
    },
    {
        kind:"前端开发",
        href:"https://www.jb51.net/",
        img:"https://www.jb51.net/favicon.ico",
        title:"脚本之家",
        describe:"提供最新的网络编程、脚本编程、网页制作、网页设计、网页特效，为站长与网络编程从业者提供学习资料。"
    },
    {
        kind:"知名博客",
        href:"https://blog.daliansky.net/",
        img:"https://hbimg.huabanimg.com/628fd206a0fe84497cfa052fc0f64b60c4f872e51221-v27DCr",
        title:"黑果小兵的部落阁",
        describe:"Hackintosh安装镜像、教程及经验分享"
    },
    {
        kind:"设计工具",
        href:"http://www.woshipm.com/",
        img:"http://image.woshipm.com/favicon.ico",
        title:"人人都是产品经理",
        describe:"深度剖析国内外互联网业内动态，分享产品设计、交互设计、视觉设计、用户体验设计、产品运营、产品市场和项目管理等专业产品知识。"
    },
    {
        kind:"设计工具",
        href:"https://lanhuapp.com/",
        img:"data:image/x-icon;base64,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+f/4uqb/8XNL//FySf/xckn/8XJJ//FySf/xckn5/4CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAPFySc/xckn/8XJJ//FySf/xckn/+sq7///////////////////////////////////////6yrv/8XJJ//FySf/xckn/8XJJ//FySeUAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA8XJJxfFySf/xckn/8XJJ//adgf///////////////////////////+jm5v/U0dH/9/b2///////1nYD/8XJJ//FySf/xckn/8XJJ2QAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADxckm98XJJ//FySf/xckn/+9jM//////////////////////+Rioj/QTUy/0E1Mv9SR0T/0s/P//vXy//xckn/8XJJ//FySf/xcknTAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAPFySbfxckn/8XJJ//FySf/+9fL/////////////////xcHA/0E1Mv9BNTL/QTUy/0E1Mv9YTkv//vTx//FySf/xckn/8XJJ//FySc8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA8XJJpfFySf/xckn/8XJJ//749v////////////////+clpT/QTUy/0E1Mv9BNTL/QTUy/0E1Mv/t5OH/8XJJ//FySf/xckn/8XJJuwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADxckmJ8XJJ//FySf/xckn//OPb/////////////////7q2tf9BNTL/QTUy/0E1Mv9BNTL/T0RB//vg1//xckn/8XJJ//FySf/xckmhAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAPJzSkzxckn/8XJJ//FySf/3s5z//////////////////Pz8/3dubP9BNTL/QTUy/0Y7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",
        title:"蓝湖",
        describe:"无缝衔接产品、设计、研发流程，降低沟通成本，缩短开发周期，提高工作效率"
    },
    {
        kind:"设计工具",
        href:"https://www.mockplus.cn/",
        img:"https://www.mockplus.cn/favicon.ico",
        title:"慕客",
        describe:"摹客集设计协作平台、原型设计和设计规范为一体，数百万设计师、产品经理和开发工程师必备设计神器、交互原型、标注切图、文档管理。百人团队免费协作。"
    },
    {
        kind:"前端开发",
        href:"https://juejin.cn/",
        img:"https://lf3-cdn-tos.bytescm.com/obj/static/xitu_juejin_web//static/favicons/favicon-32x32.png",
        title:"掘金",
        describe:"掘金是一个帮助开发者成长的社区,是给开发者用的 Hacker News,给设计师用的 Designer News,和给产品经理用的 Medium。掘金的技术文章由稀土上聚集的技术大牛和极客共同编辑为你筛选出最优质的干货,其中包括：Android、iOS、前端、后端等方面的内容。用户每天都可以在这里找到技术世界的头条内容。与此同时,掘金内还有沸点、掘金翻译计划、线下活动、专栏文章等内容。即使你是 GitHub、StackOverflow、开源中国的用户,我们相信你也可以在这里有所收获。"
    },
    {
        kind:"前端开发",
        href:"https://www.csdn.net/",
        img:"https://g.csdnimg.cn/static/logo/favicon32.ico",
        title:"CSDN",
        describe:"CSDN是全球知名中文IT技术交流平台,创建于1999年,包含原创博客、精品问答、职业培训、技术论坛、资源下载等产品服务,提供原创、优质、完整内容的专业IT技术开发社区。"
    },
    {
        kind:"设计素材",
        href:"https://www.aigei.com/",
        img:"https://cdn-sqn.aigei.com/assets/site/img/icon/favicon.ico",
        title:"爱给",
        describe:"中国最大的数字娱乐免费素材下载网站,免费提供免费的音效配乐|3D模型|视频|游戏素材资源下载。"
    },
    {
        kind:"设计工具",
        href:"https://www.processon.com/",
        img:"https://www.processon.com/favicon.ico",
        title:"ProcessOn",
        describe:"专业强大的作图工具，支持多人实时在线协作，可用于原型图、UML、BPMN、网络拓扑图等多种图形绘制"
    },
    {
        kind:"前端开发",
        href:"https://learn-english.dev/",
        img:"https://learn-english.dev/assets/favicon-32x32.png",
        title:"程序员英语词汇宝典",
        describe:"程序员工作中应掌握的英文术语"
    },    
    {
        kind:"影视媒体",
        href:"https://www.iqiyi.com/",
        img:"https://www.iqiyipic.com/common/fix/128-128-logo.png",
        title:"爱奇艺",
        describe:"拥有海量、优质、高清的网络视频的大型视频网站，专业的网络视频播放平台。"
    },
    {
        kind:"影视媒体",
        href:"https://v.qq.com/",
        img:"https://v.qq.com/favicon.ico",
        title:"腾讯视频",
        describe:"中国领先的在线视频媒体平台,海量高清视频在线观看"
    },
    {
        kind:"影视媒体",
        href:"https://learningmusic.ableton.com/",
        img:"https://learningmusic.ableton.com/images/favicon.ico",
        title:"Learning Music",
        describe:"探索音乐的基本知识。在浏览器上实际操作创作节奏，旋律，和声，贝斯和歌曲结构。"
    },
    {
        kind:"设计素材",
        href:"https://www.hippopx.com/zh",
        img:"https://www.hippopx.com/public/css/favicon.ico",
        title:"Hippopx",
        describe:"Hippopx免版权图库提供了各种高清，精美的图片供您免费下载"
    },
    {
        kind:"设计素材",
        href:"https://visualhunt.com/zh#",
        img:"https://visualhunt.com/favicon.ico",
        title:"视觉狩猎",
        describe:"我们从许多在线资源中寻找最好的免费图片，并将它们集中到一个地方。我们的大部分照片都是CC0 许可证。"
    },
    {
        kind:"设计素材",
        href:"https://negativespace.co/",
        img:"https://negativespace.co/wp-content/themes/negative-space-v4.1/images/favicon.ico",
        title:"NegativeSpace",
        describe:"Beautiful Free Stock Photos"
    },
    {
        kind:"设计素材",
        href:"https://thenounproject.com/",
        img:"https://static.production.thenounproject.com/img/favicons/favicon-32x32.015f779a87e7.png",
        title:"Noun Project",
        describe:"Free Icons & Stock Photos for Everything"
    },
    {
        kind:"设计素材",
        href:"https://www.dafont.com/",
        img:"https://www.dafont.com/img/favicon.ico",
        title:"DaFont",
        describe:"大量免费英文字体下载站"
    },
    {
        kind:"影视媒体",
        href:"https://www.mgtv.com/",
        img:"https://www.mgtv.com/favicon.ico",
        title:"芒果TV",
        describe:"大家都在看的在线视频网站-热门综艺最新电影电视剧在线观看"
    },
    {
        kind:"影视媒体",
        href:"https://www.douyu.com/",
        img:"https://www.douyu.com/favicon.ico",
        title:"斗鱼",
        describe:"每个人的直播平台提供高清、快捷、流畅的视频直播和游戏赛事直播服务"
    },
    {
        kind:"云存储",
        href:"https://pan.baidu.com/",
        img:"https://pan.baidu.com/m-static/base/static/images/favicon.ico",
        title:"百度网盘",
        describe:"百度网盘为您提供文件的网络备份、同步和分享服务。空间大、速度快、安全稳固，支持教育网加速，支持手机端。注册使用百度网盘即可享受免费存储空间"
    },
    {
        kind:"影视媒体",
        href:"https://www.douyin.com/recommend",
        img:"https://lf1-cdn-tos.bytegoofy.com/goofy/ies/douyin_web/public/favicon.ico",
        title:"抖音",
        describe:"抖音让每一个人看见并连接更大的世界，鼓励表达、沟通和记录，激发创造，丰富人们的精神世界，让现实生活更美好。"
    },
    {
        kind:"影视媒体",
        href:"https://www.ixigua.com/",
        img:"https://sf1-cdn-tos.douyinstatic.com/obj/eden-cn/lpqpflo/ixigua_favicon.ico",
        title:"西瓜视频",
        describe:"西瓜视频是一个开眼界、涨知识的视频 App，作为国内领先的中视频平台，它源源不断地为不同人群提供优质内容，让人们看到更丰富和有深度的世界，收获轻松的获得感，点亮对生活的好奇心。"
    },
    {
        kind:"影视媒体",
        href:"http://vip.8kvod.com:888/",
        img:"http://vip.8kvod.com:888/template/mytheme/statics/image/20210121/188e68bdf.png",
        title:"8K影视",
        describe:"全网VIP免费看"
    },
    {
        kind:"前端开发",
        href:"https://www.jsdelivr.com/",
        img:"https://www.jsdelivr.com/favicon.ico",
        title:"jsDelivr",
        describe:"一个免费的开源 CDN快速、可靠和自动化"
    },
    {
        kind:"前端开发",
        href:"https://picx.xpoet.cn/#/upload",
        img:"https://picx.xpoet.cn/assets/logo.206d082d.png",
        title:"PicX",
        describe:"图床神器"
    },
    {
        kind:"前端开发",
        href:"http://tool.chinaz.com/",
        img:"//csstools.chinaz.com/favicon.ico",
        title:"站长之家",
        describe:"站长工具是站长的必备工具。经常上站长工具可以了解SEO数据变化。"
    },
]
