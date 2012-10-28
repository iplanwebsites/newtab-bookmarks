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
		
		events: {
			"click .btn.delete": "destroy"
		},
		
		data: function() {
			return this.model.toJSON();
		},
		
		//render: function() {
		//	var u = this.model.attributes;
		//	var html = "";
		//	var styles;
		//	
		//	if ( u.color ) {
		//		styles =  "background-color: rgb("+u.color[0]+", " + u.color[1] + ", " + u.color[2] + ")";
		//	}
		//	
		//	var thumb = this.model.get_thumb_url();
		//	
		//	// @todo: Templatize this mess
		//	if ( u.type === 'facebook_like' ){ //if it's a FB friend or FB like...
		//		html += '<div class="thumb_wrap"><img  src="../img/grey_thumb.gif" data-original="'+thumb+'" style="'+styles+'" class="thumb facebook" width="480" height="360" /></div>'; //http://pagepeeker.com/thumbs.php?size=x&url=www.weareacademy.com
		//	} else if ( u.type === 'facebook_friend' ) {
		//		html += '<div class="thumb_wrap"><img  src="../img/grey_person.gif" data-original="'+thumb+'" style="'+styles+'" class="thumb facebook" width="480" height="360" /></div>'; //http://pagepeeker.com/thumbs.php?size=x&url=www.weareacademy.com
		//	} else if ( u.type === 'doc' ) {
		//		html += '<div class="thumb_wrap"><img src="../img/grey_docs.gif" data-original="'+thumb+'" style="'+styles+'" class="thumb facebook" width="480" height="360" /></div>'; //http://pagepeeker.com/thumbs.php?size=x&url=www.weareacademy.com
		//	} else if ( u.type === 'photo' ) {
		//		html += '<div class="thumb_wrap"><img src="../img/grey_photo.gif"data-original="'+thumb+'"  style="'+styles+'" class="thumb facebook" width="480" height="360" /></div>'; //http://pagepeeker.com/thumbs.php?size=x&url=www.weareacademy.com
		//	} else if ( u.type === 'video' ) {
		//		html += '<div class="thumb_wrap"><img src="../img/grey_video.gif" data-original="'+thumb+'" style="'+styles+'" class="thumb facebook" width="480" height="360" /></div>'; //http://pagepeeker.com/thumbs.php?size=x&url=www.weareacademy.com
		//	} else {
		//		html += '<div class="thumb_wrap"><img src="../img/grey_globe.gif" data-original="'+thumb+'"  style="'+styles+'" class="thumb" width="480" height="360" /></div>'; //http://pagepeeker.com/thumbs.php?size=x&url=www.weareacademy.com
		//	}
		//	
		//	html += '<div class="meta">';
		//	
		//	if ( u.type === 'facebook_friend' ) {
		//	   html += '<i class="icon-user"></i>';
		//	} else if ( u.type === 'facebook_like' ) {
		//		html += '<i class="icon-thumbs-up"></i>';
		//	} else if ( u.type === 'facebook' ) {
		//		html += '<i class="icon-comment"></i>';
		//	} else {
		//	  html += '<img src="chrome://favicon/'+ u.url +'" class="favicon" />';
		//	}
		//	
		//	html += '<a href="' + u.url + '">' + u.title + '</a>';
		//	html +=' ~ <em class="domain">' + u.domain + '</em>';
		//	html +=' ~ <button class="btn delete hide">' + 'delete' + '</button>';
		//	html += '</div>';
		//	
		//	this.$el
		//		.html( html )
		//		.attr('data-id', u.id)
		//		.attr('data-url', u.url);
		//	
		//	return this;
		//},
		
		
		initialize: function() {
			//this.$el.append(this.container);
			
			//this.attach();
			//this.model.bind('remove', this.remove); //inherit destroy
		},
		
		attach: function( deferred ){
			this.render();// generate the html in the node
			if ( deferred ) {
				return this.el;
			} else {
				$('#bookmarks').append( this.el );
				return true;
			}
		},
		
		destroy: function() {
			window.alert('destroy this bookmark');
		},
		
		setRank: function( r ) {
			//for sorting purpose (isotope)
			this.$el.attr( 'data-rank', r );
		}
	});
	
	return BookmarkView;

});
