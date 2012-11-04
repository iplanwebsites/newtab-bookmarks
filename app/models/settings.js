/**
 * Settings
 */
/*global require:true, define:true */

define([
	"app",
	"jquery",
	"underscore",
	"backbone",
	"backbone.localStorage"
],
function( app, $, _, Backbone ) {
	"use strict";
	
	var Settings = Backbone.Model.extend({
		id: 1, //there's duplicates otherwise...
		
		defaults: {
			viewmode : 'grid',
			zoomVal  : 5
		},
		
		initialize: function() {
			this.on('change', this.save, this);
		},
		
		localStorage: new Backbone.LocalStorage('settings2')
	});
	
	app.Models.settings = new Settings();
	
	return app.Models.settings;
	
});
