/**
 * Nom du module
 *
 * @info: bla bla
 * 
 */
/*global require:true, define:true */

define([
	"app",
	"jquery",
	"underscore",
	"backbone",
	"models/collection-bookmarks"
],
function( app, $, _, Backbone, Bookmarks ) {
	"use strict";
	
	app.Models.allBookmarks = new Bookmarks();
	
	return app.Models.allBookmarks;

});
