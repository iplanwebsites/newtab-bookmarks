/**
 * Single Bookmark model
 */
/*global require:true, define:true */

define([
	"app",
	"jquery",
	"underscore",
	"backbone",
	"modules/utils",
	"views/single-bookmark",
	"backbone.localStorage"
],
function( app, $, _, Backbone, utils, BookmarkView ) {
	"use strict";
	
	var Bookmark = Backbone.Model.extend({
		
		defaults: {
			url   : "",
			title : "",
			type  : "",
			dateAdded : "",
			folder    : [],
			domain    : "",
			content_type  : "",
			thumbnail_url : ""
		},
		
		localStorage: new Backbone.LocalStorage('whatever2'),
		
		initialize: function() {
			
			//set the domain if it's a new object...
			if ( this.isNew() ) {
				var url = this.get('url');
				if ( utils.isURL(url) ) {
					this.set( 'domain', utils.getDomain(url) );
				} else {
					//this can be a bookmarklet, a FTP, or special page bookmark...
					this.set( 'domain', false );
					console.log( 'not a URL:', url );
				}
				
				//set the main set_content_type
				this.set_content_type();
				
			}

			//if there's no title, use domain name
			if ( !this.get('title').length ) {
				this.set( 'title', this.get('domain') );
			}
			
			this.set( 'thumbnail_url', this.get_thumb_url() );
			this.save();
			
		},
		
		set_content_type: function() {
			// @TODO add all types, find less awfull algorithm to sort websites...
			var url = this.get('url');
			var type = this.get('type');
			var t;
			if ( url.indexOf('.pdf') !== -1 || url.indexOf('books.google.') !== -1 ) {
				t = 'doc';
			} else if ( (url.indexOf('.jpg') !== -1) || (url.indexOf('.jpeg') !== -1) || (url.indexOf('.png') !== -1) || (url.indexOf('.gif') !== -1) || (url.indexOf('flickr.com') !== -1) ) {
				t = 'photo';
			} else if ( (url.indexOf('wordpress.') !== -1) || (url.indexOf('blogger.') !== -1) ) {
				t = 'blog';
			} else if ( (url.indexOf('youtube.') !== -1) || (url.indexOf('dailymotion.') !== -1)|| (url.indexOf('vimeo.') !== -1) ) {
				t = 'video';
			} else if ( type === 'facebook_friend' ) {
				t = 'person';
			} else if ( type === 'facebook_like' ) {
				t = 'facebook_like';
			} else {
				t = 'web';
			}
			
			this.set('content_type', t);
		},
		
		get_thumb_url: function() {
			if ( _.indexOf(['facebook_like', 'facebook_friend'], this.get('type')) >= 0 ) {
				return 'http://graph.facebook.com/' + this.get('uid') + '/picture?height=360&width=480';
			} else {
				if ( this.get('url').indexOf("https://") === 0 ) {
					return 'http://pagepeeker.com/thumbs.php?size=x&url=' + this.get('url');
				} else {
					return 'http://immediatenet.com/t/l?Size=1024x768&URL=' + this.get('url');
				}
			}
		},
		
		
		// ---
		// Search Functions
		
		// Return true or false if view model match given value
		matchKeyword: function( value ) {
			
			// Abort if invalid value
			if ( !_.isString(value) || !value.length ) { return true; }
			
			// Check if value is contain in the model
			if ( this.get('title').indexOf(value) >= 0 ||  this.get('url').indexOf(value) >= 0 ) {
				return true;
			}
			
			// Otherwise
			return false;
		},

		matchCategory: function( filterBy, value ) {
			if ( !_.isString(filterBy)
				|| !_.isString(value)
				|| !filterBy.length
				|| !value.length ) { return true; }

			// Check if value correspond to the filterBy dimension
			if ( this.get( filterBy ) === value ) {
				return true;
			}

			// Otherwise
			return false;
		}
		
	});
	
	
	return Bookmark;

});
