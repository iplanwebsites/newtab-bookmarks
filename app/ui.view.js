
Setting = Backbone.Model.extend({
  defaults: {
    viewmode:'grid',
    zoomVal: 70
  },
  localStorage : new Backbone.LocalStorage('settings2'),
  id: 1 //there's duplicates otherwise...
});

var UiView = Backbone.View.extend({
  zoomLevel:5,//default number of col
  events: {
     // "click .icon":          "open",
    //  "click .button.edit":   "openEditDialog",
    // "click .favourites_sites .sites a": "favourites_sites",
     "click .category .sites a": "favourites_sites",
     'click .clearSearch':      'clearSearch',
     'click #bookmarks li':      'click_item',
     'click .viewmode .btn':      'viewmode',
     'click  #options .delicious .btn.add':      'add_delicious',
     'click  #options .delicious .btn.remove':      'remove_delicious',
     'click .footer .copyright':   'bt_copyright',
     'click .remove_all': 'remove_all'
    },
    bt_copyright: function(ev){
      //window.location = ;
      console.log('copyright');
      this.getUrl('http://iplanwebsites.com');
    },
    write_custom_css: function(numCol){
      var RATIO_GRID = 1; //1:1
      console.log('write_custom_css')
     // var grid_w = $('#bookmarks >li').first().width(); //TODO: deduce it with the number of col instead... to avoid UI repaind twice...
     // console.log(grid_w);
       var grid_w = Math.floor( $('#bookmarks').first().innerWidth() / this.zoomLevel);
     // console.log(grid_w);
      var css = '';
      
     // css +="div {border: 2px solid black; background-color: blue;} ";
      css += '.grid #bookmarks >li{height:'+grid_w+'px;}';
      $('#write_custom_css').html(css);
    },
    add_delicious: function(ev){
      ev.preventDefault();
      
      var that = this;
      var handle = $('#options .delicious .input').val();
      if(handle == ''){
        alert('please enter your delicious username here');
        }else{
          console.log('importing delicious user: '+handle); //ayudantegrafico
          $(ev['currentTarget']).button('loading');
          app.collection.addDelicious(handle, function(){
            $(ev['currentTarget']).button('reset');
            that.render_options();
            $('#options .delicious .input').val('');
          });
         
        }
      
    },
    remove_delicious: function(ev){
      if(ev)ev.preventDefault();
      
      var that= this;
      var delicious = app.collection.where({type: "delicious"});
      console.log('rm',delicious);
      _.each(delicious, function(m){
        console.log('destroy delicious model1:',m)
        m.destroy({wait: true});
      });
      app.setting.set('delicious_user', false);
      _.delay(function(){//refresh the page...
        that.render_options();
        app.collection.render();
        $('#options .delicious .input').val('');
      },200)
      
      
    },
    remove_all: function(){
      //ev.preventDefault();
      var that= this;
      localStorage.clear();
      app.collection.reset();
      
      /*
      var models = app.collection.models;
      console.log('rm',models);
      _.each(models, function(m){
        //console.log('destroy delicious model1:',m)
        m.destroy({wait: true});
      });
      console.log('done removing....')
      this.remove_delicious();*/
      
      
    },
  render: function() {
      return this;
    },
    render_options:function(){
      console.log('opt');
      $('#options .totals h1 strong').html(app.collection.length);
      $('#options .chrome .count').html(app.collection.where({type: "chrome"}).length);
      var delicious = app.collection.where({type: "delicious"}).length;
      if(delicious){
        $('#options .delicious .count').html(delicious);
        $('#options .delicious .start').hide();
        $('#options .delicious .connected').show();
      }else{
        $('#options .delicious .start').show();
        $('#options .delicious .connected').hide();
      };
      
      //facebook connnect
      var appId = 315929978515082;
       var retUrl = window.location.href; //
       retUrl = 'http://www.facebook.com/connect/login_success.html';
       var url = "https://www.facebook.com/dialog/oauth?client_id="+appId+"&response_type=token&scope=email,read_stream,user_likes,friends_website&redirect_uri="+retUrl;
      $('#fb_connect').attr('href', url);
    
    },
    viewmode: function(ev) {
      el = ev['currentTarget'];
      if($(el).hasClass('grid')){
         this.set_viewmode('grid');
         $('#zoom_level').show();
         $(window).trigger('scroll');//for thumbs to load...
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
      if(mode =='list'){
         this.write_custom_css();//write the css rule for item height
         $('body').removeClass('grid').addClass('list');
      }else{
        $('body').addClass('grid').removeClass('list');
      }
    },
    top: function(){
      $(window).scrollTop(0)
    },
    click_item: function(ev) {
      ev.preventDefault();
      var u = $(ev['currentTarget']).attr('data-url');
      //console.log(ev);
     // alert(ev);
     // $(ev['currentTarget']).find('a').trigger(ev); //
      //TODO: pass the event to the real link to handle ctrl-click? Or just wrap the LI in a A tag?
       app.ui.getUrl(u);
       return false;
    },
    initialize: function() {
      var that = this;
      this.position3d();
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
    	
    	if($('body').hasClass('3dfx')){
    	    $(window).scroll(function(ev){
    	      app.ui.position3d();
    	    });
    	    this.position3d_t= _.throttle(that.position3d, 10);
  	    }//end if 3dfx
      
      $('.tip').tooltip();//wire tooltips.
     $('.bt_modal').modal(); 
      
    },
    position3d:function(ev){
      if($('body').hasClass('3dfx')){
      var DEGREE = 2;
  	  var doc_h = $(document).height();
  	  var viewport_h = $(window).height();
  	  var range = doc_h - viewport_h;
  	  //console.log('range', range);
  	  var ratio = $(window).scrollTop() / range;
  	  
  	  var variation = DEGREE * ratio;
  	  variation = DEGREE- variation; //reverted...
  	  //var r = ((360-(DEGREE/2))+variation) % 360; //reutn 358 - 2 degree
  	   var r = ((360-DEGREE+1)+variation) % 360; //reutn 358 - 2 degree
  	  console.log(r);
  	  transform = 'rotateX('+ r +'deg) rotateY(0deg) rotateZ(0deg)';
           /* logo.style.MozTransform = logo.style.WebkitTransform = 
            logo.style.oTransform = logo.style.MsTransform =
            logo.style.transform = transform;*/
            
  	  $('#bookmarks').css('WebkitTransform', transform);
  	  $('#bookmarks').css('transform', transform);
  	  }
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
    		app.ui.write_custom_css(); //we set the height of the grid rules...
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
    
    set_title:function(num){//udp title bar
      if(num == undefined){
         var digit = app.collection.length 
      }else{
         var digit = num 
      }
      if(digit== 0 ){
        $('title').html('no retults... ');
      }else{
        $('title').html('('+digit+')  ★ ★ ★ ');
      }
      //show the alert if we don'T show anythin...
       if(digit ==0){
         var search = $('#search').val();
          $('.no_results').removeClass('hide').find('strong').html( search );
        }else{
          $(window).trigger('scroll');//load new thumbnails
          $('.no_results').addClass('hide');
        }
      
    },
    search: function(search){
       //console.log('search: '+search, search);
       this.top();
       
       var that = this;
       app.router.page('search');//quit option page, if it'S the case...
          
       app.router.filter_grid(search, function(m, search){ //this functions takes a comparator function that receive the model as a param
          //console.log('search:  ' + search );
          var SEARCH_KEYWORDS = true; //speed testing...
          if(search ==''){
             return true; //blank search, useless to fuss with searching...
           }else{
             var a = m.attributes;
             var content = ','+a.url+','+a.domain+','+a.title.toLowerCase().split(' ').join(',');//m.keyword.join(',');
             if(matchKeywords(search, content)){
              // m.v.setRank(1);
               return true;
             }else{

               if(a.keywords && SEARCH_KEYWORDS){
                 if(matchKeywords(search, a.keywords)){
                  // m.v.setRank(2);
                    return true;
                 }
               }
               return false;
             }
           }
        });// eo filter grid
       
       
       
       
       /*
       
      // var models = app.collection.models//, 'attributes');
       //if search is empty: show all
       if(search ==''){
         _.each(models, function(m){
         toShow.push(m.v.$el[0]);
       })}else{
         
         //keywords parsing
         _.each(models, function(m){
            var a = m.attributes;
            var content = ','+a.url+','+a.domain+','+a.title.toLowerCase().split(' ').join(',');//m.keyword.join(',');

            if(matchKeywords(search, content)){
              m.v.setRank(1);
             // m.v.$el.show();
             toShow.push(m.v.$el[0]);
              return true
            }else{

              if(a.keywords && SEARCH_KEYWORDS){
                if(matchKeywords(search, a.keywords)){
                  m.v.setRank(2);
                  // m.v.$el.show();
                  toShow.push(m.v.$el[0]);
                   return true
                }
              }
              //m.v.$el.hide();
              toHide.push(m.v.$el[0]);
              return false
            }
          });
         
         
       }//end if
       
       that.set_title();//reset title to default

       $(toShow).show();
       $(toHide).hide();
       this.set_title(toShow.length);
       
       */
       
       
       
       
       
       
       
       
     
       
    },
    setRank: function(r){
      //Todo: make this less DOM consuming..., defer it?
      //this.$el.attr('data-rank', r); //for sorting purpose (isotope)
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























