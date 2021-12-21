$(window).on("load", function () {
    const bookmark_id = localStorage.getItem('bookmark_id') || -1;
    $('.first-P').before((index) => '<div data-index="' + index + '" class="bookmarkss"></div>');

    if (bookmark_id >= 0) {
      $('*[data-index="' + bookmark_id + '"]').addClass('actived');
      $('*[data-index="' + bookmark_id + '"]').attr('id', 'marque_Page');
    }

    // $.each($('.page'), function (index, item) {
    //     $(item).attr('data-index', index);

    //     var currentIndex = parseInt($('.page').data('index'));
    //     console.log(currentIndex);
        
    // });
});

$(function() {
  $('.bookmarkss').click(function(event) {
    const index = $(this).data("index");
    const isActive = $(this).hasClass('actived');
    $('.bookmarkss').removeClass('actived');
      if (isActive) {
      localStorage.removeItem('bookmark_id');
      } else {
        $('*[data-index="' + index + '"]').addClass('actived');
        localStorage.setItem('bookmark_id', index);
      }
      event.stopPropagation()
  });
});
$(function(){
  var $select = $(".1-100");
  $select.append($('<li></li>').val(0).html('<a onclick="myFunction(this)" href="#marque_Page" style="color:red;">Marque-page</a>'))
  for (i=1;i<=47;i++){
      $select.append($('<li></li>').val(i).html('<a onclick="myFunction(this)" href="#page'+ i +'">Page '+ i +'</a>'))
  }
});

function myFunction(x) {
  x.classList.toggle("change");            document.getElementById("menu").classList.toggle("active");
}

 

