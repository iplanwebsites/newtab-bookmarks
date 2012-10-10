var Router = Backbone.Router.extend({

  routes: {
    "":                 "home",
    "":                 "home",
    "option":                 "options",    // #help
    "options":                 "options",    // #help
    "search/:query":        "search",  // #search/kiwis
    "search/:query/p:page": "search"   // #search/kiwis/p7
  },
 
  options: function() {
    $('#options').show();
    $('#bookmarks').hide();
    $('body').addClass('options');
    app.ui.render_options();
   // alert('opt');
  },
  home: function() {
    //TODO: close popup
    $('#options').hide();
     $('#bookmarks').show();
     $('body').removeClass('options');
    // alert('H');
    // alert('options!');
  },

  search: function(query, page) {
    $('#options').hide();
     $('#bookmarks').show();
     $('body').removeClass('options');
  }

});