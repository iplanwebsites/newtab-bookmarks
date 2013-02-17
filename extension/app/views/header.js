/**
 * Header view
 */
/*global require:true, define:true */

define([
	"app",
	"jquery",
	"underscore",
	"backbone",
	"instances/settings",
	"instances/all-bookmarks",
	"models/searchCriterias",
	"views/folders",
	"views/options-menu",
	"bootstrapTooltip"
],
function( app, $, _, Backbone, settings, bookmarks, searchCriterias, FoldersDropdown, OptionsMenu ) {
	"use strict";
	

	// ---
	// Bookmarks content type
	
	var TypeBtn = Backbone.View.extend({

		template : "header-typeBtn",
		isActive : false,

		events: {
			"click a": "select"
		},

		initialize: function( opt ) {
			this.type = opt.type;
			this.model = searchCriterias.category;

			this.model.on( 'change', this.change, this );
		},

		serialize: function() {
			var source = {
				photo: {
					label: 'Photos',
					icon: 'icon-picture'
				},
				web: {
					label: 'Websites',
					icon: 'icon-globe'
				},
				video: {
					label: 'Videos',
					icon: 'icon-film'
				},
				facebook_like: {
					label: 'Facebook Pages',
					icon: 'icon-thumbs-up'
				},
				doc: {
					label: 'Documents (pdf)',
					icon: 'icon-book'
				},
				music: {
					label: 'Music',
					icon: 'icon-music'
				},
				file: {
					label: 'Files',
					icon: 'icon-file'
				},
				blog: {
					label: 'Blogs',
					icon: 'icon-comment'
				},
				person: {
					label: 'Persons',
					icon: 'icon-user'
				},
				nsfw: {
					label: 'NSFW',
					icon: 'icon-eye-open'
				}
			};

			return _.extend(
				source[ this.type ],
				{
					count: bookmarks.where({ content_type: this.type }).length
				}
			);
		},

		afterRender: function() {
			var oldEl = this.$el,
				newEl = this.$el.children();

			this.setElement( newEl );
			oldEl.replaceWith( newEl );

			this.$('.tip').tooltip();
		},


		// ---
		// Model relation
		
		change: function( model ) {
			if ( this.type === model.get('value') && model.get('filterBy') === 'content_type' ) {
				this.isActive = true;
				this.$el.addClass('active');
			} else {
				this.isActive = false;
				this.$el.removeClass('active');
			}
		},

		// ---
		// Ui relation
		
		select: function( e ) {
			e && e.preventDefault();

			if ( !this.isActive ) {
				this.model.set({
					'filterBy' : 'content_type',
					'value'    : this.type 
				});
			} else {
				this.model.clear();
			}
			
		}

	});

	var TypeBar = Backbone.View.extend({
		
		tagName   : "ul",
		className : "content_types pull-right",

		beforeRender: function() {
			var self  = this,
				types = _.without( bookmarks.all('content_type'), undefined );

			_.each( types, function( type ) {
				self.insertView( new TypeBtn({ type: type }) );
			});
		},

		afterRender: function() {
			// Initialize tooltips
			this.$el.find('.tip').tooltip();
		}
	});

	
	// ---
	// Search Bar
	
	var SearchBar = Backbone.View.extend({
		
		className: "nav pull-left",
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
	
	var MainHeader = Backbone.View.extend({
		
		template: "header",

		events: {
			"click .js-clear-search": "clear"
		},
		
		beforeRender: function() {
			
			// @todo: Create modules for all sections here
			
			this.insertViews({
				".navbar-inner": [
					new SearchBar(),
					new TypeBar()
				],
				".dropdown-section" : [
					new FoldersDropdown(),
					new OptionsMenu()
				]
			});
			
		},
		
		afterRender: function() {

			this.$('.tip').tooltip();
			
		},

		// Clear all search criterias
		clear: function() {
			searchCriterias.clear();
		}
		
	});
	
	
	// Required, return the module for AMD compliance
	return MainHeader;

});
