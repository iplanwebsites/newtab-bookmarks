/**
 * Header view
 */
/*global require:true, define:true */

define([
	"app",
	"jquery",
	"underscore",
	"backbone",
	"instances/all-bookmarks",
	"models/searchCriterias"
],
function( app, $, _, Backbone, bookmarks, searchCriterias ) {
	"use strict";


	// ---
	// Search Bar
	
	var SearchBar = Backbone.View.extend({
		
		template: "searchBar",
		el: false,
		
		events: {
			"keydown #search": "keypress",
			"keyup #search": "keypress"
		},

		initialize: function() {
			// @todo: Should use 2-way data binding instead of events
			this.model = searchCriterias.keywords;
			this.listenTo( this.model, 'clear', this.clear );
		},

		afterRender: function() {
			// Automatically add focus to the search bar
			this.$('#search').focus();
		},
		
		keypress: function( e ) {

			// Prevent default up arrow action
			if( e.keyCode === 38 ) {
				e.preventDefault();
				return; // no need to continue, it's an arrow
			}

			// Only keyup events trigger search
			if( e.type === "keydown" ) {
				return;
			}

			this.search();
		},
		
		search: _.debounce(function() {
			var val = this.$el.find('#search').val();
			this.model.set( 'value', val );
		}, 300),

		clear: function() {
			this.$el.find('#search').val('');
		}
		
	});
	
	
	// ---
	// Main Header section
	
	var MainHeader = Backbone.View.extend({
		
		template: "header",
		el: false,

		events: {
			"click .js-clear-search": "clear"
		},
		
		beforeRender: function() {
			this.insertView(".navbar-inner", new SearchBar());
		},

		// Clear all search criterias
		clear: function() {
			searchCriterias.clear();
		}
		
	});
	
	
	// Required, return the module for AMD compliance
	return MainHeader;

});
