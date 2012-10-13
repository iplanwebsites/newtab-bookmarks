
//var db = openDatabase("todos", "", "Backbone-websql example", 1024*1024);

var Bookmark = Backbone.Model.extend({
 // url: '/bookmarks',
 defaults:{
   hasHtml: false,
   title: 'website',
   color: [200,200,200]//rgb
 },
 //store: new WebSQLStore(db, "todos"),
  localStorage : new Backbone.LocalStorage('whatever2'),
  promptColor: function() {
    var cssColor = prompt("Please enter a CSS color:");
    this.set({color: cssColor});
  },
  initialize: function(){
    //console.log(this.attributes.url);
    var url = this.get('url') || '';
    
    if(isUrl(url)){
      this.set('domain', getDomain(url));
    }else{
      //this can be a bookmarklet, a FTP, or special page bookmark...
      this.set('domain', false);
      console.log('not a URL:', url);
    }
    //console.log('init model');
    //attach the corresponding view
    this.v = new ItemView({
      model: this,
      id: "item-" + this.id
    });
    
    //set the main category
    if(url.indexOf('.pdf') != -1){
      this.set('filetype', 'pdf');
      
    }else if((url.indexOf('.jpg') != -1) || (url.indexOf('.jpeg') != -1) || (url.indexOf('.png') != -1) || (url.indexOf('.gif') != -1)){
      this.set('filetype', 'image');
    }else{
      
    }
    
    //if there's no title, set the domain name or URL?
    this.save();//save it to LocalStorage right away.
    
  },


  downloadHTML: function(cb){
    var that = this;
    if(!cb)var cb = function(){};
    console.log(this.get('url'));
    $.get(this.get('url'), {},
      function(data, textStatus, jqXHR){
        //that.set('html',data);
        that.set('hasHtml',true);
        var dom = new DOMParser().parseFromString(data, 'text/html');
        var body = dom.body;
        //console.log(dom);
        var includeWhitespace = false;
        var textNodes = getTextNodesIn(body, includeWhitespace); //get all text nodes from the fetched DOM
        texts = _.pluck(textNodes, 'data'); //array of all text STR
          var arrays = _.map(texts, function(t){ return t.split(' ') });
           var words =_.uniq(_.flatten( arrays ));//merge all words arrays into one
           var keywords = _.uniq(_.map(words, function(w){ //lowercase, trim, and exclude punctuation
             w = w.replace(/[\.,\/#!?$%\^&\*;:{}=\_`~()]/g,"").toLowerCase();//w.replace(/[\.,-\/#!$%\^&\*;:{}=\-_`~()]/g,"")
             w = w.replace(/\s{2,}/g," "); //remove dbl whitespace
             w = w.replace(' ',"").replace(' ',"").replace(' ',"");
             w = w.replace(' ',"");
             return w; 
             }));
           /*
           console.log(textNodes);
           console.log(texts);
          console.log(arrays);
          console.log(words);
          console.log(keywords);*/
         // console.log(ms_end - ms_start);
        console.log(keywords.length+' keywords found for '+that.get('url'));
        that.set('keywords',keywords.join(','));
        that.set('hasKeywords', true);
        that.save();
      }).error(function() { 
        console.log('error found!')
        that.set('html','');
        that.set('hasHtml','error');
        that.save(); 
      })
  }
});



var BookmarkCollection = Backbone.Collection.extend({
  model: Bookmark,
  localStorage : new Backbone.LocalStorage('whatever2'),
  //store: new WebSQLStore(db, "todos"),
  saveAll: function(){
    _.each(this.models, function(m){
      m.save();
    });
  },
  scheduleHtmlDownload: function(){
    var that = this;
    this.htmlInterval = window.setInterval(function(){
      console.log('downloading...')
      //find a model with no HTML
      var todo = _.filter(that.models, function(m){ 
        if(m.get('hasHtml') ==false){
          if(m.get('type') != 'facebook_friend') return true;
        }
        return false;//default
      });
      //that.where({hasHtml: false});
      if(todo.length >1){
        
        var remaining = (todo.length - that.length)*-1;
        console.log(remaining/that.length*100);
        var pcnt = Math.floor( (remaining/that.length)*100);
        
        console.log('('+remaining+'/'+that.length+')');
        that.show_html_download_notice(pcnt+'% ('+remaining+'/'+that.length+')')
       var model = todo[Math.floor(Math.random()*todo.length-1)]; //pick a random one...
       //  var model = todo[0];
        model.downloadHTML();
      }else{
        console.log('download complete!...')
         that.stopDownload();// window.clearInterval(app.collection.htmlInterval) /works
         that.show_html_download_complete();
      }
      /// call your function here
    }, 1000);
  },
  stopDownload: function(){
    window.clearInterval(this.htmlInterval); 
    $('.html-download').hide();
  },
  show_html_download_notice: function(count){ //VIEW
    $('.html-download').show();
    $('.html-download strong').html(count);
   },
   show_html_download_complete: function(count){ //VIEW
     $('.html-download-complete').show();
     $('.html-download-complete strong').html(count || this.length);
    },
   
   
  
    //////////////////////////////////////////
   //   meta data
  //////////////////////////////////////////
  computeDomainCounts: function(){
  var models    = _.pluck(this.models, 'attributes');
  var domains    = _.pluck(models, 'domain');
  //console.log(domains);
  result = { };
  for(i = 0; i < domains.length; ++i) {
      if(!result[domains[i]])
          result[domains[i]] = 0;
      ++result[domains[i]];
  }
  var sorted = sortObject(result).reverse(); //_.sortBy(result, function(item){ 
  this.domains = sorted ;
  
  
  //populate the view!!
  var html = '';
  _.each(_.first(this.domains, 5), function(d){
      //console.log(d);
    if(d.value > 1){
      html += '<li data-domain="'+d.key+'"><a><i class="icon-globe"></i>'+d.key+' <em>('+d.value+')'+'</em></a></li>'
    }
  })
  $('.category .sites').html(html);
  
  return sorted;
  },
  
  computeFolders: function(){
    var foldersArray = this.all('folder');
   var stringnified = _.map(foldersArray, function(f){
     if(f) return f.join(' > ');
    });
    var html = '';
    var folders = _.uniq(stringnified).sort()
    folders = _.first(folders, 15)
    _.each(folders, function(f){
      console.log(f);
      if(f) html+= ' <li><a href="#folder/'+f+'" data-folder="'+f+'"><i class="icon-folder-close"></i>'+f+'</a></li>';
    });
    $('.category .folders').html(html);
    return stringnified;
  },
  
  computeSources: function(){
    /*<li><a href="#source/chrome" class="type_chrome"><i class="icon-star"></i>Browser Bookmarks</a></li>
    <li><a href="#source/twitter" class="type_chrome"><i class="icon-retweet"></i>Twitter</a></li>
    <li><a href="#source/delicious" class="type_chrome"><i class="icon-th-large"></i>Delicious</a></li>*/
    var types = this.all('type');
    source = {
      chrome:{
        label: 'Chrome',
        icon: '<i class="icon-star"></i>'
      },
      twitter:{
        label: 'Twitter',
        icon: '<i class="icon-retweet"></i>'
      },
      delicious:{
        label: 'Delicious',
        icon: '<i class="icon-th-large"></i>'
      },
      facebook:{
        label: 'Facebook Posts',
        icon: '<i class="icon-comment"></i>'
      } ,
      facebook_like:{
        label: 'Facebook Likes',
        icon: '<i class="icon-thumbs-up"></i>'
      } ,
      facebook_friend:{
         label: 'Facebook Friends',
         icon: '<i class="icon-user"></i>'
      }
    };
    var html='';
    _.each(types, function(t){
     // console.log(t);
      var data = source[t];
      //console.log(data);
      var count = app.collection.where({type: t}).length;
      if(t) html+= ' <li><a href="#source/'+t+'" data-source="'+t+'">'+ data.icon + data.label +' <em>('+count+')'+'</em></a></li>';
    });
    $('.category .sources').html(html);
    return types;
  },
  
  computeKeywords: function(){
    
    var models    = _.pluck(this.models, 'attributes');
   // console.log(models);
    //console.log(_.pluck(models, 'keywords'));
    var keywords    = _.flatten(_.pluck(models, 'keywords'));
    var keywords_uniq    = _.uniq(keywords);
    console.log(keywords.length);
    console.log(keywords_uniq.length);
    //return keywords;
  },
  //////////////////////////////////////////
 //   CHROME IMPORTER
//////////////////////////////////////////


  importChromeBookmarks: function(){
    var that = this;
   
    var bookmarkTreeNodes = chrome.bookmarks.getTree(
      function(bookmarkTreeNodes) {
         console.log(bookmarkTreeNodes);
        that.parseChromeBookmarkTree(bookmarkTreeNodes, new Array()); //start the recursive process
        that.render();
      });
  },
  parseChromeBookmarkTree: function(tree, folder){ //recursive function
    var that= this
    console.log(folder.join('>'));
    console.log('tree',tree)
    _.each(tree, function(n){
    if (n.children && n.children.length > 0) {//it's a folder
      var path = _.uniq(folder);
      if(n.title) path.push(n.title); //add the folder name to the list 
      that.parseChromeBookmarkTree(n.children, path);
    }else{ //it's a URL
        that.addChromeBookmark(n, folder);
    }
    })//eo each
  },
  addChromeBookmark: function(tree, folder){
    //TODO: cleanup the garbage in this object...
    //TODO: only add if it doesn't exists...
//    console.log(tree);
   /* var lastVisit = tree.lastVisitTime;
    console.log('lastVisit', lastVisit);*/
    this.add({title: tree.title, url:tree.url, id:tree.id, type:'chrome', dateAdded: tree.dateAdded, folder: folder }); //add to collection
    //alert(m);
  },
  
  importNewChromeBookmarks: function() { //a collection is present, we check if the counts match...
    var alreadyThere = this.where({type: "chrome"});
    console.log(alreadyThere.length+' chrome bookmarks already there...');
    
  },
  

   //////////////////////////////////////////
  //   delicious
 //////////////////////////////////////////
  addDelicious: function(deliciousUser, cb){
    var that = this;
    
    app.setting.set('delicious_user', deliciousUser);
    var delicious_url = 'http://feeds.delicious.com/v2/json';
    var del_count = '?count=9999'; //TODO: there's a maximum of 100 entries...
    //var deliciousUser = 'ayudantegrafico';//'sigamani7977'; //TEST
    var url = delicious_url+'/'+deliciousUser+del_count;
   console.log(url);
    $.getJSON(url, function(data) {
     // console.log('addDelicious', data);
      _.each(data, function(d) {
       // console.log(d);
        //what do we do for ID??
        
        
       if(app.collection.where({url: d.u}).length ==0) {//Make sure the URL is NOT already indexed... avoid duplicates...
        var dateAdded = new Date(d.dt).getTime();
        var keywords = d.t;
        if((typeof keywords === 'string') || (!keywords)){ //if it's an array, and not an empty str...
          keywords = keywords+',delicious';//it's already a string..
        }else{
        //  console.log(keywords);
          keywords = keywords.join(',')+',delicious';
        }
        var m = that.add({title: d.d, url:d.u , type:'delicious', dateAdded: dateAdded, keywords: keywords }); //add to collection
       }else{//end if
        console.log('not importing duplicate:',d.u);
       }
      });
      cb();
      that.render();//refresh the collection, so these new elements appears!...
    });
    //"#{delicious_url}/popular#{@count}"

    //#{delicious_url}/#{username}/#{tags.split.join '+'}#{@count}"
    //    result = get_json "#{delicious_url}/recent#{@count}"
    
    
    //alert(m);
  },
    //////////////////////////////////////////
   //   FACEBOOOK
  //////////////////////////////////////////
  
  
  updateFacebookLinks: function(){
    if(! localStorage.accessToken) {
      return false;
    }else{
      //we have a token, but no FB sites.
      var types = app.collection.all('type'); //["facebook", "chrome", "facebook_like", "facebook_friend"]
        var fbCount = app.collection.where({type: 'facebook'}).length;
        if(fbCount ==0){
          this.addFacebook(5000, function(){
            alert('done!')
          });
        }else{
          this.updateFacebook();
        }
     return true;//with other    
    }
    
  },
  updateFacebook: function(){
    //TODO: function that re-fetch the facebook, and all the newest content
  },
  addFacebook: function(feed_count, callback){
    if(!callback)callback = function(){}
    if(!localStorage.accessToken) return false;
     var me = "https://graph.facebook.com/me?" + localStorage.accessToken;
      var feed = "https://graph.facebook.com/me/feed?limit="+(feed_count || 500)+"&" + localStorage.accessToken;
       var likes = "https://graph.facebook.com/me/likes?fields=website,name,category,description,username&" + localStorage.accessToken;
       var fql = "select uid, name, website from user where uid IN (select uid2 from friend where uid1=me())";
       var websites = "https://graph.facebook.com/fql?q="+fql + '&'+localStorage.accessToken;
       //q=SELECT+uid2+FROM+friend+WHERE+uid1=me()&access_token=...
       //https://graph.facebook.com/fql?q=select%20uid,%20name,%20work_history,%20work,%20education_history,%20current_location%20from%20user%20where%20uid%20IN%20(select%20uid2%20from%20friend%20where%20uid1=me)access_token=AAAEfVi4krooBAOJfqvQQqkQSc8ZAHkpZCOAC6uvDXLYnZBHUEZCK7qx8H7bfuXRbh7SvTJVHOVD6F1r2HvMUdatbvcT0hIhy9Iy9PZAAZC9QZDZD     
 //?q=select%20uid,%20name,%20work_history,%20work,%20education_history,%20current_location%20from%20user%20where%20uid%20IN%20(select%20uid2%20from%20friend%20where%20uid1=me)access_token=AAAEfVi4krooBAOJfqvQQqkQSc8ZAHkpZCOAC6uvDXLYnZBHUEZCK7qx8H7bfuXRbh7SvTJVHOVD6F1r2HvMUdatbvcT0hIhy9Iy9PZAAZC9QZDZD&expires_in=5983      
      var that = this;
      console.log(feed);
      
      
      
      
      
      
      async.parallel([
          function(cb){
               $.getJSON(feed, function(data) {
                  console.log('feed', data);
                  // var data = data.data;
                  var links = [];
                  _.each(data.data, function(i){
                    //TODO: find a better FQL query to only get the LINK status, no noise.
                    var isGarbage= false;//flag
                    if((i.link) && (i.type!='photo') && (i.type=='link') ){ // the status has to be a link!!!
                      if(i.application){
                        if(i.application.name == 'Pages') isGarbage = true;
                      }
                      if(! isGarbage){
                        links.push( i.link);
                        var title = i.name || i.link;
                        var keywords = i.name + ','+i.link;
                        var dateAdded =  new Date(i.created_time).getTime() || 0;
                        var m = that.add({title: title, url: i.link, id:i.link, type:'facebook', dateAdded: dateAdded, keywords: keywords });
                      }

                    }
                  });
                  console.log(links.length + ' sites added from FEED',links);
                  cb();
                  //return links
                });
              
          },
          function(cb){
              console.log(likes);
              $.getJSON(likes, function(data) {
                console.log('likes', data);
                _.each(data.data, function(i){
                  var date = new Date(i.created_time).getTime() || 0;
                  var url_fb =  'http://www.facebook.com/'+i.id;
                  //var page_url = 'http://www.facebook.com/'+i.id;
                  //website,name,category,description,username
                  if(i.website){
                     var page_url = urlize(_.first(i.website.split(' '))); //returns the first valid domain...
                  }else{
                     var page_url = undefined;
                  }
                  
                   if(isUrl(page_url)){
                     var u = page_url;
                   }else{
                     var u = url_fb;//the facebook page...
                   }
                  var m = that.add({title: i.name, uid:i.id,  id:i.id, url: u, url_fb:url_fb, type:'facebook_like', dateAdded: date, keywords: 'like,facebook,'+i.category, description:i.description });
                });
                cb();
                /*category: "Non-profit organization"
                created_time: "2012-10-09T21:47:02+0000"
                id: "140669232641739"
                name: "FNC Lab"*/
                //return data
              });
              
          },
          function(cb){
               console.log(websites);
                $.getJSON(websites, function(data) {
                 // console.log('WEBSITE data.data:',data.data);
                  _.each(data.data, function(i){
                   // dateAdded = 
                   var friend_url = 'http://www.facebook.com/'+i.uid;
                  // console.log(friend_url);
                   var m2 = that.add({title: i.name, uid:i.uid, id:i.uid,  url: friend_url , type:'facebook_friend', dateAdded: 0, keywords: 'friend,facebook'+i.name });

                    if((i.website != '') && (i.website) && (i.website != null) && (i.website != 'null')){ //if this friend has a webite...
                      var sites = i.website.split(/\r\n|\r|\n/);
                      _.each(sites, function(s){
                        var u = urlize(s);
                        if(isUrl(u)){
                         // console.log(i.name+' : '+u)
                          var keywords ='facebook, friend, friends,'+i.name;
                          var m = that.add({title: i.name+"'s website", id:u, url: u , type:'facebook', dateAdded: 0, keywords: keywords });
                        }
                      });
                      //links.push( i.link);
                    }

                  });
                  cb();
                  //console.log('websites', data);
                  //return data
                });
              
          },
          function(cb){
                $.getJSON(me, function(data) {
                  console.log('me', data);
                  app.setting.set('fb_user', data);
                  cb();
                });
          },
      ],
      // optional callback
      function(err, results){ //DONE!
        console.log('DONE FETCHING FB DATA');
          that.render();
          app.setting.set('hasFb', true);
          callback();//call the big Callback!
      });
      
      
   },
 
  
   //////////////////////////////////////////
  //   tools
 //////////////////////////////////////////
  
  comparator: function(m){
     return m.get(this.sortOrder) *-1;
   },
  
  all: function(prop){ //return all props
    return _.uniq(_.pluck(_.pluck(c.models, 'attributes'), prop))
  },
  //////////////////////////////////////////
 //   DISPLAY
//////////////////////////////////////////  

  render: function(){
    var that =this;
    
    app.ui.set_title();
    this.computeDomainCounts(); //populate the dropdown for sites list
    this.computeFolders();
    this.computeSources();
    _.defer(function(){
      that.setBgColors();
    });
    $('#bookmarks').html('');
    var items = _.sortBy(this.models, function(m){ 
     // console.log('sort: ' + m.get(this.sortOrder));
     var s = m.get(that.sortOrder);
     if(that.sortOrder == 'dateAdded'){
      return s*-1; 
      }else{
        return s;
      }
    });
    
    //_.sortBy([1, 2, 3, 4, 5, 6], function(num){ return Math.sin(num); });
    _.each(items, function(m){
      m.v.attach(); //re-attach the items.
    })
    
  },
  sortOrder:'dateAdded',
  setBgColors: function(){ //get or analyse the dominant color of this favion img...
    var that = this;
    $('img.favicon').each(function(me){
      var model = app.collection.get( $(this).parent().parent().attr('data-id') );
      if(model.get('dominantColor')){
        var color = model.get('dominantColor'); //get saved color.
       // console.log('cached color...', color);
      }else{
        console.log('COMPUTE COLOR2');
         var color = getDominantColor($(this));
         model.set('dominantColor',color);/// save color into the model...
         model.save();
      }
      if((color[0] =148 )&&(color[1] ==148 )&&(color[2] ==148 )){
        //this is the default chrome icon... problem...
      }else{
        $(this).parent().parent().find('.thumb_wrap').css('background-color', "rgb("+color[0]+"," + color[1] + "," + color[2] + ")");
      }
      
    })
  }
  
}

  


);

