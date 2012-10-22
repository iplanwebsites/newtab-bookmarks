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
	},
	
	shim: {
		
		underscore: {
			exports: "_"
		},
		
		backbone: {
			deps: [ "underscore", "jquery" ],
			exports: "Backbone"
		}
		
	}
	
});