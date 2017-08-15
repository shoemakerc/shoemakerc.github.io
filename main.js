$(document).ready(function() {
  var count = 0;
  var tolerance = 2500;
  $("#blogs-submenu").hide();
  $("#blogs").mouseenter(function() {
    count++;
    $("#blogs-submenu").slideDown(750);
  }).mouseleave(function() {
    count--;
    setTimeout(function() {
      if (!count) {
        $("#blogs-submenu").slideUp(750);
      }
    }, tolerance);
  });
});