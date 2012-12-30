/**
 * Chrome bookmarks fetcher
 *
 * @info: Collection of helper functions
 * 
 */
/*global require:true, define:true, chrome: true */

define([
	"jquery",
	"underscore",
	"instances/all-bookmarks"
],
function( $, _, allBookmarks ) {
	"use strict";

	var chromeAdapter = {

		fetch: function() {
			return this.importChromeBookmarks();
		},

		importChromeBookmarks: function() {
			var def  = new $.Deferred(),
				self = this;

			chrome.bookmarks.getTree(function( tree, folder ) {
				self.parseChromeBookmarkTree( tree, folder, def );
			});
			def.done(function() {
				var unkeptBookmarks = allBookmarks.filter(function( model ) {
					if ( model.get('type') !== 'chrome' ) {
						return false;
					}
					return !model.get('keep');
				});

				// Delete models who've been removed from Chrome bookmarks
				_.each( unkeptBookmarks, function( model ) {
					model.destroy();
				});
			});

			return def.promise();
		},
		
		// Recurse over the bookmarks tree
		parseChromeBookmarkTree: function( tree, folder, def ) {
			var self   = this,
				folder = folder || [];

			_.each( tree, function( node ) {
				if ( node.children && node.children.length > 0 ) {
					//it's a folder
					var path = _.uniq( folder );
					if ( node.title ) {
						//add the folder name to the list
						path.push( node.title );
					}
					// Recurse over the subtree
					self.parseChromeBookmarkTree( node.children, path );
				} else {
					//it's a URL
					self.addChromeBookmark( node, folder );
				}
			});

			def && def.resolve();
		},
		
		addChromeBookmark: function( bookmark, folder ) {
			var actual = allBookmarks.where({ url: bookmark.url })[0],
				data   = {
					title     : bookmark.title,
					url       : bookmark.url,
					id        : bookmark.id,
					type      : 'chrome',
					dateAdded : bookmark.dateAdded,
					folder    : folder,
					keep      : true // mark this model to be kept
				};
			
			// Add or update collection
			if ( actual ) {
				actual.set( data );
			} else {
				allBookmarks.add( data );
			}
			
		}
	};

	return chromeAdapter;
});
