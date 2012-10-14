


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
    
    if(u.color){
     var styles =  "background-color: rgb("+u.color[0]+", " + u.color[1] + ", " + u.color[2] + ")";
    }
    var thumb = this.model.get_thumb_url();
    
    if( u.type =='facebook_like'){ //if it's a FB friend or FB like...
     html += '<div class="thumb_wrap"><img  src="../img/grey_thumb.gif" data-original="'+thumb+'" style="'+styles+'" class="thumb facebook" width="480" height="360" /></div>'; //http://pagepeeker.com/thumbs.php?size=x&url=www.weareacademy.com
    }else if(u.type =='facebook_friend'){
      html += '<div class="thumb_wrap"><img  src="../img/grey_person.gif" data-original="'+thumb+'" style="'+styles+'" class="thumb facebook" width="480" height="360" /></div>'; //http://pagepeeker.com/thumbs.php?size=x&url=www.weareacademy.com
     }else if(u.type =='doc'){
        html += '<div class="thumb_wrap"><img src="../img/grey_docs.gif" data-original="'+thumb+'" style="'+styles+'" class="thumb facebook" width="480" height="360" /></div>'; //http://pagepeeker.com/thumbs.php?size=x&url=www.weareacademy.com
    }else if(u.type =='photo'){
       html += '<div class="thumb_wrap"><img src="../img/grey_photo.gif"data-original="'+thumb+'"  style="'+styles+'" class="thumb facebook" width="480" height="360" /></div>'; //http://pagepeeker.com/thumbs.php?size=x&url=www.weareacademy.com
    }else if(u.type =='video'){
       html += '<div class="thumb_wrap"><img src="../img/grey_video.gif" data-original="'+thumb+'" style="'+styles+'" class="thumb facebook" width="480" height="360" /></div>'; //http://pagepeeker.com/thumbs.php?size=x&url=www.weareacademy.com
    }else{
       html += '<div class="thumb_wrap"><img src="../img/grey_globe.gif" data-original="'+thumb+'"  style="'+styles+'" class="thumb" width="480" height="360" /></div>'; //http://pagepeeker.com/thumbs.php?size=x&url=www.weareacademy.com
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