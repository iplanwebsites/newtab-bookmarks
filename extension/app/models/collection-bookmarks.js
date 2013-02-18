/**
 * Bookmarks collection
 *
 * @todo: Duplication checks should be done on Backbone models filtering functions
 */

define([
	"app",
	"jquery",
	"underscore",
	"backbone",
	"models/single-bookmark",
	"fuzzy",
	"localStorage"
],
function( app, $, _, Backbone, Bookmark, fuzzy ) {
	"use strict";
	
	var Bookmarks = Backbone.Collection.extend({
		
		model: Bookmark,
		sortOrder: 'score',
		
		localStorage : new Backbone.LocalStorage('whatever2'),


		// ---
		// Filtering

		matchSearch: function( searchCriterias ) {

			var self     = this,
				keyword  = searchCriterias.keywords.get('value'),
				filterBy = searchCriterias.category.get('filterBy'),
				category = searchCriterias.category.get('value'),
				catFilter = {},
				filtered;

			if ( _.isString(filterBy) && _.isString(category) && filterBy.length && category.length ) {
				// If there's category filtering info
				catFilter[filterBy] = category;
				filtered = self.where( catFilter );
			} else if( keyword.length ) {
				// If we have no category but a keyword, transform collection in array
				filtered = self.toArray();
			} else {
				// Else, just return the collection as nothing is being searched
				return self;
			}

			// If no keyword is provided, return category filtered collection
			if ( !keyword.length ) {
				return new Bookmarks( filtered );
			}

			filtered = fuzzy.filter( keyword, filtered, {
				// Setup the searchable string
				extract: function( model ) {
					return model.get('title') + " " + model.get('url');
				}
			});

			filtered = _.map( filtered, function( result ) {
				return result.original.set('score', result.score);
			});

			return new Bookmarks( filtered );

		},


		// ---
		// Tools

		saveAll: function() {
			this.invoke( 'save' );
		}

	});
	
	
	return Bookmarks;
	
});
