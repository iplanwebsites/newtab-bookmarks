/**
 * Settings
 */
/*global require:true, define:true */

define([
	"app",
	"models/settings",
],
function( app, Settings ) {
	"use strict";
	
	app.Models.settings = new Settings();
	
	return app.Models.settings;
	
});
