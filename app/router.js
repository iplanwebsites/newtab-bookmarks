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
	"views/options-page",
	"views/footer",
	"views/header"
],
function( app, $, _, Backbone, applicationView, bookmarksCollection, AllBookmarksView, OptionsPage, Footer, Header ) {
	"use strict";
	
	var MainLayout = Backbone.Layout.extend({
		el: 'body'
	});
	var mainLayout = new MainLayout();
	mainLayout.setViews({
		"#header": new Header(),
		"#footer": new Footer()
	});
	
	var Router = Backbone.Router.extend({
		
		routes: {
			""        : "home",
			"options" : "options"    // #help
		},
		
		
		// ---
		// Routes
		
		home: function() {
			//@TODO: close popup
			mainLayout.setViews({
				'#stage': new AllBookmarksView()
			}).render()
				.then(function() {
					// Trigger scroll to force start of lazyloading
					$(window).trigger('scroll');
				});
			this.page('home');
		},
		
		options: function() {
			mainLayout.setViews({
				'#stage': new OptionsPage()
			}).render();
			this.page('options');
		},
		
		
		// ---
		// Helpers
		
		page: function( p ) {
			// @todo: Delete this section (Change layout insted of show/hide)
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
		}
		
	});
	
	app.router = new Router();
	
	return app.router;
	
});
