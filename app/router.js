/**
 * Router
 */
/*global require:true, define:true */

define([
	"app",
	"jquery",
	"underscore",
	"backbone",
	"views/application",
	"models/collection-bookmarks",
	"views/all-bookmarks",
	"views/options-page"
],
function( app, $, _, Backbone, applicationView, bookmarksCollection, AllBookmarksView, OptionsPage ) {
	"use strict";
	
	var MainLayout = Backbone.Layout.extend({
		el: 'body'
	});
	var mainLayout = new MainLayout();
	
	var Router = Backbone.Router.extend({
		
		routes: {
			""        : "home",
			"option"  : "options",    // #help
			"options" : "options",    // #help
			"search/:query"        : "search",  // #search/kiwis
			"search/:query/p:page" : "search",   // #search/kiwis/p7
			"source/:query"        : "source",   // #search/kiwis/p7
			"type/:query"          : "content_type"
		},
		
		
		// ---
		// Routes
		
		home: function() {
			//@TODO: close popup
			mainLayout.setViews({
				'#stage': new AllBookmarksView()
			}).render();
			this.page('home');
			this.clear_filters();
		},
		
		options: function() {
			mainLayout.setViews({
				'#stage': new OptionsPage()
			}).render();
			this.page('options');
			//applicationView.render_options();
		},
		
		
		// ---
		// Helpers
		
		page: function( p ) {
			
			applicationView.top();
			
			if ( p === 'options' ) {
				$('#options').show();
				$('#bookmarks').hide();
				$('body').addClass('options');
				$('.navbar li.options').addClass('active');
			} else {
				$('#options').hide();
				$('#bookmarks').show();
				$('body').removeClass('options');
				$('.navbar li.options').removeClass('active');
			}
		},
		
		clear_seach: function() {
			$('#search').val('');
		},
		
		clear_filters: function() {
			$('.content_types li.active').removeClass('active');
		},
		
		
		search: function( query, page ) {
			//$('#options').hide();
			//$('#bookmarks').show();
			//$('body').removeClass('options');
		},
		
		source: function( query ) {
			this.clear_seach();
			this.clear_filters();
			
			// Func takes a comparator function that receive the model as a param
			this.filter_grid( query, function( m, query ) {
				return ( m.get('type') === query );
			});
		},
		
		filter_grid: function( query, comparator ) {
			var toShow = [];
			var toHide = [];
			
			_.each( bookmarksCollection.models, function( m ) {
				//if this model passes the truth test...
				if ( comparator(m, query) ){
					toShow.push( m.v.$el[0] );
				} else {
					toHide.push( m.v.$el[0] );
				}
			});
			
			$(toShow).show();
			$(toHide).hide();
			applicationView.set_title( toShow.length );
		},
		
		content_type: function( query ) { //TODO: refactor to include search and types, no copypasta
			this.clear_seach();
			this.clear_filters();
			
			$('.content_types li.' + query).addClass('active');
			
			// Func takes a comparator function that receive the model as a param
			this.filter_grid( query, function( m, query ) {
				return ( m.get('content_type') === query );
			});
		}
		
	});
	
	app.router = new Router();
	
	return app.router;
	
});
