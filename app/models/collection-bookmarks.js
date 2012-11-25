/**
 * Bookmarks collection
 *
 * @todo: Remove all view reference and DOM manipulation
 * @todo: Functions retrieving bookmarks from third parties should all go in their own
 *        modules middleware/façace patterns
 * @todo: Duplication checks should be done on Backbone models filtering functions
 * 
 */
/*global require:true, define:true, chrome:true */

define([
	"app",
	"jquery",
	"underscore",
	"backbone",
	"models/settings",
	"models/single-bookmark",
	"modules/utils",
	"backbone.localStorage"
],
function( app, $, _, Backbone, settings, Bookmark, utils ) {
	"use strict";
	
	var Bookmarks = Backbone.Collection.extend({
		
		model: Bookmark,
		sortOrder: 'dateAdded',
		
		localStorage : new Backbone.LocalStorage('whatever2'),
		
		saveAll: function() {
			this.each(function( m ) {
				m.save();
			});
		},
		
		
		// ---
		// Chrome importer
		
		importChromeBookmarks: function() {
			var that = this;
		   
			chrome.bookmarks.getTree(function( bookmarkTreeNodes ) {
				console.log( bookmarkTreeNodes );
				that.parseChromeBookmarkTree( bookmarkTreeNodes, []); //start the recursive process
			});
		},
		
		//recursive function
		parseChromeBookmarkTree: function( tree, folder ) {
			var that= this;
			console.log(folder.join('>'));
			console.log('tree',tree);
			_.each( tree, function( n ) {
				if ( n.children && n.children.length > 0 ) {
					//it's a folder
					var path = _.uniq( folder );
					if ( n.title ) {
						//add the folder name to the list
						path.push( n.title );
					}
					that.parseChromeBookmarkTree( n.children, path );
				} else {
					//it's a URL
					that.addChromeBookmark( n, folder );
				}
			});
		},
		
		addChromeBookmark: function( tree, folder ) {
			// @TODO: cleanup the garbage in this object...
			// @TODO: only add if it doesn't exists...
			
			//add to collection
			this.add({
				title     : tree.title,
				url       : tree.url,
				id        : tree.id,
				type      : 'chrome',
				dateAdded : tree.dateAdded,
				folder    : folder
			});
			
		},
		
		// a collection is present, we check if the counts match...
		importNewChromeBookmarks: function() {
			var alreadyThere = this.where({ type: "chrome" });
			console.log( alreadyThere.length + ' chrome bookmarks already there...' );
		},
		
	
		// ---
		// Delicious
		
		addDelicious: function( deliciousUser, cb ) {
			// @TODO: there's a maximum of 100 entries...
			var that = this;
			
			settings.set( 'delicious_user', deliciousUser );
			
			var delicious_url = 'http://feeds.delicious.com/v2/json';
			var del_count = '?count=9999';
			var url = delicious_url + '/' + deliciousUser + del_count;
			
			console.log(url);
			
			$.getJSON( url, function( data ) {
				_.each( data, function( d ) {
					// Make sure the URL is NOT already indexed... avoid duplicates...
					if ( that.where({ url: d.u }).length === 0 ) {
						var dateAdded = new Date( d.dt ).getTime();
						var keywords = d.t;
						
						// Check type and act accordingly
						if ( typeof keywords === 'string' || !keywords ) {
							keywords = keywords + ',delicious';
						} else {
							keywords = keywords.join(',') + ',delicious';
						}
						
						//add to collection
						that.add({
							title: d.d,
							url:d.u ,
							type:'delicious',
							dateAdded: dateAdded,
							keywords: keywords
						});
						
					} else {//end if
						console.log('not importing duplicate:',d.u);
					}
				});
				
				cb();
			});
			
		},
		
		
		// ---
		// Twitter import
		
		addTwitter: function( handle, cb ) {
			// @TODO: there's a maximum of 100 entries...
			var that = this;
			
			settings.set( 'twitter_user', handle );
			
			var delicious_url = 'https://api.twitter.com/1/statuses/user_timeline.json?include_entities=true&include_rts=true&screen_name=';
			var del_count = '&count=200';
			var url = delicious_url + handle + del_count;
			
			$.getJSON( url, function( data ) {
			
				_.each( data, function( d ) {
					//check if tweet has url
					if ( d.entities.urls.length > 0 ) {
						var dateAdded = new Date( d.created_at ).getTime();
						var expanded_url = _.pluck( d.entities.urls, 'expanded_url' );
						
						_.each( expanded_url, function( url ) {
							// Make sure the URL is NOT already indexed... to avoid duplicates...
							if ( that.where({ url: url }).length === 0 ) {
								// @TODO: parse and keywordize...
								
								//the tweet text..
								var keywords = d.text;
								
								keywords = keywords + ',twitter';
								
								//add to collection
								that.add({
									title     : d.d,
									url       :url,
									type      :'twitter',
									dateAdded : dateAdded,
									keywords  : keywords
								});
								
								console.log('imported from twitter: '+url);
								
							} else {
								console.log( 'not importing duplicate:', d.u );
							}
						
						});
					}
				});
				
				cb();
			});
		},
		
		
		// ---
		// Faceboook
		
		updateFacebookLinks: function() {
			if ( !localStorage.accessToken ) {
				return false;
			}
			
			// We have a token, but no FB sites.
			
			// ["facebook", "chrome", "facebook_like", "facebook_friend"]
			var types = this.all('type');
			
			var fbCount = this.where({ type: 'facebook' }).length;
			
			if ( fbCount === 0 ) {
				this.addFacebook( 5000, function() {
					console.log('FB fetching done!');
				});
			} else {
			  this.updateFacebook();
			}
			
			return true;   
		},
		
		updateFacebook: function() {
			// @TODO: function that re-fetch the facebook, and all the newest content
		},
		
		addFacebook: function( feed_count, callback ) {
		  if(!callback)callback = function(){};
		  if(!localStorage.accessToken) return false;
		   var me = "https://graph.facebook.com/me?" + localStorage.accessToken;
			var feed = "https://graph.facebook.com/me/feed?limit="+(feed_count || 500)+"&" + localStorage.accessToken;
			 var likes = "https://graph.facebook.com/me/likes?fields=website,name,category,description,username&" + localStorage.accessToken;
			 var fql = "select uid, name, website from user where uid IN (select uid2 from friend where uid1=me())";
			 var websites = "https://graph.facebook.com/fql?q="+fql + '&'+localStorage.accessToken;
			 //q=SELECT+uid2+FROM+friend+WHERE+uid1=me()&access_token=...
			 //https://graph.facebook.com/fql?q=select%20uid,%20name,%20work_history,%20work,%20education_history,%20current_location%20from%20user%20where%20uid%20IN%20(select%20uid2%20from%20friend%20where%20uid1=me)access_token=AAAEfVi4krooBAOJfqvQQqkQSc8ZAHkpZCOAC6uvDXLYnZBHUEZCK7qx8H7bfuXRbh7SvTJVHOVD6F1r2HvMUdatbvcT0hIhy9Iy9PZAAZC9QZDZD     
	   //?q=select%20uid,%20name,%20work_history,%20work,%20education_history,%20current_location%20from%20user%20where%20uid%20IN%20(select%20uid2%20from%20friend%20where%20uid1=me)access_token=AAAEfVi4krooBAOJfqvQQqkQSc8ZAHkpZCOAC6uvDXLYnZBHUEZCK7qx8H7bfuXRbh7SvTJVHOVD6F1r2HvMUdatbvcT0hIhy9Iy9PZAAZC9QZDZD&expires_in=5983      
			var that = this;
			console.log(feed);
			
			
			
			
			
			
			async.parallel([
				function(cb){
					 $.getJSON(feed, function(data) {
						console.log('feed', data);
						// var data = data.data;
						var links = [];
						_.each(data.data, function(i){
						  //TODO: find a better FQL query to only get the LINK status, no noise.
						  var isGarbage= false;//flag
						  if((i.link) && (i.type!='photo') && (i.type=='link') ){ // the status has to be a link!!!
							if(i.application){
							  if(i.application.name == 'Pages') isGarbage = true;
							}
							if(! isGarbage){
							  links.push( i.link);
							  var title = i.name || i.link;
							  var keywords = i.name + ','+i.link;
							  var dateAdded =  new Date(i.created_time).getTime() || 0;
							  var m = that.add({title: title, url: i.link, id:i.link, type:'facebook', dateAdded: dateAdded, keywords: keywords });
							}
	  
						  }
						});
						console.log(links.length + ' sites added from FEED',links);
						cb();
						//return links
					  });
					
				},
				function(cb){
					console.log(likes);
					$.getJSON(likes, function(data) {
					  console.log('likes', data);
					  _.each(data.data, function(i){
						var date = new Date(i.created_time).getTime() || 0;
						var url_fb =  'http://www.facebook.com/'+i.id;
						//var page_url = 'http://www.facebook.com/'+i.id;
						//website,name,category,description,username
						if(i.website){
						   var page_url = urlize(_.first(i.website.split(' '))); //returns the first valid domain...
						}else{
						   var page_url = undefined;
						}
						
						 if(isUrl(page_url)){
						   var u = page_url;
						 }else{
						   var u = url_fb;//the facebook page...
						 }
						var m = that.add({title: i.name, uid:i.id,  id:i.id, url: u, url_fb:url_fb, type:'facebook_like', dateAdded: date, keywords: 'like,facebook,'+i.category, description:i.description });
					  });
					  cb();
					  /*category: "Non-profit organization"
					  created_time: "2012-10-09T21:47:02+0000"
					  id: "140669232641739"
					  name: "FNC Lab"*/
					  //return data
					});
					
				},
				function(cb){
					 console.log(websites);
					  $.getJSON(websites, function(data) {
					   // console.log('WEBSITE data.data:',data.data);
						_.each(data.data, function(i){
						 // dateAdded = 
						 var friend_url = 'http://www.facebook.com/'+i.uid;
						// console.log(friend_url);
						 var m2 = that.add({title: i.name, uid:i.uid, id:i.uid,  url: friend_url , type:'facebook_friend', dateAdded: 0, keywords: 'friend,facebook'+i.name });
	  
						  if((i.website != '') && (i.website) && (i.website != null) && (i.website != 'null')){ //if this friend has a webite...
							var sites = i.website.split(/\r\n|\r|\n/);
							_.each(sites, function(s){
							  var u = urlize(s);
							  if(isUrl(u)){
							   // console.log(i.name+' : '+u)
								var keywords ='facebook, friend, friends,'+i.name;
								var m = that.add({title: i.name+"'s website", id:u, url: u , type:'facebook', dateAdded: 0, keywords: keywords });
							  }
							});
							//links.push( i.link);
						  }
	  
						});
						cb();
						//console.log('websites', data);
						//return data
					  });
					
				},
				function(cb){
					  $.getJSON(me, function(data) {
						console.log('me', data);
						settings.set('fb_user', data);
						cb();
					  });
				},
			],
			// optional callback
			function(err, results){ //DONE!
			  console.log('DONE FETCHING FB DATA');
				settings.set('hasFb', true);
				callback();//call the big Callback!
			});
			
			
		},
		
		
		// ---
		// Tools
		
		comparator: function( m ) {
			return m.get( this.sortOrder ) * -1;
		},
		
		//return all props
		all: function( prop ) {
			var that = this;
			return _.uniq(_.pluck(_.pluck(that.models, 'attributes'), prop));
		}

	});
	
	app.Models.bookmarksCollection = new Bookmarks();
	
	
	return app.Models.bookmarksCollection;
	
});
