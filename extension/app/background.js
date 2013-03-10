define([
	"app",
	"jquery",
	"instances/all-bookmarks",
	"modules/bookmarks.chrome",
	"modules/bookmarks.delicious"
], function( app, $, allBookmarks, chromeBookmarks, deliciousBookmarks ) {

	allBookmarks.fetch();

	// Fetch bookmarks from data sources
	var fetch = function() {
		$.when(
			chromeBookmarks.fetch(),
			deliciousBookmarks.fetch()
		);
	};

	if( chrome.alarms ) {
		chrome.alarms.create('fetch', { periodInMinutes : 30 });
		chrome.alarms.onAlarm.addListener( fetch );
	} else {
		setInterval( fetch, 1800000 );
	}
	chrome.runtime.onInstalled.addListener( fetch );
});
