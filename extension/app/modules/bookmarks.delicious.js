/**
 * Delicious bookmarks fetcher
 */
/*global require:true, define:true, chrome: true */

define([
	"jquery",
	"underscore",
	"instances/all-bookmarks",
	"instances/settings"
],
function( $, _, allBookmarks, settings ) {
	"use strict";

	var deliciousAdapter = {

		fetch: function() {
			var deliciousUser = settings.get('delicious_user');

			// Fail if no user is setup
			if( !deliciousUser ) {
				return (new $.Deferred()).reject();
			}

			return this.importBookmarks( deliciousUser );
		},

		importBookmarks: function( deliciousUser ) {
			var def  = new $.Deferred(),
				self = this;

			var baseUrl = 'http://feeds.delicious.com/v2/json/';
			var count = '?count=9999';
			var fetchUrl = baseUrl + deliciousUser + count;

			$.getJSON( fetchUrl ).done(function( data ) {
				_.each( data, self.parseBookmark, self );
			});

			return def.promise();
		},
		
		parseBookmark: function( d ) {
			var self = this,
				parsedData;

			// Make sure there's an url
			if ( d.u <= 0 ) {
				return;
			}

			// Add base data
			parsedData = {
				url   : d.u,
				title : d.d,
				type  : 'delicious'
			};

			// get dateAdded
			parsedData.dateAdded = new Date( d.dt ).getTime();

			// Get keywords
			if ( _.isString(d.t) ) {
				parsedData.keywords = d.t + ' delicious';
			} else if( _.isArray(d.t) ) {
				d.t.push('delicious');
				parsedData.keywords = d.t.join(' ');
			}

			this.addBookmark( parsedData );

		},
		
		addBookmark: function( bookmark ) {
			
			allBookmarks.add( bookmark, { merge: true });
			
		}
	};

	return deliciousAdapter;
});
