/**
 * Main.js - Bootstrap the application (required from config.js)
 * 
 */
/*global require:true, define:true */

define([
	// Application.
	"app",
	"jquery",
	"underscore",
	"backbone",
	
	// Main Router.
	"router"
],
function( app, $, _, Backbone, Router ) {
	"use strict";
	
	
	// Instantiate and launch Router
	app.router = new Router();
	Backbone.history.start();
	
});