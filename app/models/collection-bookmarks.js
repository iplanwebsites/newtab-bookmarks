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
	"views/application",
	"modules/utils",
	"backbone.localStorage",
	"jquery.lazyload",
	"colorThief"
],
function( app, $, _, Backbone, settings, Bookmark, applicationView, utils ) {
	"use strict";
	
	var Bookmarks = Backbone.Collection.extend({
		
		model: Bookmark,
		
		localStorage : new Backbone.LocalStorage('whatever2'),
		
		saveAll: function() {
			this.each(function( m ) {
				m.save();
			});
		},
		
		scheduleHtmlDownload: function() {
			var that = this;
			this.htmlInterval = window.setInterval(function() {
				
				//find a model with no HTML
				var todo = _.filter( that.models, function( m ) { 
					if ( !m.get('hasHtml') && m.get('type') !== 'facebook_friend' ) {
						return true;
					}
					return false;
				});
				
				if( todo.length > 1 ) {
				  
				var remaining = (todo.length - that.length) * -1;
				var pcnt = Math.floor( (remaining / that.length) * 100 );
				
				that.show_html_download_notice(pcnt, remaining, that.length);
				
				//pick a random one...
				var model = todo[Math.floor( Math.random() * todo.length - 1 )];
				
				model.downloadHTML();
				
				} else {
					that.stopDownload();
					that.show_html_download_complete();
				}
			
			}, 1000 );
		},
		
		stopDownload: function() {
			window.clearInterval( this.htmlInterval ); 
			$('.html-download').hide();
		},
		
		show_html_download_notice: function( pcnt, remaining, all ) { //VIEW
			$('.html-download').show();
			$('.html-download strong').html( pcnt + '% (' + remaining + '/' + all + ')' );
			$('.html-download .bar').css( 'width', pcnt + '%' );
		},
		
		show_html_download_complete: function( count ) { //VIEW
			$('.html-download-complete').show();
			$('.html-download-complete strong').html( count || this.length );
		},
		
		
		// ---
		// Meta data
		
		computeDomainCounts: function() {
			var models  = _.pluck( this.models, 'attributes' );
			var domains = _.pluck( models, 'domain' );
			var i;
			
			var result = {};
			
			for( i = 0; i < domains.length; i += 1 ) {
				if ( !result[ domains[i] ] ) {
					result[ domains[i] ] = 0;
				}
				result[ domains[i] ] += 1;
			}
			
			var sorted = utils.sortObject( result ).reverse();
			this.domains = sorted;
			
			var html = '';
			_.each(_.first( this.domains, 5 ), function( d ) {
				//console.log(d);
				if( d.value > 1 ) {
					html += '<li data-domain="'+d.key+'"><a><i class="icon-globe"></i>'+d.key+' <em>('+d.value+')'+'</em></a></li>';
				}
			});
			
			$('.category .sites').html( html );
			
			return sorted;
		},
		
		computeFolders: function() {
			var foldersArray = this.all('folder');
			
			var stringnified = _.map( foldersArray, function( f ) {
				if ( f ) {
					return f.join(' > ');
				}
				return '';
			});
			
			var html = '';
			var folders = _.uniq( stringnified ).sort();
			
			folders = _.first( folders, 15 );
			
			_.each( folders, function( f ) {
				if ( f ) {
					html+= ' <li><a href="#folder/'+f+'" data-folder="'+f+'"><i class="icon-folder-close"></i>'+f+'</a></li>';
				}
			});
			
			$('.category .folders').html( html );
			
			return stringnified;
		},
		
		computeSources: function() {
			
			var that = this;
			var types = this.all('type');
			
			var source = {
				chrome: {
					label: 'Chrome',
					icon: '<i class="icon-star"></i>'
				},
				twitter: {
					label: 'Twitter',
					icon: '<i class="icon-retweet"></i>'
				},
				delicious: {
					label: 'Delicious',
					icon: '<i class="icon-th-large"></i>'
				},
				facebook: {
					label: 'Facebook Posts',
					icon: '<i class="icon-comment"></i>'
				},
				facebook_like: {
					label: 'Facebook Likes',
					icon: '<i class="icon-thumbs-up"></i>'
				},
				facebook_friend: {
					label: 'Facebook Friends',
					icon: '<i class="icon-user"></i>'
				}
			};
			
			var html='';
			
			_.each( types, function( t ) {
				var data = source[ t ];
				var count = that.where({ type: t }).length;
				if ( t ) {
					html += ' <li><a href="#source/'+t+'" data-source="'+t+'">'+ data.icon + data.label +' <em>('+count+')'+'</em></a></li>';
				}
			});
			
			$('.category .sources').html( html );
			
			return types;
		},
		computeContentTypes: function() {
			
			var that = this;
			var types = _.without( this.all('content_type'), undefined );
			
			console.log('>>>> types');
			console.log(types);
			
			var source = {
				photo: {
					label: 'Photos',
					icon: '<i class="icon-picture icon-white"></i>'
				},
				web: {
					label: 'Websites',
					icon: '<i class="icon-globe icon-white"></i>'
				},
				video: {
					label: 'Videos',
					icon: '<i class="icon-film icon-white"></i>'
				},
				facebook_like: {
					label: 'Facebook Pages',
					icon: '<i class="icon-thumbs-up icon-white"></i>'
				},
				doc: {
					label: 'Documents (pdf)',
					icon: '<i class="icon-book icon-white"></i>'
				},
				music: {
					label: 'Music',
					icon: '<i class="icon-music icon-white"></i>'
				},
				file: {
					label: 'Files',
					icon: '<i class="icon-file icon-white"></i>'
				},
				blog: {
					label: 'Blogs',
					icon: '<i class="icon-comment icon-white"></i>'
				},
				person: {
					label: 'Persons',
					icon: '<i class="icon-user icon-white"></i>'
				},
				nsfw: {
					label: 'NSFW',
					icon: '<i class="icon-eye-open icon-white"></i>'
				}
			};
			
			var html='';
			_.each( types, function( t ) {
				var data = source[ t ];
				var count = that.where({ content_type: t }).length;
				
				if ( t ) {
					html += '<li class=" '+t+'" ><a href="#type/'+t+'" class="tip '+t+'" data-type="'+t+'" rel="tooltip" data-placement="bottom" data-original-title="'+ data.label +' <em>('+count+')'+'</em>" >'+ data.icon +'</a></li>';
				}
			});
			
			$('.content_types').html( html );
			$('.content_types .tip').tooltip();
			return types;
		},
		
		computeKeywords: function() {
			var models        = _.pluck(this.models, 'attributes');
			var keywords      = _.flatten(_.pluck(models, 'keywords'));
			var keywords_uniq = _.uniq(keywords);
		},
		
		
		// ---
		// Chrome importer
		
		importChromeBookmarks: function() {
			var that = this;
		   
			chrome.bookmarks.getTree(function( bookmarkTreeNodes ) {
				console.log( bookmarkTreeNodes );
				that.parseChromeBookmarkTree( bookmarkTreeNodes, []); //start the recursive process
				that.render();
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
				
				//refresh the collection, so these new elements appears!...
				that.render();
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
				
				//refresh the collection, so these new elements appears!...
				that.render();
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
				that.render();
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
		},
		
		
		// ---
		// Display
	  
		render: function() {
			var that = this;
			
			//applicationView.set_title();
			
			//populate the dropdown for sites list
			this.computeDomainCounts();
			this.computeFolders();
			this.computeSources();
			
			//header bar
			this.computeContentTypes();
			
			_.defer(function() {
				that.setBgColors();
			});
			
			$('#bookmarks').empty();
			
			var items = _.sortBy( this.models, function( m ) { 
				var s = m.get( that.sortOrder );
				
				if ( that.sortOrder === 'dateAdded' ) {
					return s * -1; 
				} else {
					return s;
				}
			});
			
			var toAttach = [];
			_.each( items, function( m ) {
				// re-attach the items, we deffer it with true (so it return the rendered node...)
				toAttach.push( m.v.attach(true) );
			});
			
			$('#bookmarks').append( toAttach );
			
			_.delay(function() {
				console.log('>>> ini images');
				$(".thumb_wrap img").lazyload({
					threshold: 500
				});
			}, 1 );
			
		},
		
		sortOrder: 'dateAdded',
		
		setBgColors: function() { //get or analyse the dominant color of this favion img...
			var that = this;
			
			$('img.favicon').each(function( me ) {
				
				var model = that.get( $(this).parent().parent().attr('data-id') ),
					color;
				
				if ( model.get('dominantColor') ) {
					//get saved color.
					color = model.get('dominantColor');
				} else {
					console.log('COMPUTE COLOR2');
					
					color = window.getDominantColor( $(this) );
					
					// save color into the model...
					model.set('dominantColor', color);
					model.save();
				}
				
				if ( color[0] === 148 && color[1] === 148 && color[2] === 148 ) {
					//this is the default chrome icon... problem...
				} else {
					//just save it, show it next time...
					//$(this).parent().parent().find('.thumb_wrap').css('background-color', "rgb("+color[0]+"," + color[1] + "," + color[2] + ")");
				}
			  
			});
		  
		}
  
	});
	
	app.Models.bookmarksCollection = new Bookmarks();
	
	
	return app.Models.bookmarksCollection;
	
});
