/**
 * All Bookmarks view
 */
/*global require:true, define:true */

define([
	"app",
	"jquery",
	"underscore",
	"backbone",
	"models/collection-bookmarks",
	"views/single-bookmark",
	"jquery.lazyload"
],
function( app, $, _, Backbone, bookmarks, BookmarkView ) {
	"use strict";
	
	var BookmarksView = Backbone.Layout.extend({
		
		id : "bookmarks",
		tagName : "ul",
		
		beforeRender: function() {
			bookmarks.each(function( model ) {
				this.insertView( new BookmarkView({ model: model }) );
			}, this);
		},
		
		afterRender: function() {
			this.$el.find('img').lazyload({
				threshold: 500
			});
		}
		
	});
	
	return BookmarksView;

});
