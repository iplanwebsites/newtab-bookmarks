/**
 * Search Criteries collection
 *
 * @info: Collection to hold all search criterias added.
 * 
 */
/*global require:true, define:true */

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
			type  : "",
			value : ""
		}
		
	});
	
	// ---
	// Search Criterias
	
	app.Models.searchCriterias = {
		keywords : new Criteria({ type: "keyword" }),
		category : new Criteria({ type: "category" })
	};
	
	
	return app.Models.searchCriterias;

});
