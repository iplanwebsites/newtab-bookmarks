function fetch() {
	window.ENV = "Events";
	require(['config'], function( conf ) {

		// Fetch Chrome bookmarks
		require([ "modules/bookmarks.chrome" ], function( chromeBookmarks ) {
			chromeBookmarks.fetch();
		});

		// Fetch Delicious bookmarks
		require([ "modules/bookmarks.delicious" ], function( deliciousBookmarks ) {
			deliciousBookmarks.fetch();
		});

	});
}

if( chrome.alarms ) {
	chrome.alarms.create('fetch', { periodInMinutes : 30 });
	chrome.alarms.onAlarm.addListener(fetch);
} else {
	setInterval( fetch, 1800000 );
}
chrome.runtime.onInstalled.addListener(fetch);
