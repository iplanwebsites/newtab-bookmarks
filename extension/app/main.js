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
	"instances/settings",
	"instances/all-bookmarks"
],
function( app, $, _, Backbone, Router, settings, bookmarksCollection ) {
	"use strict";
	
	// ---
	// Get settings
	
	settings.fetch();
	
	
	// ---
	// Get Bookmarks
	
	bookmarksCollection.fetch({
		success: fetchSources
	});

	
	// ---
	// Check bookmarks sources updates
	// @info: triggered after bookmarksCollection fetch is done
	// TODO: Transfer to an event/background page

	function fetchSources() {

		// Fetch Chrome bookmarks
		require([ "modules/bookmarks.chrome" ], function( chromeBookmarks ) {
			chromeBookmarks.fetch();
		});

		require([ "modules/bookmarks.delicious" ], function( deliciousBookmarks ) {
			deliciousBookmarks.fetch();
		});

	}

	// ---
	// Create router
	
	app.router = new Router();
	
});
