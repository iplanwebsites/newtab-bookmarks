newtab-bookmarks
================

Chrome extension replacing the default startpage with your bookmarks.


Features (done)
=========================
- Indexing page text to better search bookmarks ( curl/jqeury-get, cached locally, throttle the process..., output the status in the footer(indexing websites 14/268 ))
- Use a bookmark model (OOP)
- Persist the bookmark collection locally (localStorage)
- Website thumbnail: Integrate an ugly API service (easy solution)
- Better search function: (case insensitive search in url + title + body)
- Add domain filters (See all links from a given site)
- properly handle the search field events (keyup, focus, blur)
- compile a favicon main colors (based on domain names)



TODO
=========================

- Sync the bookmarks to a server (so we know how many users has bookmarked the same sites)
- Url classifications (ie. a person website, a media, an open source-projet)
- Import from delicious user feed (importer)
- add a x icon to the search
- Import URls from Freebase database

