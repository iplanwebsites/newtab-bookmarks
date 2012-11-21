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
	"models/collection-bookmarks"
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
			if ( collection.length < 1 ) {
				console.log('Empty local Collection, fetch Chrome books: ', response);
				bookmarksCollection.importChromeBookmarks();
			} else {
				console.log('Loading bookmarkss from Localstorage cache: '+ collection.length);
				bookmarksCollection.importNewChromeBookmarks(); //check if new bookmarks have been added
			}
			modelsFetching.resolve();
		},
		error: function( collection, response ) {
			console.log('Error in fetching Collection: ', response);
			bookmarksCollection.importChromeBookmarks();
			modelsFetching.reject();
		}
	});
	
	
	// ---
	// Fetch data
	
	modelsFetching.done(function() {
		
		_.delay(function() {
			//will start fetching HTML content, and indexing it...
			var fbEnabled = bookmarksCollection.updateFacebookLinks();
			if ( !fbEnabled ) {
				// @TODO: show bar to incite user to add Facebook stuff!
			}
		}, 2000 );

		chrome.omnibox.onInputChanged.addListener(function( str ) {
			window.alert( str );
		});
		
		// chrome.history.search({ text: '' }, function( items ) {
		// 		// @TODO: sort bookmarks that are recent or highlight them?
		// 		// http://developer.chrome.com/extensions/history.html
		// });
	});
	
	
	// ---
	// Launch Router
	
	Backbone.history.start();
	
});
