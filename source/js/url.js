//添加默认图，img加载失败时使用
var ddd ="this.src='source/image/sdcnav-8-2.png';this.onerror=null"
var sss =false
//外层循环，对target_url进行循环
for (var i = 0; i < target_url.length; i++){
    //把html所有的ul标签声明为一个数组
    var tags = document.getElementsByTagName("ul"); 
    //内循环对ul数组循环，通过内部判断找出name=指定内容的ul
    for (var k = 0; k < tags.length; k++) {
        sss=true;
        if (tags[k].getAttribute("name") == target_url[i].kind) {
            //创建一个元素节点li
            var li=document.createElement("li")
            //结构组合
            var li_a= li_a = "<a href= " + target_url[i].href + " target='_blank'>" + "<img src=" + target_url[i].img + " ait='图' onerror=" + ddd + ">" + "<h3>" + target_url[i].title + "</h3>" + "<p>" + target_url[i].describe + "</p>" + "</a>";
            //把结构组合放进li元素里
            li.innerHTML=li_a
            //把li放进此时的ul里
            tags[k].insertBefore(li,tags[k].childNodes[0]);
            //终止循环
            break
        }
        else {
            sss=false
        }
    };
    if (!sss) {
        var div=document.createElement("div");
        var div_n= div_n= "<h2>" + target_url[i].kind + "</h2>" + "<ul name=" + target_url[i].kind + ">" + "<li>" + "<a href= " + target_url[i].href + " target='_blank'>" + "<img src=" + target_url[i].img + "  ait='图' onerror=" + ddd + ">" + "<h3>" + target_url[i].title + "</h3>" + "<p>" + target_url[i].describe + "</p>" + "</a>" + "</li>" + "<p>" + "</p>" + "</ul>";
        div.innerHTML=div_n;
        var list =document.getElementById("ff");
        // 向上插入
        // list.insertBefore(div,list.childNodes[0]);
        // 向下插入
        list.appendChild(div);
    } ;
}