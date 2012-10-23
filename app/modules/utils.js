/**
 * Utils
 *
 * @info: Collection of helper functions
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
	
	var utils = {};
	
	
	utils.sortObject = function( obj ) {
		var arr = [];
		for ( var prop in obj ) {
			if ( obj.hasOwnProperty(prop) ) {
				arr.push({
					'key': prop,
					'value': obj[prop]
				});
			}
		}
		arr.sort(function( a, b ) { return a.value - b.value; });
		return arr; // returns array
	};
	
	utils.cleanDomain = function( u ) {
		var s = u;
		s = s.replace('https://www.', '');
		s = s.replace('http://www.', '');
		s = s.replace('https://', '');
		s = s.replace('http://', '');
		s = s.substr( 0, s.indexOf('/') );
		return s;
	};
	
	utils.isURL = function( s ) {
		//This function has to be more liberal,
		// we want to let simple url entry work as well
		// ie. facebook.com, bit.ly, www.google.com, etc)
		var domain =/^([a-z0-9]([-a-z0-9]*[a-z0-9])?\\.)+((a[cdefgilmnoqrstuwxz]|aero|arpa)|(b[abdefghijmnorstvwyz]|biz)|(c[acdfghiklmnorsuvxyz]|cat|com|coop)|d[ejkmoz]|(e[ceghrstu]|edu)|f[ijkmor]|(g[abdefghilmnpqrstuwy]|gov)|h[kmnrtu]|(i[delmnoqrst]|info|int)|(j[emop]|jobs)|k[eghimnprwyz]|l[abcikrstuvy]|(m[acdghklmnopqrstuvwxyz]|mil|mobi|museum)|(n[acefgilopruz]|name|net)|(om|org)|(p[aefghklmnrstwy]|pro)|qa|r[eouw]|s[abcdeghijklmnortvyz]|(t[cdfghjklmnoprtvwz]|travel)|u[agkmsyz]|v[aceginu]|w[fs]|y[etu]|z[amw])$/i;
		var fullUrl = /(ftp|http|https):\/\/(\w+:{0,1}\w*@)?(\S+)(:[0-9]+)?(\/|\/([\w#!:.?+=&%@!\-\/]))?/;
		if ( fullUrl.test(s) || domain.test(s) ) {
			return true;
		} else {
			return false;
		}
	};
	
	utils.urlize = function ( s ) { //append http block is doesnt look like a valid url (for facebook use websites..)
		if ( !utils.isUrl(s) ) {
			return 'http://'+s;
		} else {
			return s;
		}
	};
	
	utils.getDomain = function( url ) {
		return url.match(/:\/\/(www[0-9]?\.)?(.[^\/:]+)/)[2];
	};
	
	utils.getTextNodesIn = function( node, includeWhitespaceNodes ) {
		var textNodes = [],
			whitespace = /^\s*$/,
			i, len;
		
		function getTextNodes( node ) {
		 // console.log(node.nodeName);
			if ( node.nodeType === 3 ) {
				if (includeWhitespaceNodes || !whitespace.test(node.nodeValue)) {
					  textNodes.push(node);
				}
			} else {
				//don't parse special node's 
				if ( (node.nodeName !== '#comment') && (node.nodeName !== 'SCRIPT') && (node.nodeName !== 'STYLE') ) {
				  for ( i = 0, len = node.childNodes.length; i < len; i += 1 ) {
					getTextNodes(node.childNodes[i]);
				  }
				} else {
				  //console.log('bad node: '+node.nodeName)
				}
			}
		}
		
		getTextNodes(node);
		return textNodes;
	};
	
	utils.matchKeywords = function( s, content ) {
		content = ','+content;
		
		//All terms have to be there
		s = s.replace(',', ' ');
		s = s.replace('+', ' ');
		s = s.replace('   ', ' ');
		s = s.replace('  ', ' ');
		var terms = s.split(' ');
		
		var results = true;
		_.each(terms, function(t){
			if( content.indexOf(',' + t) < 0 ) { //keyword is not there
				results = false;
			}
		});
		
		return results;
	};
	
	// Required, return the module for AMD compliance
	return utils;

});
