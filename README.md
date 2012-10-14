newtab-bookmarks
================

Chrome extension replacing the default startpage with your bookmarks.


Features (done)
=========================
- Indexing page text to better search bookmarks ( curl/jqeury-get, cached locally, throttle the process..., output the status in the footer(indexing websites 14/268 ))
- Use a bookmark model (OOP)
- Persist the bookmark collection locally (localStorage)
- Website thumbnail: Integrate an ugly API service (easy solution)
- search function: (case insensitive search in url + title + body)
- Add domain filters (See all links from a given site)
- properly handle the search field events (keyup, focus, blur)
- compile a favicon main colors (based on domain names)
- Lazy load thumb images 
- Save UI preference in a persistent model (zoom, counts, viewMode)
- Import from delicious user feed (importer)
- use main UI object to handle properly the interface controls
- Decent list/grid design (it's ugly)

TODO
=========================
- better search filter function (so the DOM repaint only once)
- do the heavy stuff on the background js page (fetching websites, importing facebook / twitter / delicious links)
- add better filter controle (and search within, currently, the search overrides any filters...)
- find a way to cache thumb images (but only once the tile-server send a good image, not a placeholder)
- z-index bug btween the URL adn the menus
- re(set) the custom style on window resize... throttled
- shadow 1px black shadow on the cog icon.
- check the count of Chrome bookmarks (or delicious), to make sure we got em all on file. If not, import/delete the ones that aren't there already.
- Url classifications (ie. a person website, a media, an open source-projet)
- add a x icon to the search
- Import URls from Freebase database
- Thumbnail server (to replace the crappy APIs?)
- Sync the bookmarks to a server (so we know how many users has bookmarked the same sites)
- Backend (auth, sync, import favs from github, facebook, etc)
