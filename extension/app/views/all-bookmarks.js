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

		events: {
			"mouseenter .single-bookmark": "hoverAction"
		},

		initialize: function() {
			this.collection = allBookmarks;

			// Listen for search
			searchCriterias.keywords.on('change:value', this.filter, this);
			searchCriterias.category.on('change', this.filter, this);

			$(document).on('keydown', _.bind(this.keyAction, this));
			this.on('change:focus', this.setScroll);
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
		},

		// ---
		// Key UI

		hoverAction: function( e ) {
			var focus = this.$('.js-focus');

			if( focus.length ) {
				focus.removeClass('js-focus');
			}

			$(e.currentTarget).addClass('js-focus');
		},

		keyAction: function( e ) {
			switch( e.keyCode ) {
				case 38:
					this.go('prev');
					break;
				case 40:
					this.go('next');
					break;
				case 37:
					this.go('prev');
					break;
				case 39:
					this.go('next');
					break;
				case 13:
					this.enterPress();
					break;
			}
		},

		go: function( dir ) {
			var focus = this.$('.js-focus');

			if( !focus.length ) {
				this.$('.single-bookmark').first().addClass('js-focus');
				return;
			}

			var next = focus[ dir ]('.single-bookmark');
			if( !next.length ) { return; }

			focus.removeClass('js-focus');
			next.addClass('js-focus');
			this.trigger('change:focus', next);
		},

		enterPress: function() {
			var focus = this.$('.js-focus');

			if( !focus.length ) { return; }

			focus.find('a').trigger('click');
		},

		setScroll: function( focused ) {
			var index = focused.index();

			if( index <= 3 ) { return; }

			var scrollTo = this.$('.single-bookmark').eq( index - 3 );
			this.$el.nanoScroller({ scroll: scrollTo });

		}
		
	});
	
	return BookmarksView;

});
