$(document).ready(function() {
  var count = 0;
  var tolerance = 5000;
  $("#blog-menu").hide();
  $("#blog").mouseenter(function() {
    count++;
    $("#blog-menu").slideDown(750);
  }).mouseleave(function() {
    count--;
    setTimeout(function() {
      if (!count) {
        $("#blog-menu").slideUp(750);
      }
    }, tolerance);
  });
});