


var UiView = Backbone.View.extend({
  
  events: {
     // "click .icon":          "open",
    //  "click .button.edit":   "openEditDialog",
     "click .favourites_sites .sites a": "favourites_sites",
     'click .clearSearch':      'clearSearch',
     'click #bookmarks li':      'click_item'
    },
  render: function() {
      return this;
    },
    click_item: function(ev) {
      ev.preventDefault();
      var u = $(ev['currentTarget']).attr('data-url');
       app.ui.getUrl(u);
       return false;
    },
    initialize: function() {
     this.render();
     //var zoom = sammy.cookie.get('zoom_level'); //TODO: use alternative cookie setter/getter
     var zoom= "6";
   	 if(zoom != undefined){
   		 $('#zoom_level').val(zoom);
   		 $('body').addClass('zoom'+zoom);
   	  }
      
    },
    favourites_sites: function(ev){
      console.log('ok');
      ev.preventDefault();
      var domain = $(ev['currentTarget']).parent().attr('data-domain');
      $('#search').val(domain);
      this.search(domain);
      console.log('favourites_sites', domain)
    },
    search: function(search){
       console.log('search: '+search, search);
       var models = app.collection.models//, 'attributes');
       //if search is empty: show all
       if(search ==''){_.each(models, function(m){
         m.v.$el.show();
       })}

       var matchesTitle = _.filter(models, function(m){
         var a = m.attributes;
         var content = ','+a.url+','+a.domain+','+a.title.toLowerCase().split(' ').join(',');//m.keyword.join(',');

         if(matchKeywords(search, content)){
           m.v.setRank(1);
           m.v.$el.show();
           return true
         }else{
           if(a.keywords){
             if(matchKeywords(search, a.keywords.join(','))){
               m.v.setRank(2);
                m.v.$el.show();
                return true
             }
           }
           m.v.$el.hide();
           return false
         }
       });
    },
    setRank: function(r){
      this.$el.attr('data-rank', r); //for sorting purpose (isotope)
    },
    clearSearch: function(ev){
      ev.preventDefault();
      $('#search').val('');
      this.search(''); //for sorting purpose (isotope)
    },
    getUrl:function(u){
      $('#cache').show();
      window.location=u;
      //TODO: do NOT populate the history stack (so we dont show a back BT)

    }
});























