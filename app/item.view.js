var ItemView = Backbone.View.extend({
  tagName: 'li',
  render: function() {
      $(this.el).html(this.template(this.model.toJSON()));
      return this;
    }
});