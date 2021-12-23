$(window).on("load", function () {
    const bookmark_id = localStorage.getItem('bookmark_id') || -1;
    $('.first-P').before((index) => '<div data-index="' + index + '" class="bookmarkss" style="text-align:center;color:white;font-weight:bold" ></div>');

    if (bookmark_id >= 0) {
      $('*[data-index="' + bookmark_id + '"]').addClass('actived');
      $('*[data-index="' + bookmark_id + '"]').html('Marque-page');
      $('*[data-index="' + bookmark_id + '"]').attr('id', 'marque_page');
    }

    // $.each($('.page'), function (index, item) {
    //     $(item).attr('data-index', index);

    //     var currentIndex = parseInt($('.page').data('index'));
    //     console.log(currentIndex);
        
    // });
});

$(function() {
  $('.bookmarkss').click(function(event) {
    event.stopPropagation()
    const index = $(this).data("index");
    $(this).html('Marque-page');
    $(this).append('<div class="dragon"> <img src="asset/image/ok.png" alt=""> </div>');
    const isActive = $(this).hasClass('actived');
    $('.bookmarkss').removeClass('actived');
      if (isActive) {
      localStorage.removeItem('bookmark_id');
      $(this).html('');
      $('.dragon').html('');
      } else {
        $('*[data-index="' + index + '"]').addClass('actived');
        localStorage.setItem('bookmark_id', index);
      }
      
  });
});


$(function(){
  var $select = $(".1-100");
  $select.append($('<li style="color:white" >Choisissez votre page</li>'));
  $select.append($('<li></li>').val(0).html('<a onclick="myFunction(this)" href="#marque_page" style="color:red;">Marque-page</a>'));
  for (i=1;i<=68;i++){
      $select.append($('<li></li>').val(i).html('<a onclick="myFunction(this)" href="#page'+ i +'">'+ i +'</a>'))
  }
});

function myFunction(x) {
  x.classList.toggle("change");            document.getElementById("menu").classList.toggle("active");
}

 

