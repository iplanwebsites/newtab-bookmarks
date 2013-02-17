/**
 * Single Bookmark view
 *
 * @todo: Remove reference to container. View shouldn't know anything out of his scope
 * 
 */
/*global require:true, define:true */

define([
	"app",
	"jquery",
	"underscore",
	"backbone"
],
function( app, $, _, Backbone ) {
	"use strict";
	
	var BookmarkView = Backbone.View.extend({
		
		tagName: 'li',
		
		template: "single-bookmark",
		
		serialize: function() {
			return this.model.toJSON();
		},

		afterRender: function() {
			this.listenTo( this.model, "change", function( model ) {
				// Ignore `keep` value changes and `folder` (as array are referenced by instances,
				// not value)
				var realChanged = _.omit( model.changed, [ "keep", "folder" ]);

				if ( _.keys(realChanged).length ) {
					this.render();
				}
			});
			this.listenTo( this.model, "destroy", function() {
				this.$el.animate({ "opacity" : 0.4 });
			});
		}
	});
	
	return BookmarkView;

});
