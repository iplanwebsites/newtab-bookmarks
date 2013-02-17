/**
 * All Bookmarks view
 */
/*global require:true, define:true */

define([
	"app",
	"jquery",
	"underscore",
	"backbone",
	"instances/all-bookmarks",
	"instances/settings",
	"views/single-bookmark",
	"models/searchCriterias",
	"lazyload"
],
function( app, $, _, Backbone, allBookmarks, settings, BookmarkView, searchCriterias ) {
	"use strict";
	
	var BookmarksView = Backbone.Layout.extend({
		
		id : "bookmarks",
		className: "app-bookmarks",
		tagName : "ul",

		initialize: function() {
			this.collection = allBookmarks;

			// Listen for search
			searchCriterias.keywords.on('change:value', _.debounce(this.filter, 300), this);
			searchCriterias.category.on('change', this.filter, this);
		},
		
		beforeRender: function() {
			this.collection.each(function( model ) {
				this.insertView( new BookmarkView({ model: model }) );
			}, this);
		},
		
		afterRender: function() {
			
			// Execute plugins
			// @todo: would look better with fadeIn effect. But images first need to have a set size
			this.$el.find('img').lazyload({
				threshold: 500
			});
			
			$(window).trigger('scroll');
		},
		
		
		// ---
		// Search function
		
		filter: function() {
			this.collection = allBookmarks.matchSearch( searchCriterias );
			this.render();
		}
		
	});
	
	return BookmarksView;

});
