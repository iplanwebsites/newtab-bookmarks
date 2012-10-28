/**
 * Single Bookmark model
 * 
 */
/*global require:true, define:true */

define([
	"app",
	"jquery",
	"underscore",
	"backbone",
	"modules/utils",
	"views/single-bookmark",
	"domparser",
	"backbone.localStorage"
],
function( app, $, _, Backbone, utils, BookmarkView, DOMParser ) {
	"use strict";
	
	var Bookmark = Backbone.Model.extend({
		
		defaults:{
			hasHtml: false,
			title: 'website',
			url: '',
			color: [200,200,200]//rgb
		},
		
		localStorage: new Backbone.LocalStorage('whatever2'),
		
		promptColor: function() {
			var cssColor = window.prompt("Please enter a CSS color:");
			this.set({ color: cssColor });
		},
		
		initialize: function() {
			
			//set the domain if it's a new object...
			if ( this.get('domain') === undefined || this.get('content_type') === undefined ) {
				
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
				
				//if there's no title, set the domain name or URL?
				
				//save it to LocalStorage right away.
				this.save();
				
				// tell the server we'll need the thumb one day...
				this.thumb_ping();
				
			}
			
			//attach the corresponding view
			this.v = new BookmarkView({
				model: this,
				id: "item-" + this.id
			});
			
			this.set( 'thumbnail_url', this.get_thumb_url() );
			
			//TODO: remove these 2 lines in production; it's already done in the init...
			this.set_content_type();
			this.save();
			
		},
		
		get_node: function() {
			
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
			var u = this.attributes;
			
			if ( u.type === 'facebook_like' || u.type === 'facebook_friend' ) {
				return 'http://graph.facebook.com/' + u.uid + '/picture?height=360&width=480';
			} else {
				return 'http://pagepeeker.com/thumbs.php?size=x&url=' + u.url;
			}
		},
		
		// Function that pings the tile server, so it prepares the thumbnail...
		// We  ignore the response to save user's bandwith
		thumb_ping: function() {
			// @TODO: have the img server setted on different sub-domains,
			// so more concurent AJAX calls can be made
			
			var thumb_url = this.get_thumb_url();
			
			var a = new XMLHttpRequest();
			
			a.onreadystatechange = function () {
				if ( a.readyState === a.HEADERS_RECEIVED ) {
					a.abort();
					console.log( a, 'tile server responded with headers for ' + thumb_url );
				}
			};
			a.open( "GET", thumb_url );
			a.send( null );
		},
		
		downloadHTML: function( cb ) {
			var that = this;
			
			if ( !cb ) {
				cb = function() {};
			}
			
			console.log(this.get('url'));
			
			$.get( this.get('url') )
			.done(function( data, textStatus, jqXHR ) {
				that.set( 'hasHtml', true );
				
				var dom = new DOMParser().parseFromString( data, 'text/html' );
				var body = dom.body;
				var includeWhitespace = false;
				
				//get all text nodes from the fetched DOM
				var textNodes = getTextNodesIn( body, includeWhitespace );
				
				//array of all text STR
				var texts = _.pluck( textNodes, 'data' );
				
				var arrays = _.map(texts, function(t){ return t.split(' ') });
				
				//merge all words arrays into one
				var words =_.uniq(_.flatten( arrays ));
				
				//lowercase, trim, and exclude punctuation
				var keywords = _.uniq(_.map( words, function( w ) {
					w = w.replace(/[\.,\/#!?$%\^&\*;:{}=\_`~()]/g,"").toLowerCase();
					w = w.replace(/\s{2,}/g," ");
					w = w.replace(' ',"").replace(' ',"").replace(' ',"");
					w = w.replace(' ',"");
					return w;
				}));
				
				console.log(keywords.length+' keywords found for '+that.get('url'));
				
				that.set( 'keywords', keywords.join(',') );
				that.set( 'hasKeywords', true );
				that.save();
			})
			.fail(function() { 
				console.log( 'error found!' );
				that.set( 'html', '' );
				that.set( 'hasHtml', 'error' );
				that.save(); 
			});
		}
		
	});
	
	
	return Bookmark;

});