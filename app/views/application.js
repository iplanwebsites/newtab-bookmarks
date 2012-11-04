/**
 * Main application view
 * 
 * @todo: Refactor this view, way to much happen in there
 * 
 */
/*global require:true, define:true */

define([
	"app",
	"jquery",
	"underscore",
	"backbone",
	"router",
	"modules/utils",
	"models/settings",
	"models/collection-bookmarks",
	"bootstrap"
],
function( app, $, _, Backbone, router, utils, settings, bookmarksCollection ) {
	"use strict";
	
	var ApplicationView = Backbone.View.extend({
		
		events: {
			'click .category .sites a' : 'favourites_sites',
			'click .clearSearch'       : 'clearSearch',
			'click  #options .delicious .btn.add'    : 'add_delicious',
			'click  #options .delicious .btn.remove' : 'remove_delicious',
			'click .footer .copyright' : 'bt_copyright',
			'click .remove_all'        : 'remove_all'
		},
		
		initialize: function() {
			// @todo: a lot here would be much better in the render function
			var that = this;
			this.position3d();
			this.render();
			
			// Apply 3d FX ?
			if( $('body').hasClass('3dfx') ){
				$(window).scroll(function( ev ) {
					that.position3d();
				});
				this.position3d_t = _.throttle(that.position3d, 10);
			}
			
			//wire Bootstrap
			$('.tip').tooltip();
			$('.bt_modal').modal();
		},
		
		bt_copyright: function( ev ) {
			console.log('copyright');
			this.getUrl('http://iplanwebsites.com');
		},
		
		add_delicious: function( ev ) {
			ev.preventDefault();
			
			var that = this;
			var handle = $('#options .delicious .input').val();
			
			if ( handle === '' ) {
				window.alert('please enter your delicious username here');
			} else {
				
				console.log('importing delicious user: ' + handle); //ayudantegrafico
				$(ev['currentTarget']).button('loading');
				
				bookmarksCollection.addDelicious(handle, function(){
					$(ev['currentTarget']).button('reset');
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
				bookmarksCollection.render();
				$('#options .delicious .input').val('');
			}, 200);
			
		},
		
		remove_all: function() {
			// @todo: where is localstorage defined ??
			localStorage.clear();
			bookmarksCollection.reset();
		},
		
		render: function() {
			return this;
		},
		
		top: function() {
			$(window).scrollTop(0);
		},
		
		position3d:function( ev ) {
			// Cancel if body isn't in 3d mode
			if( $('body').hasClass('3dfx') ) { return; }
			
			var DEGREE = 2;
			var doc_h = $(document).height();
			var viewport_h = $(window).height();
			var range = doc_h - viewport_h;
			//console.log('range', range);
			var ratio = $(window).scrollTop() / range;
			
			var variation = DEGREE * ratio;
			variation = DEGREE - variation; //reverted...
			var r = ((360-DEGREE+1)+variation) % 360; //reutn 358 - 2 degree
			
			console.log(r);
			
			var transform = 'rotateX('+ r +'deg) rotateY(0deg) rotateZ(0deg)';
			
			$('#bookmarks').css('WebkitTransform', transform);
			$('#bookmarks').css('transform', transform);
			
		},
		
		favourites_sites: function( ev ) {
			ev.preventDefault();
			var domain = $(ev['currentTarget']).parent().attr('data-domain');
			$('#search').val(domain);
			this.search( domain );
			console.log( 'favourites_sites', domain );
		},
		
		set_title: function( num ){
			var digit;
			
			if ( num === undefined ) {
				digit = bookmarksCollection.length;
			} else {
				digit = num;
			}
			
			if ( digit === 0 ) {
				$('title').html('no retults... ');
			} else {
				$('title').html('(' + digit + ')  ★ ★ ★');
			}
			
			if ( digit === 0 ) {
				var search = $('#search').val();
				$('.no_results').removeClass('hide').find('strong').html( search );
			} else {
				$(window).trigger('scroll');//load new thumbnails
				$('.no_results').addClass('hide');
			}
			
		},
		
		search: function( search ) {
			// @todo: Remove all reference to router, view should know nothing outside their dom el
			this.top();
			
			//quit option page, if it's the case...
			app.router.page('search');
			
			//this functions takes a comparator function that receive the model as a param
			app.router.filter_grid(search, function( m, search ) {
				var SEARCH_KEYWORDS = true; //speed testing...
				if ( search === '' ) {
					return true; //blank search, useless to fuss with searching...
				} else {
					var a = m.attributes;
					var content = ',' + a.url + ',' + a.domain + ',' + a.title.toLowerCase().split(' ').join(',');
					
					if ( utils.matchKeywords(search, content) ) {
						// m.v.setRank(1);
						return true;
					} else {
						if ( a.keywords && SEARCH_KEYWORDS ) {
							if( utils.matchKeywords(search, a.keywords) ) {
								// m.v.setRank(2);
								return true;
							}
						}
						return false;
					}
				}
			});
			
		},
		
		setRank: function( r ) {
			//Todo: make this less DOM consuming..., defer it?
			//this.$el.attr('data-rank', r); //for sorting purpose (isotope)
		},
		
		clearSearch: function( ev ) {
			$('#search').val('');
			this.search(''); //for sorting purpose (isotope)
		},
		
		getUrl:function( u ) {
			$('#cache').show();
			window.location = u;
			//@todo: do NOT populate the history stack (so we dont show a back BT)
			//@note: shouldn't use router if you don't want to let history trace
		}
		
	});
	
	app.Views.applicationView = new ApplicationView({ el: "body" });
	
	return app.Views.applicationView;

});