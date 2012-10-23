/**
 * App helpers functions
 */
/*global require:true, define:true */

define([
	"jquery",
	"underscore",
	"backbone"
],

function( $, _, Backbone ) {
	"use strict";
	
	// Put application wide code here
	
	var JST = window.JST = window.JST || {},
		JSTqueue = {};
	
	return _.extend({
		// This is useful when developing if you don't want to use a
		// build process every time you change a template.
		//
		// Delete if you are using a different template loading method.
		fetchTemplate: function( path, done ) {
			
			if ( JST[path] ) {
				if ( _.isFunction(done) ) {
					done( JST[path] );
					return;
				}
			}
			
			if ( !JSTqueue[path] ) {
				JSTqueue[path] = $.ajax({
					url: path,
					dataType: "text"
				});
			}
			
			JSTqueue[path].done(function( contents ) {
				JST[path] = _.template( contents );
				if ( _.isFunction(done) ) {
					done( JST[path] );
				}
			});
			
		},
		modules: function() {
			return { Views: {}, Models: {}, Collections: {} };
		},
		Views: {},
		Models: {}
	}, Backbone.Events);

});
