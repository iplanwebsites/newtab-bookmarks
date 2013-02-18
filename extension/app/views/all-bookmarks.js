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
	"views/single-bookmark",
	"models/searchCriterias",
	"nanoscroller"
],
function( app, $, _, Backbone, allBookmarks, BookmarkView, searchCriterias ) {
	"use strict";
	
	var BookmarksView = Backbone.Layout.extend({
		
		template: "all-bookmarks",
		el: false,

		initialize: function() {
			this.collection = allBookmarks;

			// Listen for search
			searchCriterias.keywords.on('change:value', this.filter, this);
			searchCriterias.category.on('change', this.filter, this);
		},
		
		beforeRender: function() {
			this.collection.each(function( model ) {
				this.insertView( ".app-bookmarks", new BookmarkView({ model: model }) );
			}, this);
		},

		afterRender: function() {
			this.$el.nanoScroller({ scroll: 'top' });
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
