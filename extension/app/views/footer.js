/**
 * Footer view
 */

define([
	"app",
	"jquery",
	"underscore",
	"backbone"
],
function( app, $, _, Backbone ) {
	"use strict";

	// ---
	// Main Footer section
	
	var MainFooter = Backbone.View.extend({
		
		template: "footer",
		el: false
		
	});
	
	return MainFooter;

});
