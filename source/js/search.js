function way(way){ 
    var a = way.options[way.selectedIndex].value;
    var text= a.split(",") [0];
    var text1= a.split(",") [1];
    var text2= a.split(",") [2];
    document.getElementById("way").action= text;
    document.getElementById("way_name").name= text1;
    document.getElementById("way_name").placeholder= text2;
};