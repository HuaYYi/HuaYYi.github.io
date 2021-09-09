var sss =false
for (var i = 0; i < target_url.length; i++){
    var tags = document.getElementsByTagName("ul");
    for (var k = 0; k < tags.length; k++) {
        sss=true;
        if (tags[k].getAttribute("name") == target_url[i].kind) {
            var li=document.createElement("li")
            var li_a= li_a = "<a href= " + target_url[i].href + " target='_blank'>" + "<img src=" + target_url[i].img + " ait='图'>" + "<h3>" + target_url[i].title + "</h3>" + "<p>" + target_url[i].describe + "</p>" + "</a>"; 
            li.innerHTML=li_a
            tags[k].insertBefore(li,tags[k].childNodes[0]);
            break
        }
        else {
            sss=false
        }
    };
    if (!sss) {
        var div=document.createElement("div");
        var div_n= div_n= "<h2>" + target_url[i].kind + "</h2>" + "<ul name=" + target_url[i].kind + ">" + "<li>" + "<a href= " + target_url[i].href + " target='_blank'>" + "<img src=" + target_url[i].img + "  ait='图'>" + "<h3>" + target_url[i].title + "</h3>" + "<p>" + target_url[i].describe + "</p>" + "</a>" + "</li>" + "<p>" + "</p>" + "</ul>";
        div.innerHTML=div_n;
        var list =document.getElementById("ff");
        // 向上插入
        // list.insertBefore(div,list.childNodes[0]);
        // 向下插入
        list.appendChild(div);
    } ;
}



// var tags = document.getElementsByTagName("ul");
// var div = "";
// var li = "";
// var count = 0;
// for (var i = 0; i < target_url.length; i++) {
//     for (var k = 0; k < tags.length; k++) {
//         if (i < 1) {
//             div = "<div>" + "<h2>" + target_url[i].kind + "</h2>" + "<ul name=" + target_url[i].kind + ">" + "</ul>" + "</div>";
//             document.querySelector(".body_c").innerHTML = div;

            
//         } 
//         if (tags[k].getAttribute("name") == target_url[i].kind) {
//             li ="<li>" + "<a href=" + target_url[i].href + " target='_blank'>" + "<img src=" + target_url[i].img + ">" + "<h3>" + target_url[i].title + "</h3>" + "<p>" + target_url[i].describe + "</p>" + "</a>" + "</li>" + "<p>" + "</p>";
//             tags[k].innerHTML = li;
//         }
        
//     }
// }	 


// var node=document.createElement("option");
// // var textnode=document.createTextNode("假百度");
// node.value="https://www.baidu.com/s,wd,百度一下，你就知道";
// node.innerText='假百度';
// // node.appendChild(textnode);
// document.getElementById("myList").appendChild(node);


// var div = "";
// 	for (var i = 0; i < target_url.length; i++) {
// 		div += "<div>" + "<h2>" + target_url[i].kind + "</h2>" + "<ul name=" + target_url[i].kind + ">" + "</ul>" + "</div>";        
// 	};
//     document.querySelector(".body_c").innerHTML = div;


// var tags = document.getElementsByTagName("ul");
// var li = "";
// var count = 0;
// for (var g = 0; g < target_url.length; g++) {
//     for (var k = 0; k < tags.length; k++) {
//         if (tags[k].nodeType == 1) {
//             if (tags[k].getAttribute("name") == target_url[g].kind) {
//                 li +="<li>" + "<a href=" + target_url[g].href + " target='_blank'>" + "<img src=" + target_url[g].img + ">" + "<h3>" + target_url[g].title + "</h3>" + "<p>" + target_url[g].describe + "</p>" + "</a>" + "</li>" + "<p>" + "</p>";
//                 tags[k].innerHTML = li;                
//             }
//         }
//     }
//     console.log(k)
//     console.log(g)
// }


// var html = "";
// 	for (var i = 0; i < target_url.length; i++) {      
// 		html += "<div>" + "<h2>" + target_url[i].kind + "</h2>" + "<ul>" + "<li>" + "<a href=" + target_url[i].href + " target='_blank'>" + "<img src=" + target_url[i].img + " alt=" + target_url[i].title + " >" + "<h3>" + target_url[i].title + "</h3>" + "<p>" + target_url[i].describe + "</p>" + "</a>" + "</li>" + "<p>" + "</p>" + "</ul>" + "</div>";     
// 	};
// 	document.querySelector(".body_c").innerHTML = html;

