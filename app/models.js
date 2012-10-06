var Bookmark = Backbone.Model.extend({
 // url: '/bookmarks',
 defaults:{
   hasHtml: false
 },
  localStorage : new Backbone.LocalStorage('settingsStore'),
  promptColor: function() {
    var cssColor = prompt("Please enter a CSS color:");
    this.set({color: cssColor});
  },
  initialize: function(){
    console.log(this.attributes.url);
    var url = this.attributes.url;
    
    if(isUrl(url)){
      this.set('domain', getDomain(url))
    }else{
      //this can be a bookmarklet, a FTP, or special page bookmark...
    }
    
    //if there's no title, set the domain name or URL?
    
    
  },
  downloadHTML: function(cb){
    var that = this;
    if(!cb)var cb = function(){};
    console.log(this.get('url'));
    $.get(this.get('url'), {},
      function(data, textStatus, jqXHR){
        console.log('horray!');
        console.log(data);
        that.set('html',data);
        that.set('hasHtml',true);
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
  localStorage : new Backbone.LocalStorage('settingsStore'),
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
      var todo = that.where({hasHtml: false});
      if(todo.length >1){
        
        var remaining = todo.length - that.length
        console.log('('+remaining+'/'+that.length+')');
      //  var model = todo[Math.floor(Math.random()*todo.length)]; //pick a random one...
        var model = todo[0];
        model.downloadHTML();
      }else{
        console.log('download complete!...')
        window.clearInterval(that.htmlInterval); // window.clearInterval(app.collection.htmlInterval) /works
      }
      /// call your function here
    }, 1000);
  },
  //////////////////////////////////////////
 //   CHROME IMPORTER
//////////////////////////////////////////
  importChromeBookmarks: function(){
    var that = this;
   
    var bookmarkTreeNodes = chrome.bookmarks.getTree(
      function(bookmarkTreeNodes) {
         console.log(bookmarkTreeNodes);
        that.parseChromeBookmarkTree(bookmarkTreeNodes); //start the recursive process
        that.render();
      });
  },
  parseChromeBookmarkTree: function(tree){
    var that= this
    _.each(tree, function(n){
    if (n.children && n.children.length > 0) {//it's a folder
      that.parseChromeBookmarkTree(n.children);
    }else{ //it's a URL
        that.addChromeBookmark(n);
    }
    })//eo each
  },
  addChromeBookmark: function(tree){
    //TODO: cleanup the garbage in this object...
    //TODO: only add if it doesn't exists...
    this.add({title: tree.title, url:tree.url, dateAdded:tree.dateAdded, id:tree.id}); //add to collection
  },
  
  
  //////////////////////////////////////////
 //   DISPLAY
//////////////////////////////////////////  

  render: function(){
    var html = "";
    var urls = _.pluck(this.models, 'attributes');//returns the naked models
    _.each(urls, function(u) {
      
      html += '<li>';
      html += '<img src="chrome://favicon/'+ u.url +'" class="favicon" />';
      html += '<a href="'+ u.url +'">'+ u.title +'</a>';
      
      html +=' ~ <em class="domain">'+u.domain + '</em>';
      html +='</li>';
    });
    $('#bookmarks').html(html);
  },
  
});

