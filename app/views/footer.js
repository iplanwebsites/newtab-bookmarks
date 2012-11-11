/**
 * Footer view
 */
/*global require:true, define:true */

define([
	"app",
	"jquery",
	"underscore",
	"backbone",
	"models/settings"
],
function( app, $, _, Backbone, settings ) {
	"use strict";
	
	// ---
	// Footer modules
	
	var ZoomLevel = Backbone.View.extend({
		
		tagName: "li",
		template: "footer-zoomLevel",
		model: settings,
		
		events: {
			'change #zoom_level': "changeZoom"
		},
		
		afterRender: function() {
			this.model.on('change:viewmode', this.update, this);
			this.update( this.model, this.model.get('viewmode') );
		},
		
		update: function( model, val ) {
			var method = (val === 'grid') ? 'show': 'hide';
			
			this.$el[method]();
		},
		
		changeZoom: function() {
			var val = this.$el.find('#zoom_level').val(); //vary from 0-100
			var min_cols = 2;
			var max_cols = 10;
			var slots =  (max_cols - min_cols); //100 / 8 cols =
			var slotW = 100 / slots;
			var zoom = (slots-Math.round(val / slotW)) +min_cols;
			
			if ( zoom !== this.model.get('zoomVal') ) {
				this.model.set( 'zoomVal', zoom );
			}
			
		}
		
	});
	
	var ViewMode = Backbone.View.extend({
		
		tagName: "li",
		template: "footer-viewMode",
		model: settings,
		
		events: {
			'click .js-changemode' : 'viewmode'
		},
		
		afterRender: function() {
			this.model.on('change:viewmode', this.update, this);
			this.update( this.model, this.model.get('viewmode') );
		},
		
		update: function( model, val ) {
			var $btn = this.$el.find('.js-changemode');
			
			$btn
				.removeClass('active')
				.filter('[data-mode=' + val + ']')
				.addClass('active');
		},
		
		viewmode: function( e ) {
			var $el  = $(e.currentTarget),
				mode = $el.attr('data-mode');
			
			this.model.set('viewmode', mode);
		}
		
	});
	
	var ModulesSection = Backbone.View.extend({
		
		tagName: "ul",
		className: "nav pull-right",
		
		beforeRender: function() {
			this.insertView(new ZoomLevel());
			this.insertView(new ViewMode());
		}
		
	});
	
	
	// ---
	// Main Footer section
	
	var MainFooter = Backbone.View.extend({
		
		template: "footer",
		
		beforeRender: function() {
			
			// @todo: add all modules
			
			this.insertViews({
				".navbar-inner": new ModulesSection()
			});
			
		}
		
	});
	
	
	// Required, return the module for AMD compliance
	return MainFooter;

});
