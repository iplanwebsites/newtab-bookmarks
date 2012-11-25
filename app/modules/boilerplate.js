/**
 * Nom du module
 *
 * @info: bla bla
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
	
	var boilerplate = app.module();
	
	boilerplate.Models.model = Backbone.Model.extend({ /* ... */ });
	boilerplate.Collections.collection = Backbone.Collection.extend({ /* ... */ });
	
	boilerplate.Views.main = Backbone.View.extend({
		
		el: "#page-",
		
		template: "app/templates/boilerplate.html",
		
		initialize: function() {
			
		},
		
		render: function( done ) {
			
			var view = this;
			
			app.fetchTemplate( view.template, function( tmpl ) {
				view.$el.html( tmpl() );
				if ( _.isFunction(done) ) {
					done( view.el );
				}
			});
			
		}
	});
	
	// Required, return the module for AMD compliance
	return boilerplate;

});
