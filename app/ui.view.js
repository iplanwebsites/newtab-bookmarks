
Setting = Backbone.Model.extend({
  localStorage : new Backbone.LocalStorage('settings2'),
  id: 1 //there's duplicates otherwise...
});

var UiView = Backbone.View.extend({
  
  events: {
     // "click .icon":          "open",
    //  "click .button.edit":   "openEditDialog",
     "click .favourites_sites .sites a": "favourites_sites",
     'click .clearSearch':      'clearSearch',
     'click #bookmarks li':      'click_item',
     'click .viewmode .btn':      'viewmode'
    },
  render: function() {
      return this;
    },
    render_options:function(){
      console.log('opt');
      $('#options .totals h1 strong').html(app.collection.length);
      $('#options .chrome .count').html(app.collection.where({type: "chrome"}).length);
      
    },
    viewmode: function(ev) {
      el = ev['currentTarget'];
      if($(el).hasClass('grid')){
         this.set_viewmode('grid');
         $('#zoom_level').show();
         app.setting.set('viewmode', 'grid');
         app.setting.save();
      }else{
        this.set_viewmode('list');
        $('#zoom_level').hide();
        app.setting.set('viewmode', 'list');
        app.setting.save();
      }
    },
    set_viewmode: function(mode){
      this.top();
      if(mode =='grid'){
         $('body').addClass('grid').removeClass('list');
      }else{
        $('body').removeClass('grid').addClass('list'); 
      }
    },
    top: function(){
      $(window).scrollTop(0)
    },
    click_item: function(ev) {
      ev.preventDefault();
      var u = $(ev['currentTarget']).attr('data-url');
       app.ui.getUrl(u);
       return false;
    },
    initialize: function() {
      var that = this;
     this.render();
     //var zoom = sammy.cookie.get('zoom_level'); //TODO: use alternative cookie setter/getter
     
   		 //$('body').addClass('zoom'+zoom);
   	 
      
      //wire zoom slider
      $('#zoom_level').change(function(){
    		var val = $(this).val(); //vary from 0-100
    		app.ui.set_zoom(val);
    		app.setting.set('zoomVal', val);
         app.setting.save();
    	});
      
    },
    set_zoom: function(val){ //receive a val between 0-100
      
      
      quadraticVal = Math.sqrt(val) * Math.sqrt(100); //we change the progress ratio, so it reflect the real box sizes
      
  		var min_cols = 2;
  		var max_cols = 10;
  		var slots =  (max_cols - min_cols); //100 / 8 cols = 
      var slotW = 100 / slots;
  		//zoom = Math.floor(val / slotW)+min_cols;
      var zoom = (slots-Math.round(val / slotW)) +min_cols;
  	//	console.log('slider = '+val)
  		//val = 8-val; //reverse slider...
  	//	console.log('zoom now set to:'+zoom);
  		if(zoom != this.zoomLevel){//if we face a new number of col!
  		  this.top();
  		  var className = 'zoom' + zoom;
    		$('body').removeClass('zoom1 zoom2 zoom3 zoom4 zoom5 zoom6 zoom7 zoom8 zoom9 zoom10 zoom11 zoom12')
    		$('body').addClass(className);
    		this.zoomLevel = zoom; //save itl
  		}
  		
  		//sammy.cookie.set('zoom_level', val); //TODO: use native or jqeury cookie??
    },
    
    favourites_sites: function(ev){
      //console.log('ok');
      ev.preventDefault();
      var domain = $(ev['currentTarget']).parent().attr('data-domain');
      $('#search').val(domain);
      this.search(domain);
      console.log('favourites_sites', domain)
    },
    search: function(search){
       //console.log('search: '+search, search);
       this.top();
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
             if(matchKeywords(search, a.keywords)){
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
      //ev.preventDefault();
      $('#search').val('');
      this.search(''); //for sorting purpose (isotope)
    },
    getUrl:function(u){
      $('#cache').show();
      window.location=u;
      //TODO: do NOT populate the history stack (so we dont show a back BT)

    }
});























