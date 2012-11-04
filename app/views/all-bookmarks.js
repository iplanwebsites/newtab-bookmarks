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
	"jquery.lazyload"
],
function( app, $, _, Backbone, bookmarks, settings, BookmarkView ) {
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
			settings.on('change:zoomVal', this.setSize, this);
			settings.on('change:viewmode', this.setViewmode, this);
			this.setSize();
			this.setViewmode();
		},
		
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
