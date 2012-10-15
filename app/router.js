var Router = Backbone.Router.extend({

  routes: {
    "":                 "home",
    "":                 "home",
    "option":                 "options",    // #help
    "options":                 "options",    // #help
    "search/:query":        "search",  // #search/kiwis
    "search/:query/p:page": "search",   // #search/kiwis/p7
    "source/:query": "source",   // #search/kiwis/p7
    "type/:query": "content_type"
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
  clear_seach: function() {
    $('#search').val('');
  },  
  clear_filters: function(){
    $('.content_types li.active').removeClass('active');
  },
  home: function() {
    //TODO: close popup
    this.page('home');
    this.clear_filters();
    // alert('H');
    // alert('options!');
  },

  search: function(query, page) {
   /* $('#options').hide();
     $('#bookmarks').show();
     $('body').removeClass('options');*/
  },
  source: function(query) {
    this.clear_seach();
    this.clear_filters();
    console.log('source: '+query)
     this.filter_grid(query, function(m, query){ //this functions takes a comparator function that receive the model as a param
       console.log(m.get('type') +'=='+ query);
       console.log(m.get('type') == query);
       return m.get('type') == query; //returns true/false
     });
  },
  filter_grid: function(query, comparator){
    var toShow = [];
      var toHide = [];
     _.each(app.collection.models, function(m){
      if( comparator(m, query) ){//if this model passes the truth test...
         toShow.push(m.v.$el[0]);
      }else{
        toHide.push(m.v.$el[0]);
      }
      /* if(m.get('content_type') == query){
         toShow.push(m.v.$el[0]);
       }else{
         toHide.push(m.v.$el[0]);
       }*/
     });//eo each
     console.log('show', toShow);
     console.log('HIDE ', toHide);
     $(toShow).show();
      $(toHide).hide();
      app.ui.set_title(toShow.length);
  },
  content_type: function(query) { //TODO: refactor to include search and types, no copypasta
    this.clear_seach();
    this.clear_filters();
    
    $('.content_types li.'+query).addClass('active');
    this.filter_grid(query, function(m, query){ //this functions takes a comparator function that receive the model as a param
       return m.get('content_type') == query; //returns true/false
     });
  }
  

});