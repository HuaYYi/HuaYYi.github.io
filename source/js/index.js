// var node=document.createElement("option");
// // var textnode=document.createTextNode("假百度");
// node.value="https://www.baidu.com/s,wd,百度一下，你就知道";
// node.innerText='假百度';
// // node.appendChild(textnode);
// document.getElementById("myList").appendChild(node);


function way(way){ 
    var a = way.options[way.selectedIndex].value;
    var text= a.split(",") [0];
    var text1= a.split(",") [1];
    var text2= a.split(",") [2];
    document.getElementById("way").action= text;
    document.getElementById("way_name").name= text1;
    document.getElementById("way_name").placeholder= text2;
};

var html = ""
	for (var i = 0; i < 10; i++) {
		html += "<div>" + "<h2>" + '常用' + "</h2>" + "<ul>" + "<li>" + "<a>" + "<img>" + "<h3>" + 'IconFont' + "</h3>" + "<p>" + '国内最著名的图标搜索及管理平台，300万个图标下载' + "</p>" + "</a>" + "</li>" + "/ul" + "<p>" + "</p>" + "</div>"
	}
	document.querySelector(".body_c").innerHTML = html;