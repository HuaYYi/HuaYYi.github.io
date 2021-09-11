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
        img:"https://github.com/fluidicon.pn",
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
]
