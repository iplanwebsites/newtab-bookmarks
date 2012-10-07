


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
    html += '<div class="meta">';
    html += '<img src="chrome://favicon/'+ u.url +'" class="favicon" />';
    html += '<a href="'+ u.url +'">'+ u.title +'</a>';
    html +=' ~ <em class="domain">'+u.domain + '</em>';
    html +=' ~ <button class="btn delete">'+ 'delete' + '</button>';
    html += '</div>';
     html += '<img src="http://pagepeeker.com/thumbs.php?size=x&url='+ u.url +'" class="thumb" />'; //http://pagepeeker.com/thumbs.php?size=x&url=www.weareacademy.com
    
    
    
     this.$el.html(html).attr('data-id', u.id).attr('data-url', u.url);
    
    
      return this;
    },
    initialize: function() {
     //  this.$el.append(this.container);
     this.render();// generate the html in the node
     this.attach();
     this.model.bind('remove', this.remove); //inherit destroy
      
    },
    attach: function(){
      $('#bookmarks').append(this.el);
    },
    destroy: function(){
      alert('destroy this bookmark')
    },
    setRank: function(r){
      this.$el.attr('data-rank', r); //for sorting purpose (isotope)
    }
});