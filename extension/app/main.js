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
	// @note: LocalStorage is synchronous, if storage method changes, we'll need to wait
	//        for fetch success to continue
	
	settings.fetch();
	
	
	// ---
	// Get Bookmarks (LocalStorage is Synchronous)
	// @note: LocalStorage is synchronous, if storage method changes, we'll need to wait
	//        for fetch success to continue
	
	bookmarksCollection.fetch();


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
		e.preventDefault();
		var url = $(this).attr('href');
		if( !e.ctrlKey ) {
			chrome.tabs.update( null, { url: url });
			window.close();
		} else {
			chrome.tabs.create({ url: url });
		}
	});
	$(document).on('click', 'a[href^=javascript]', function( e ) {
		var script = decodeURIComponent( $(this).attr('href').replace('javascript:','') );
		chrome.tabs.executeScript( null, { code: script });
		window.close();
		e.preventDefault();
	});
});
