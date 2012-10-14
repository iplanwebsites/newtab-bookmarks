


var ItemView = Backbone.View.extend({
  tagName: 'li',
  container: $('#bookmarks'),
  events: {
     // "click .icon":          "open",
    //  "click .button.edit":   "openEditDialog",
      "click .btn.delete": "destroy"
    },
  render: function() {
    var u = this.model.attributes;
    var html = "";
    
    //html += '<li data-id="'+u.id+'" data-url="'+u.url+'">';
    if((u.type =='facebook_friend') || (u.type =='facebook_like')){ //if it's a FB friend or FB like...
      html += '<div class="thumb_wrap"><img src="http://graph.facebook.com/'+u.uid+'/picture?height=360&width=480" class="thumb facebook" width="480" height="360" /></div>'; //http://pagepeeker.com/thumbs.php?size=x&url=www.weareacademy.com
    }else{
       html += '<div class="thumb_wrap"><img src="../img/grey.gif" data-original="http://pagepeeker.com/thumbs.php?size=x&url='+ u.url +'" class="thumb" width="480" height="360" /></div>'; //http://pagepeeker.com/thumbs.php?size=x&url=www.weareacademy.com
    }
     
    html += '<div class="meta">';
    if(u.type =='facebook_friend'){
       html += '<i class="icon-user"></i>';
   }else if(u.type =='facebook_like'){
         html += '<i class="icon-thumbs-up"></i>';
   }else if(u.type =='facebook'){
        html += '<i class="icon-comment"></i>';
    }else{
      html += '<img src="chrome://favicon/'+ u.url +'" class="favicon" />';
    }
    html += '<a href="'+ u.url +'">'+ u.title +'</a>';
    html +=' ~ <em class="domain">'+u.domain + '</em>';
    html +=' ~ <button class="btn delete hide">'+ 'delete' + '</button>';
    html += '</div>';
    
     
    
    
     this.$el.html(html).attr('data-id', u.id).attr('data-url', u.url);
    
    
      return this;
    },
    initialize: function() {
     //  this.$el.append(this.container);
     
     //this.attach();
     //this.model.bind('remove', this.remove); //inherit destroy
      
    },
    attach: function(){
      this.render();// generate the html in the node
      $('#bookmarks').append(this.el);
    },
    destroy: function(){
      alert('destroy this bookmark')
    },
    setRank: function(r){
      this.$el.attr('data-rank', r); //for sorting purpose (isotope)
    }
});