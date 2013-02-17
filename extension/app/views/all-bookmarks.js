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
	"jquery.lazyload"
],
function( app, $, _, Backbone, allBookmarks, settings, BookmarkView, searchCriterias ) {
	"use strict";
	
	var BookmarksView = Backbone.Layout.extend({
		
		id : "bookmarks",
		tagName : "ul",

		initialize: function() {
			this.collection = allBookmarks;

			// Listen for change on visual settings
			settings.on('change:zoomVal', this.setSize, this);
			settings.on('change:viewmode', this.setViewmode, this);
			
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
			
			this.setSize();
			this.setViewmode();
			$(window).trigger('scroll');
		},
		
		
		// ---
		// Search function
		
		filter: function() {
			this.collection = allBookmarks.matchSearch( searchCriterias );
			this.render();
		},
		
		
		// ---
		// Display helper functions
		
		setSize: function() {
			// @todo: delete reference to body and keep zoom level local to the module
			var zoomVal = settings.get('zoomVal');
			var grid_w = Math.floor( this.$el.innerWidth() / zoomVal );
			var css = '';
			
			css += '.grid #bookmarks >li{height:' + grid_w + 'px;}';
			$('#write_custom_css').html( css );
			
			var className = 'zoom' + zoomVal;
			$('body').removeClass('zoom1 zoom2 zoom3 zoom4 zoom5 zoom6 zoom7 zoom8 zoom9 zoom10 zoom11 zoom12');
			$('body').addClass( className );
		},
		
		setViewmode: function() {
			// @todo: delete reference to body and keep zoom level local to the module
			if( settings.get('viewmode') === 'list' ) {
				$('body').removeClass('grid').addClass('list');
			} else {
				$('body').removeClass('list').addClass('grid');
			}
		}
		
	});
	
	return BookmarksView;

});
