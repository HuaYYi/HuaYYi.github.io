function way(way){ 
    var a = way.options[way.selectedIndex].value;
    var text= a.split(",") [0];
    var text1= a.split(",") [1];
    var text2= a.split(",") [2];
    document.getElementById("way").action= text;
    document.getElementById("way_name").name= text1;
    document.getElementById("way_name").placeholder= text2;
};
function goScrollTop() {
    //把内容滚动指定的像素数（第一个参数是向右滚动的像素数，第二个参数是向下滚动的像素数）
    //向上是负数，向下是正数
    window.scrollBy(0, -100);
    //延时递归调用，模拟滚动向上效果
    scrolldelay = setTimeout('goScrollTop()', 10);
    //获取scrollTop值，声明了DTD的标准网页取document.documentElement.scrollTop，否则取document.body.scrollTop；因为二者只有一个会生效，另一个就恒为0，所以取和值可以得到网页的真正的scrollTop值
    var sTop = document.documentElement.scrollTop + document.body.scrollTop;
    //判断当页面到达顶部，取消延时代码（否则页面滚动到顶部会无法再向下正常浏览页面）
    if (sTop == 0) clearTimeout(scrolldelay);
}
window.onscroll = function () {
    if (document.documentElement.scrollTop + document.body.scrollTop > 100) {
        document.getElementById("scrollto").style.display = "block";
    }
    else {
        document.getElementById("scrollto").style.display = "none";
    }
}

var s1 = '2021-08-27';//设置为你的建站时间
s1 = new Date(s1.replace(/-/g, "/"));
s2 = new Date();
var y = s2.getFullYear();
var m = s2.getMonth()+1;
var days = s2.getTime() - s1.getTime();
var number_of_days = parseInt(days / (1000 * 60 * 60 * 24));
document.getElementById("ym").innerHTML = y+"."+m+"：已运行"+number_of_days+"天";