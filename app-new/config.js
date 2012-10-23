/*global require:true, define:true, window:true, document:true */

/**
 * AMD loader Configuration
 */

require.config({
	
	// Initialize the application with the main application file
	deps: [
		"main"
	],
	
	paths: {
		// Libraries.
		jquery     : "../libs/jquery", // v 1.8.1
		underscore : "../libs/underscore", // v 1.3.2
		backbone   : "../libs/backbone", // v 0.9.2
		
		// Backbone plugins
		"backbone.localStorage": "../libs/backbone.localStorage",
		
		// jQuery plugins
		bootstrap: "../libs/bootstrap",
		"jquery.lazyload": "../libs/jquery.lazyload"
	},
	
	shim: {
		
		underscore: {
			exports: "_"
		},
		
		backbone: {
			deps: [ "underscore", "jquery" ],
			exports: "Backbone"
		},
		
		"backbone.localStorage": ["backbone"],
		
		bootstrap: ["jquery"],
		"jquery.lazyload": ["jquery"]
		
	}
	
});