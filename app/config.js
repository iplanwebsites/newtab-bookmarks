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
		handlebars : "../libs/handlebars", // v 1.0.beta.6
		
		// Backbone plugins
		layoutmanager: "../libs/backbone.layoutmanager", // v 0.7.0
		stickit: "../libs/backbone.stickit", // 0.5.2
		"backbone.localStorage": "../libs/backbone.localStorage",
		
		// jQuery plugins
		bootstrap: "../libs/bootstrap",
		"jquery.lazyload": "../libs/jquery.lazyload",
		
		// plugins
		colorThief: "../libs/color-thief",
		domparser: "../libs/domparser"
	},
	
	shim: {
		
		underscore: {
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
		
		colorThief: ["../libs/quantize"],
		
		domparser: {
			exports: "DOMParser"
		}
		
	}
	
});