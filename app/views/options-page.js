/**
 * Options page view
 */
/*global require:true, define:true */

define([
	"app",
	"jquery",
	"underscore",
	"backbone",
	"models/settings",
	"models/collection-bookmarks"
],
function( app, $, _, Backbone, settings, bookmarksCollection ) {
	"use strict";
	
	var OptionsPage = Backbone.View.extend({
		
		id : "options",
		tagName  : "section",
		template : "options-page",
		
		events: {
			'click  #options .delicious .btn.add'    : 'add_delicious',
			'click  #options .delicious .btn.remove' : 'remove_delicious',
			'click .remove_all' : 'remove_all'
		},
		
		data: function() {
			return {
				total           : bookmarksCollection.length,
				chromeCount     : bookmarksCollection.where({ type: "chrome" }).length,
				delicious_user  : settings.get('delicious_user'),
				deliciousCount  : bookmarksCollection.where({ type: "delicious" }).length,
				facebookAuthUrl : this.getFacebookLoginUrl()
			};
		},
		
		
		// ---
		// UI relation
		
		add_delicious: function( ev ) {
			ev.preventDefault();
			
			var that = this;
			var handle = $('#options .delicious .input').val();
			
			if ( handle === '' ) {
				window.alert('please enter your delicious username here');
			} else {
				
				console.log('importing delicious user: ' + handle); //ayudantegrafico
				$(ev.currentTarget).button('loading');
				
				bookmarksCollection.addDelicious(handle, function(){
					$(ev.currentTarget).button('reset');
					that.render_options();
					$('#options .delicious .input').val('');
				});
				
			}
			
		},
		
		remove_delicious: function( ev ) {
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
				that.render_options();
				bookmarksCollection.render();
				$('#options .delicious .input').val('');
			}, 200);
			
		},
		
		remove_all: function() {
			// @todo: where is localstorage defined ??
			localStorage.clear();
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
