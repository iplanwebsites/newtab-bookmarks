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
		jquery     : "../assets/js/jquery/jquery", // v 1.8.3
		lodash     : "../assets/js/lodash/lodash.underscore", // v 1.0.0-rc.3
		backbone   : "../assets/js/backbone/backbone", // v 0.9.9
		handlebars : "../assets/js/handlebars/handlebars", // v 1.0.rc.1
		fuzzy      : "../assets/js/fuzzy-search/fuzzy",
		
		// Backbone plugins
		layoutmanager: "../assets/js/layoutmanager/backbone.layoutmanager", // v 0.7.5
		stickit: "../assets/js/backbone.stickit/backbone.stickit", // 0.5.2
		localStorage: "../assets/js/backbone.localStorage/backbone.localStorage",
		
		// jQuery plugins
		lazyload: "../assets/js/jquery.lazyload/jquery.lazyload",
		nanoscroller: "../assets/js/nanoscroller/jquery.nanoscroller",
		
		bootstrapTooltip: "../assets/js/bootstrap/bootstrap-tooltip",
		bootstrapModal: "../assets/js/bootstrap/bootstrap-modal"
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
		
		layoutmanager    : ["backbone"],
		stickit          : ["backbone"],
		localStorage     : ["backbone"],
		lazyload         : ["jquery"],
		nanoscroller     : ["jquery"],
		bootstrapTooltip : ["jquery"],
		bootstrapModal   : ["jquery"],

		fuzzy: {
			exports: "fuzzy"
		}
		
	}
	
});
