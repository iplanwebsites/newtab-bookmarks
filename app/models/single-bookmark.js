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
			url           : "",
			title         : "",
			type          : "",
			dateAdded     : "",
			folder        : [],
			domain        : false,
			content_type  : "web",
			thumbnail_url : "",
			score         : 0,
			keep          : false
		},
		
		localStorage: new Backbone.LocalStorage('whatever2'),
		
		initialize: function() {
			
			var url = this.get('url');
			if ( utils.isURL(url) ) {
				this.set( 'domain', utils.getDomain(url) );
			} else {
				//this can be a bookmarklet, a FTP, or special page bookmark...
				this.set( 'domain', false );
			}
			
			//set the main set_content_type
			this.set_content_type();

			//if there's no title, use domain name
			if ( !this.get('title').length ) {
				this.set( 'title', this.get('domain') );
			}
			
			this.set( 'thumbnail_url', this.get_thumb_url() );
			this.save();
			
		},

		save: function(attrs, options) {
			options || (options = {});
			
			attrs = attrs || this.toJSON();

			// Filter the data to send to the server
			delete attrs.keep;

			// Set data to be saved
			options.data = JSON.stringify(attrs);

			// Proxy the call to the original save function
			Backbone.Model.prototype.save.call(this, attrs, options);
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
		}
		
	});
	
	
	return Bookmark;

});
