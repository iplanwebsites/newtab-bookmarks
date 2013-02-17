/**
 * Folder filtering view
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
	// Folders list

	var FolderItem = Backbone.View.extend({

		template: "folder-item",

		serialize: function() {
			return this.model;
		},

		afterRender: function() {
			
			// Make full template
			var oldEl = this.$el,
				newEl = this.$('li');

			this.setElement( newEl );
			oldEl.replaceWith( newEl );
		}

	});

	var FoldersList = Backbone.View.extend({

		tagName   : "ul",
		className : "folders",

		beforeRender: function() {
			var folders = _.uniq( bookmarks.pluck('folder'), false, function( array ) {
				return JSON.stringify( array );
			});
			folders = _.first( folders, 15 );
			folders = _.map( folders, function( folder_path ) {
				return {name: folder_path.join(' > ')};
			});

			_.each( folders, function( folder ) {
				this.insertView( new FolderItem({ model : folder }) );
			}, this);
		}

	});


	// ---
	// Domains list

	var DomainItem = Backbone.View.extend({

		template: "domain-item",

		serialize: function() {
			return this.model;
		},

		afterRender: function() {
			
			// Make full template
			var oldEl = this.$el,
				newEl = this.$('li');

			this.setElement( newEl );
			oldEl.replaceWith( newEl );
		}

	});

	var DomainsList = Backbone.View.extend({

		tagName   : "ul",
		className : "domains",

		beforeRender: function() {
			var domains = _.groupBy( bookmarks.pluck('domain'), function( domain ) {
				return domain;
			});
			domains = _.sortBy( domains, "length");
			domains = _.last( domains, 5 ).reverse();
			domains = _.map( domains, function( val ) {
				return {
					name: val[0],
					quantity: val.length
				};
			});

			_.each( domains, function( domain ) {
				this.insertView( new DomainItem({ model : domain }) );
			}, this);
		}

	});


	// ---
	// Sources list

	var SourceItem = Backbone.View.extend({

		template: "source-item",

		serialize: function() {
			return this.model;
		},

		afterRender: function() {
			
			// Make full template
			var oldEl = this.$el,
				newEl = this.$('li');

			this.setElement( newEl );
			oldEl.replaceWith( newEl );
		}

	});

	var SourcesList = Backbone.View.extend({

		tagName   : "ul",
		className : "sources",

		nameMap : {
			chrome: {
				label: 'Chrome',
				icon: 'icon-star'
			},
			twitter: {
				label: 'Twitter',
				icon: 'icon-retweet'
			},
			delicious: {
				label: 'Delicious',
				icon: 'icon-th-large'
			},
			facebook: {
				label: 'Facebook Posts',
				icon: 'icon-comment'
			},
			facebook_like: {
				label: 'Facebook Likes',
				icon: 'icon-thumbs-up'
			},
			facebook_friend: {
				label: 'Facebook Friends',
				icon: 'icon-user'
			}
		},

		beforeRender: function() {
			var self = this;
			var sources = _.groupBy( bookmarks.pluck('type'), function( source ) {
				return source;
			});
			
			sources = _.sortBy( sources, "length");
			sources = _.last( sources, 5 ).reverse();
			sources = _.map( sources, function( val ) {
				return {
					name: self.nameMap[ val[0] ].label,
					icon: self.nameMap[ val[0] ].icon,
					quantity: val.length
				};
			});

			_.each( sources, function( source ) {
				this.insertView( new SourceItem({ model : source }) );
			}, this);
		}

	});
	
	
	// ---
	// Main Folder section
	
	var CategoriesDropdown = Backbone.View.extend({
		
		template: "folder-dropdown",

		events: {
			"click .js-clear-search": "clear"
		},
		
		beforeRender: function() {
			
			this.insertView( '.dropdown-menu', new FoldersList() );
			this.insertView( '.dropdown-menu', new DomainsList() );
			this.insertView( '.dropdown-menu', new SourcesList() );
			
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
	return CategoriesDropdown;

});
