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
	"models/searchCriterias",
	"bootstrap"
],
function( app, $, _, Backbone, bookmarks, searchCriterias ) {
	"use strict";
	
	
	// ---
	// Main Folder section
	
	var OptionsMenu = Backbone.View.extend({
		
		template: "options-menu",

		events: {
			"click .js-clear-search"       : "clear",
			"click  .js-add-delicious"     : "addDelicious",
			"click  .js-remove-deliciouos" : "removeDelicious"
		},
		
		beforeRender: function() {
			
			
			
		},
		
		afterRender: function() {
			
			// Make full template
			var oldEl = this.$el,
				newEl = this.$('.options');

			this.setElement( newEl );
			oldEl.replaceWith( newEl );

			// Load modal plugins
			this.$('.bt_modal').modal();
			
		},

		// ---
		// UI relation

		clear: function( e ) {
			e && e.preventDefault();
			searchCriterias.clear();
		},

		addDelicious: function( ev ) {
			ev.preventDefault();
			
			var that = this;
			var handle = $('#options .delicious .input').val();
			
			if ( handle === '' ) {
				window.alert('please enter your delicious username here');
			} else {
				
				console.log('importing delicious user: ' + handle); //ayudantegrafico
				$(ev['currentTarget']).button('loading');
				
				bookmarksCollection.addDelicious(handle, function(){
					$(ev['currentTarget']).button('reset');
					$('#options .delicious .input').val('');
				});
				
			}
			
		},
		
		removeDelicious: function( ev ) {
			ev && ev.preventDefault();
			
			var that= this;
			var delicious = bookmarksCollection.where({type: "delicious"});
			
			console.log( 'rm', delicious );
			
			_.each( delicious, function( m ) {
				console.log( 'destroy delicious model1:', m );
				m.destroy({ wait: true });
			});
			
			settings.set('delicious_user', false);
			
			//refresh the page...
			_.delay(function() {
				$('#options .delicious .input').val('');
			}, 200);
			
		}
		
	});
	
	
	// Required, return the module for AMD compliance
	return OptionsMenu;

});
