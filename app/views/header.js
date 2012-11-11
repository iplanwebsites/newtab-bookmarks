/**
 * Header view
 */
/*global require:true, define:true */

define([
	"app",
	"jquery",
	"underscore",
	"backbone",
	"models/settings",
	"models/collection-bookmarks",
	"models/searchCriterias"
],
function( app, $, _, Backbone, settings, bookmarks, searchCriterias ) {
	"use strict";
	
	
	// ---
	// Search Bar
	
	var SearchBar = Backbone.View.extend({
		
		template: "searchBar",
		
		initialize: function() {
			// @todo: Should use 2-way data binding instead of events
			this.model = searchCriterias.keywords;
		},
		
		events: {
			"keyup #search": "search"
		},
		
		search: function( e ) {
			var val = this.$el.find('#search').val();
			this.model.set( 'value', val );
		}
		
	});
	
	
	// ---
	// Main Header section
	
	var MainFooter = Backbone.View.extend({
		
		template: "header",
		
		beforeRender: function() {
			
			// @todo: Create modules for all sections here
			
			this.insertViews({
				".js-search-bar": new SearchBar()
			});
			
		},
		
		afterRender: function() {
			
			// @todo: Add these function in here instead of in the collection
			bookmarks.computeDomainCounts();
			bookmarks.computeFolders();
			bookmarks.computeSources();
			bookmarks.computeContentTypes();
			
		}
		
	});
	
	
	// Required, return the module for AMD compliance
	return MainFooter;

});
