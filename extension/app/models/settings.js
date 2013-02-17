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
		
		localStorage: new Backbone.LocalStorage('settings'),

		id: 1, // Make sure to only keep one canonical settings object
		
		defaults: {
			viewmode : 'grid',
			zoomVal  : 5
		},
		
		initialize: function() {
			this.on( 'change', function() {
				this.save();
			}, this );
		}
		
	});
	
	return Settings;
	
});
