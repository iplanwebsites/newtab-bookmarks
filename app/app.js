// Copyright (c) 2012 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

// Search the bookmarks when entering the search keyword.
var log = console.log;
var bkg = chrome.extension.getBackgroundPage();
var app = {};
app.collection = new BookmarkCollection();
var c = app.collection;
/*
Backbone.sync = function Sync() {
    Backbone.ajaxSync.apply(this, arguments);
    return Backbone.localSync.apply(this, arguments);
};*/


//log = bkg.console.log;

$(function() {
  initData(function(){
    initView();
    wireShits();
    
    _.delay(function(){
      app.collection.scheduleHtmlDownload(); //will start fetching HTML content, and indexing it...
    },10000)
    
    
    chrome.omnibox.onInputChanged.addListener( function(str) {
      alert(str);
      });
      /*
      chrome.omnibox.onInputStarted.addListener( function(str) {
        alert(str);
        });*/
    
    
      $('.brand').html('books v8');
    
    
    
  });

  
  
  
});

function initData(cb){
  app.collection.fetch({
    success:function(collection, response){
      if(collection.length < 1){
        console.log('Empty local Collection, fetch Chrome books: ',response);
        app.collection.importChromeBookmarks();
        cb();
      }else{
        console.log('Loading bookmarkss from Localstorage cache: '+ collection.length);
        app.collection.render();
        cb();
      }
    },
    error:function(collection, response){
      console.log('Error in fetching Collection: ',response);
      app.collection.importChromeBookmarks();
      cb();
    }
  });
  
  //app.collection.importChromeBookmarks();
  
  /*OLd*/
 // dumpBookmarks();
}
function initView(){
  
  app.ui = new UiView({el: $("body")});
  
  
}




function matchKeywords(s, content){
  
  
  content = ','+content;
  //All terms have to be there
  s = s.replace(',', ' ');
  s = s.replace('+', ' ');
  s = s.replace('   ', ' ');
  s = s.replace('  ', ' ');
  var terms = s.split(' ');
  
  var results = true;
  _.each(terms, function(t){
    if(content.indexOf(','+t) == -1){ //keyword is not there
      results = false;
    }
  });
  return results;
}


function wireShits(){
  
  //wire .viewmode buttons
  $('.viewmode .btn').click(function(ev){
    $('body').toggleClass('grid'); 
    //TODO: refactor properly
    //TODO: scroll to TOP
  })
  
  //wire search
  $('#search').bind('keyup change', _.throttle(function(ev) {
     var s = $('#search').val();
     s = s.toLowerCase();
     console.log(s);
     app.ui.search(s);
  }, 100)); //100: throttle the input search
  
  //wire zoom slider
  $('#zoom_level').change(function(){
		var val = $(this).val();
		console.log('zoom now set to:'+val);
		var className = 'zoom' + val;
		$('body').removeClass('zoom1 zoom2 zoom3 zoom4 zoom5 zoom6 zoom7 zoom8 zoom9 zoom10 zoom11 zoom12')
		$('body').addClass(className);
		sammy.cookie.set('zoom_level', val); //TODO: use native or jqeury cookie??
	});
 
 
 $('.html-download .stop').click(function(ev){
   app.collection.stopDownload();
 })
 
 
  
  
}




/*
// Traverse the bookmark tree, and print the folder and nodes.
function dumpBookmarks(query) {
  var bookmarkTreeNodes = chrome.bookmarks.getTree(
    function(bookmarkTreeNodes) {
      //log(bookmarkTreeNodes);
     // var bkg = chrome.extension.getBackgroundPage();
       console.log(bookmarkTreeNodes);
      $('#bookmarks').append(dumpTreeNodes(bookmarkTreeNodes, query));
    });
}
function dumpTreeNodes(bookmarkNodes, query) {
  var list = $('<ul>');
  var i;
  for (i = 0; i < bookmarkNodes.length; i++) {
    list.append(dumpNode(bookmarkNodes[i], query)); //recusrsive parsing?
  }
  return list;
}
function dumpNode(bookmarkNode, query) {
  if (bookmarkNode.title) {
    if (query && !bookmarkNode.children) {
      if (String(bookmarkNode.title).indexOf(query) == -1) {
        return $('<span></span>');
      }
    }
    var anchor = $('<a>');
    anchor.attr('href', bookmarkNode.url);
    anchor.text(bookmarkNode.title);
    /*
     * When clicking on a bookmark in the extension, a new tab is fired with
     * the bookmark url.
     */
   /* anchor.click(function() {
      chrome.tabs.create({url: bookmarkNode.url});
    });*/
    /*
    var span = $('<span>');
    var options = bookmarkNode.children ?
      $('<span>[<a href="#" id="addlink">Add</a>]</span>') :
      $('<span>[<a id="editlink" href="#">Edit</a> <a id="deletelink" ' +
        'href="#">Delete</a>]</span>');
    var edit = bookmarkNode.children ? $('<table><tr><td>Name</td><td>' +
      '<input id="title"></td></tr><tr><td>URL</td><td><input id="url">' +
      '</td></tr></table>') : $('<input>');
    // Show add and edit links when hover over.
        span.hover(function() {
        span.append(options);
        $('#deletelink').click(function() {
          $('#deletedialog').empty().dialog({
                 autoOpen: false,
                 title: 'Confirm Deletion',
                 resizable: false,
                 height: 140,
                 modal: true,
                 overlay: {
                   backgroundColor: '#000',
                   opacity: 0.5
                 },
                 buttons: {
                   'Yes, Delete It!': function() {
                      chrome.bookmarks.remove(String(bookmarkNode.id));
                      span.parent().remove();
                      $(this).dialog('destroy');
                    },
                    Cancel: function() {
                      $(this).dialog('destroy');
                    }
                 }
               }).dialog('open');
         });
        $('#addlink').click(function() {
          $('#adddialog').empty().append(edit).dialog({autoOpen: false,
            closeOnEscape: true, title: 'Add New Bookmark', modal: true,
            buttons: {
            'Add' : function() {
               chrome.bookmarks.create({parentId: bookmarkNode.id,
                 title: $('#title').val(), url: $('#url').val()});
               $('#bookmarks').empty();
               $(this).dialog('destroy');
               window.dumpBookmarks();
             },
            'Cancel': function() {
               $(this).dialog('destroy');
            }
          }}).dialog('open');
        });
        $('#editlink').click(function() {
         edit.val(anchor.text());
         $('#editdialog').empty().append(edit).dialog({autoOpen: false,
           closeOnEscape: true, title: 'Edit Title', modal: true,
           show: 'slide', buttons: {
              'Save': function() {
                 chrome.bookmarks.update(String(bookmarkNode.id), {
                   title: edit.val()
                 });
                 anchor.text(edit.val());
                 options.show();
                 $(this).dialog('destroy');
              },
             'Cancel': function() {
                 $(this).dialog('destroy');
             }
         }}).dialog('open');
        });
        options.fadeIn();
      },
      // unhover
      function() {
        options.remove();
      }).append(anchor);
  }
  var li = $(bookmarkNode.title ? '<li>' : '<div>').append(span);
  if (bookmarkNode.children && bookmarkNode.children.length > 0) {
    li.append(dumpTreeNodes(bookmarkNode.children, query));
  }
  return li;
}*/
/*
document.addEventListener('DOMContentLoaded', function () {
  
});*/
