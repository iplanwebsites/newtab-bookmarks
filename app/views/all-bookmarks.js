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
	"models/settings",
	"views/single-bookmark",
	"models/searchCriterias",
	"jquery.lazyload"
],
function( app, $, _, Backbone, bookmarks, settings, BookmarkView, searchCriterias ) {
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
			
			// Execute plugins
			// @todo: would look better with fadeIn effect. But images first need to have a set size
			this.$el.find('img').lazyload({
				threshold: 500
			});
			
			// Set visual defaults
			settings.on('change:zoomVal', this.setSize, this);
			settings.on('change:viewmode', this.setViewmode, this);
			this.setSize();
			this.setViewmode();
			
			// Listen for search
			searchCriterias.keywords.on('change:value', _.debounce(this.filter, 100), this);
			searchCriterias.category.on('change', _.debounce(this.filter, 100), this);
		},
		
		
		// ---
		// Search function
		
		filter: function() {
			var keywords = searchCriterias.keywords.get('value'),
				filterBy = searchCriterias.category.get('filterBy'),
				category = searchCriterias.category.get('value');

			// Loop over all subview to filter them
			this.getViews(function( bookmarkView ) {
				var m = bookmarkView.model;
				
				// Filter out category
				if ( !m.matchCategory(filterBy, category) || !m.matchKeyword(keywords) ) {
					bookmarkView.$el.hide();
					return false;
				}
				
				bookmarkView.$el.show();
				return true;
			});
			
			// Launch manually lazyload on images as there have been no scrolling
			$(window).trigger('scroll');
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
