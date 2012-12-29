/**
 * Single Bookmark view
 *
 * @todo: Remove reference to container. View shouldn't know anything out of his scope
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
	
	var BookmarkView = Backbone.View.extend({
		
		tagName: 'li',
		
		template: "single-bookmark",
		
		data: function() {
			return this.model.toJSON();
		}
	});
	
	return BookmarkView;

});
