$(window).on("load", function () {
    const bookmark_id = localStorage.getItem('bookmark_id') || -1;
    $('.first-P').before((index) => '<div data-index="' + index + '" class="bookmarkss"></div>');
    // console.log(bookmark_id, $('*[data-index="' + bookmark_id + '"]'))
    if (bookmark_id >= 0) {
      $('*[data-index="' + bookmark_id + '"]').addClass('actived');
      $('*[data-index="' + bookmark_id + '"]').attr('id', 'marque_Page');
    }
  });

$(function(){
  var $select = $(".1-100");
  $select.append($('<li></li>').val(0).html('<a onclick="myFunction(this)" href="#marque_Page">Marque-page</a>'))
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

  $(function() {
    $('.bookmarkss').click(function(event) {
      event.stopPropagation()
      const index = $(this).data("index");
      const isActive = $(this).hasClass('actived');
      $('.bookmarkss').removeClass('actived');
       if (isActive) {
        localStorage.removeItem('bookmark_id');
       } else {
         $('*[data-index="' + index + '"]').addClass('actived');
         localStorage.setItem('bookmark_id', index);
       }
    });
});




