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
			this.listenTo(this.collection, 'add', _.throttle(this.render, 500));
		},
		
		beforeRender: function() {
			this.collection.each(function( model ) {
				this.add( model );
			}, this);
		},

		afterRender: function() {
			this.$el.nanoScroller({ scroll: 'top' });
		},

		add: function( model ) {
			return this.insertView( ".app-bookmarks", new BookmarkView({ model: model }) );
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
			var ctrlKey = e.ctrlKey;
			switch( e.keyCode ) {
				case 38: // up arrow
				case 37: // left arrow
					this.go('prev', e);
					break;
				case 40: // down arrow
				case 39: // right arrow
					this.go('next', e);
					break;
				case 13: // return|enter key
					this.enterPress();
					break;
			}
		},

		go: function( dir, e ) {
			var focus = this.$('.js-focus');

			if( !focus.length ) {
				this.$('.single-bookmark').first().addClass('js-focus');
				return;
			}

			var method = (dir === 'next') ? 'nextAll': 'prevAll';
			var skip = e.ctrlKey ? 4 : 0;
			var next = focus[ method ]('.single-bookmark').eq(skip);
			if( !next.length ) {
				var def = (dir === 'next') ? 'last' : 'first';
				next = this.$('.single-bookmark')[def]();
			}

			focus.removeClass('js-focus');
			next.addClass('js-focus');
			this.trigger('change:focus', dir, next);
		},

		enterPress: function() {
			var focus = this.$('.js-focus');

			if( !focus.length ) { return; }

			focus.find('a').trigger(new $.Event('click', { ctrlKey: true }));
		},

		setScroll: function( dir, focused ) {
			var index = focused.index();

			if( index <= 3 ) {
				if( dir === 'prev' ) {
					this.$el.nanoScroller({ scroll: this.$('.single-bookmark').first() });
				}
				return;
			}

			var scrollTo = this.$('.single-bookmark').eq( index - 3 );
			this.$el.nanoScroller({ scroll: scrollTo });

		}
		
	});
	
	return BookmarksView;

});
