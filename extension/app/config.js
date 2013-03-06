/**
 * AMD loader Configuration
 */

require.config({

	deps: (window.ENV === 'Events') ? [] : [ "main" ],
	
	paths: {
		// Libraries.
		jquery     : "../assets/js/jquery/jquery",
		lodash     : "../assets/js/lodash/lodash.underscore",
		backbone   : "../assets/js/backbone/backbone",
		handlebars : "../assets/js/handlebars/handlebars",
		fuzzy      : "../assets/js/fuzzy-search/fuzzy",
		
		// Backbone plugins
		layoutmanager: "../assets/js/layoutmanager/backbone.layoutmanager",
		stickit: "../assets/js/backbone.stickit/backbone.stickit",
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
