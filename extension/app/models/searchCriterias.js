/**
 * Search Criteries collection
 *
 * @info: Collection to hold all search criterias added.
 * 
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
	// Single Criteria
	
	var Criteria = Backbone.Model.extend({
		
		defaults: {
			type     : "",
			filterBy : "",
			value    : ""
		},

		clear: function() {
			this.set({
				filterBy : '',
				value    : ''
			});
			this.trigger('clear');
		}
		
	});
	

	// ---
	// Search Criterias
	
	var searchCriterias = {
		
		keywords : new Criteria({ type: "keyword" }),
		category : new Criteria({ type: "category" }),

		clear: function() {
			this.keywords.clear();
			this.category.clear();
		}
	};
	
	
	return searchCriterias;

});
