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
	"models/collection-bookmarks",
	"views/application"
],
function( app, $, _, Backbone, router, settings, bookmarksCollection, applicationView ) {
	"use strict";
	
	// ---
	// Get settings
	
	settings.fetch({
		success: function( model, response ) {
			var mode = settings.get('viewmode') || 'grid';
			applicationView.set_viewmode( mode );
			$('.viewmode .btn').removeClass('active');
			$('.viewmode .btn.' + mode).addClass('active');
			
			var zoomVal = settings.get('zoomVal') || 50;
			$('#zoom_level').val( zoomVal );
			applicationView.set_zoom( zoomVal );
		}
	});
	
	
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
				bookmarksCollection.render();
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
		
		$('#search').bind('focus', function( ev ) {
			if ( !$(this).hasClass('dirty') ) {
				//manage the width better.
				$(this).addClass('dirty');
			}
		});
		
		$('#search').bind('keyup change propertychange input paste', _.debounce(function( ev ) {
			var s = $('#search').val();
			s = s.toLowerCase();
			console.log( s );
			applicationView.search(s);
		}, 100));
		
		$('.html-download .stop').click(function( ev ) {
			bookmarksCollection.stopDownload();
		});
		
		_.delay(function() {
			//will start fetching HTML content, and indexing it...
			var fbEnabled = bookmarksCollection.updateFacebookLinks();
			if ( !fbEnabled ) {
				// @TODO: show bar to incite user to add Facebook stuff!
			}
		}, 2000 );
		
		/*_.delay(function() {
			//will start fetching HTML content, and indexing it...
			bookmarksCollection.scheduleHtmlDownload();
		}, 30000 );*/ //inactive 30 sec >>> index html content every 2 seconds...
		
		chrome.omnibox.onInputChanged.addListener(function( str ) {
			window.alert( str );
		});
		
		chrome.history.search({ text: '' }, function( items ) {
			// @TODO: sort bookmarks that are recent or highlight them?
			// http://developer.chrome.com/extensions/history.html
		});
	});
	
	
	// ---
	// Launch Router
	
	Backbone.history.start();
	
});