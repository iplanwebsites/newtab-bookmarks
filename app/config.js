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
		jquery     : "../libs/jquery", // v 1.8.3
		lodash     : "../libs/lodash.underscore", // v 1.0.0-rc.3
		backbone   : "../libs/backbone", // v 0.9.9
		handlebars : "../libs/handlebars", // v 1.0.beta.6
		fuzzy      : "../libs/fuzzy",
		
		// Backbone plugins
		layoutmanager: "../libs/backbone.layoutmanager", // v 0.7.5
		stickit: "../libs/backbone.stickit", // 0.5.2
		"backbone.localStorage": "../libs/backbone.localStorage",
		
		// jQuery plugins
		bootstrap: "../libs/bootstrap",
		"jquery.lazyload": "../libs/jquery.lazyload"
		
	},

	map: {
		"*": { "underscore" : "lodash" }
	},
	
	shim: {

		lodash: {
			exports: "_"
		},
		
		backbone: {
			deps: [ "underscore", "jquery" ],
			exports: "Backbone"
		},
		
		
		handlebars: {
			exports: "Handlebars"
		},
		
		layoutmanager: [ "backbone" ],
		
		stickit: ["backbone"],
		
		"backbone.localStorage": ["backbone"],
		
		bootstrap: ["jquery"],
		"jquery.lazyload": ["jquery"],

		fuzzy: {
			exports: "fuzzy"
		}
		
	}
	
});
