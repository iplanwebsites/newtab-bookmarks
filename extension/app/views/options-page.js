/**
 * Options page view
 */
/*global require:true, define:true */

define([
	"app",
	"jquery",
	"underscore",
	"backbone",
	"instances/settings",
	"instances/all-bookmarks"
],
function( app, $, _, Backbone, settings, bookmarksCollection ) {
	"use strict";
	
	var OptionsPage = Backbone.View.extend({
		
		id : "options",
		tagName  : "section",
		template : "options-page",
		
		events: {
			'click .delicious .js-add'    : 'add_delicious',
			'click .delicious .js-remove' : 'remove_delicious',
			'click .remove_all' : 'remove_all'
		},
		
		serialize: function() {
			return {
				total           : bookmarksCollection.length,
				chromeCount     : bookmarksCollection.where({ type: "chrome" }).length,
				delicious_user  : settings.get('delicious_user'),
				deliciousCount  : bookmarksCollection.where({ type: "delicious" }).length,
				facebookAuthUrl : this.getFacebookLoginUrl()
			};
		},

		initialize: function() {
			this.listenTo( settings, 'change', this.render );
		},
		
		
		// ---
		// UI relation
		
		add_delicious: function() {
			var handle = $('#options .delicious .input').val();
			
			if ( handle === '' ) {
				return;
			}

			settings.set( 'delicious_user', handle );
			
		},
		
		remove_delicious: function() {

			settings.set('delicious_user', undefined);

			_.invoke( bookmarksCollection.where({ type: "delicious" }), 'destroy' );
			
			this.$('.delicious .input').val('');
			
		},
		
		remove_all: function() {
			window.localStorage.clear();
			bookmarksCollection.reset();
		},
		
		
		// ---
		// Helpers
		
		getFacebookLoginUrl: function() {
			var appId = 315929978515082,
				
				// Set anything return URL for now
				// @todo: get real URL or something
				retUrl = 'http://www.facebook.com/connect/login_success.html',
				url = "https://www.facebook.com/dialog/oauth",
				permissions = [
					"read_stream",
					"user_likes",
					"friends_website"
				],
				params = {
					client_id     : appId,
					response_type : "token",
					scope         : permissions.join(","),
					redirect_uri  : retUrl
				};
			
			return url + "?" + $.param( params );
		}
		
	});
	
	// Required, return the module for AMD compliance
	return OptionsPage;

});
