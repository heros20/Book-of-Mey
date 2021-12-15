// window.onload = function () {
// 	const main = document.getElementsByClassName("main")[0];
// 	const page = document.getElementsByClassName("page")[0];

// 	if (main.offsetHeight < 1300) {
// 		page.style.filter = "none";
// 	}
// };

$(window).on("load", function () {
    $(".flexslider").flexslider({
      animation: "slide" 
    });
  });

$(function(){
  var $select = $(".1-100");
  for (i=1;i<=47;i++){
      $select.append($('<li></li>').val(i).html('<a onclick="myFunction(this)" href="#page'+ i +'">Page '+ i +'</a>'))
  }
});

function myFunction(x) {
  x.classList.toggle("change");            document.getElementById("menu").classList.toggle("active");
}

    var pages = document.getElementsByClassName('page');
  for(var i = 0; i < pages.length; i++)
    {
      var page = pages[i];
      if (i % 2 === 0)
        {
          page.style.zIndex = (pages.length - i);
        }
    }

  document.addEventListener('DOMContentLoaded', function(){
    for(var i = 0; i < pages.length; i++)
      {
        //Or var page = pages[i];
        pages[i].pageNum = i + 1;
        pages[i].onclick=function()
          {
            if (this.pageNum % 2 === 0)
              {
                this.classList.remove('flipped');
                this.previousElementSibling.classList.remove('flipped');
              }
            else
              {
                this.classList.add('flipped');
                this.nextElementSibling.classList.add('flipped');
              }
           }
        pages[i].onmousewheel=function()
          {
            if (this.pageNum % 2 === 0)
              {
                this.classList.remove('flipped');
                this.previousElementSibling.classList.remove('flipped');
              }
            else
              {
                this.classList.add('flipped');
                this.nextElementSibling.classList.add('flipped');
              }
           }
      }
  })