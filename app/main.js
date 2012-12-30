/**
 * Main.js - Bootstrap the application (required from config.js)
 *
 * @todo: Move most of the app initialization code in here when the components dependencies
 *        are made more flexible
 * 
 */
/*global require:true, define:true, chrome:true */

define([
	"app",
	"jquery",
	"underscore",
	"backbone",
	"router",
	"models/settings",
	"instances/all-bookmarks"
],
function( app, $, _, Backbone, router, settings, bookmarksCollection ) {
	"use strict";
	
	// ---
	// Get settings
	
	settings.fetch();
	
	
	// ---
	// Get Bookmarks
	
	var modelsFetching = new $.Deferred();
	bookmarksCollection.fetch({
		success: function( collection, response ) {
			require(["modules/bookmarks.chrome"], function( chromeBookmarks ) {
				chromeBookmarks.fetch().then(function() {
					modelsFetching.resolve();
				});

			});
		}
	});

	
	// ---
	// Fetch data
	
	modelsFetching.done(function() {
		
		//bookmarksCollection.updateFacebookLinks();
		
	});
	
	
	// ---
	// Launch Router
	
	Backbone.history.start();
	
});
