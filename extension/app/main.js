/**
 * Main - Bootstrap the application (required from config.js)
 */

define([
	"app",
	"jquery",
	"underscore",
	"backbone",
	"instances/settings",
	"instances/all-bookmarks",
	"views/all-bookmarks",
	"views/footer",
	"views/header"
],
function( app, $, _, Backbone, settings, bookmarksCollection, AllBookmarksView, Footer, Header ) {
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

		// Fetch Delicious bookmarks
		require([ "modules/bookmarks.delicious" ], function( deliciousBookmarks ) {
			deliciousBookmarks.fetch();
		});

	}


	// ---
	// Init Application view

	var mainLayout = new Backbone.Layout({
		el: 'body'
	});
	mainLayout.setViews({
		"#header" : new Header(),
		"#footer" : new Footer(),
		"#stage"  : new AllBookmarksView()
	}).render();
	

	// ---
	// Listen click on a tags and open link in current Tab

	$(document).on('click', 'a[href^=http]', function( e ) {
		var url = $(this).attr('href');
		if( !e.ctrlKey ) {
			chrome.tabs.update( null, { url: url });
			window.close();
		}
	});
	$(document).on('click', 'a[href^=javascript]', function( e ) {
		var script = decodeURIComponent( $(this).attr('href').replace('javascript:','') );
		chrome.tabs.executeScript( null, { code: script });
		window.close();
		e.preventDefault();
	});
});
