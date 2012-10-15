var Router = Backbone.Router.extend({

  routes: {
    "":                 "home",
    "":                 "home",
    "option":                 "options",    // #help
    "options":                 "options",    // #help
    "search/:query":        "search",  // #search/kiwis
    "search/:query/p:page": "search",   // #search/kiwis/p7
    "source/:query": "source",   // #search/kiwis/p7
    "source/:query": "type"
  },
  page: function(p){
    app.ui.top();
    if(p == 'options'){
      $('#options').show();
      $('#bookmarks').hide();
      $('body').addClass('options');
      $('.navbar li.options').addClass('active');
    }else{
      $('#options').hide();
       $('#bookmarks').show();
       $('body').removeClass('options');
       $('.navbar li.options').removeClass('active');
    }
  },
  options: function() {
    this.page('options');
    app.ui.render_options();
   // alert('opt');
  },
  home: function() {
    //TODO: close popup
    this.page('home');
    // alert('H');
    // alert('options!');
  },

  search: function(query, page) {
   /* $('#options').hide();
     $('#bookmarks').show();
     $('body').removeClass('options');*/
  },
  source: function(query) {
    this.page('home');
     var delicious = app.collection.where({type: query});
     _.each(app.collection.models, function(m){
       if(m.get('type') == query){
         $(m.v.el).show();
       }else{
         $(m.v.el).hide();
       }
      
     });
  },
  content_type: function(query) {
    this.page('home');
     var delicious = app.collection.where({content_type: query});
     _.each(app.collection.models, function(m){
       if(m.get('type') == query){
         $(m.v.el).show();
       }else{
         $(m.v.el).hide();
       }
     });
  }

});