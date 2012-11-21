/**
 * Folder filtering view
 */
/*global require:true, define:true */

define([
	"app",
	"jquery",
	"underscore",
	"backbone",
	"models/collection-bookmarks",
	"models/searchCriterias"
],
function( app, $, _, Backbone, bookmarks, searchCriterias ) {
	"use strict";
	
	
	// ---
	// Main Folder section
	
	var FoldersDropdown = Backbone.View.extend({
		
		template: "folder-dropdown",

		events: {
			"click .js-clear-search": "clear"
		},
		
		beforeRender: function() {
			
			
			
		},
		
		afterRender: function() {
			
			// Make full template
			var oldEl = this.$el,
				newEl = this.$('.categories_drop');

			this.setElement( newEl );
			oldEl.replaceWith( newEl );
			
		},


		// ---
		// UI relation

		clear: function( e ) {
			e && e.preventDefault();
			searchCriterias.clear();
		}
		
	});
	
	
	// Required, return the module for AMD compliance
	return FoldersDropdown;

});
