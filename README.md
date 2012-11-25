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
- better search filter function (so the DOM repaint only once)
- ping the tile server for all images that will be required one day (so the server has time to fetch the website thumb, Ignore the response: save bandwith)
- Focus bug with the search field... (seems ok now)
- comparator filter method of the grid (caching of jquery objects to hide/show)
- UI: active state for type and folders. search as well??




TODO
=========================
- speed up attaching using a BIG html STR to append.
- Add a non-active state to the logo (when we activate other filters)
- better handle duplicates, >> use a middle "addUrl function avoind adding existing URL?"
- UI: create modals to link Twitter/Delicious/Facebook (and also add some instructions, and options settings...)
- BUG: the collection count sometimes double up in the Title bar...
- Facebook auth: fire/listen an event when we retrive the Token! (so no refresh is required)
- FB import: show status in an allert at the bottom, especially when it's completed>> 231 websites imported from facebook sucessfully!
- Bug with the parsing of Facebook page's website URL (we need to separate multilnes, multi-urls better... on spaces we split, then we with trim??)
- In the site model, code all the condition (set_content_type) to sort websites types (photo/videos/blogs/pdf/etc)
- bug with default viewmode (list/grid)
- Delete feature for Browser bookmarks (and actually delete it from the browser, maybe a confirm dialog before?)
- Add Pinboard import (Exact same syntax than delicious API): http://feeds.pinboard.in/json/u:bob/?count=5000
- Grid float bug: why do some elements push the next row, and break the grid pattern?
- CSS for the alerts in the footer (thinner)
- make LIST actual <A> links that we can ctrl click (no on click events...)
- Google Auth (and fetch ALL youtube favorites, and more...)
- UI tooltips: improve placement + color
- do the heavy stuff on the background-js page (fetching websites, importing facebook / twitter / delicious links)
- add better filter controle (and search within, currently, the search overrides any filters...)
- find a way to cache thumb images (but only once the tile-server send a good image, not the placeholder)
- z-index bug between the URL and the menus:buggy...
- re(set) the custom style on window resize... throttled
- shadow 1px black shadow on the cog icon.
- check the count of Chrome bookmarks (or delicious), to make sure we got em all on file. If not, import/delete the ones that aren't there already.
- Url classifications (ie. a person website, a media, an open source-projet). Is Open Calay a good engine???
- add a x icon to the search
- bt search: keep the focus on the input. (now it blurs it)
- Import URls from Freebase database
- Thumbnail server (to replace the crappy APIs?)
- Thumb server: mirror lots of subdomains, so we can max out the number of concurent download/pings
- thumb server ping: make this task happen in the background.js.
- Sync the bookmarks to a server (so we know how many users has bookmarked the same sites)
- Backend (auth, sync, import favs from github, facebook, etc)
- Code clean: Make modular importer objects for the different services.
- Feature idea: pin website (for speedial-like feature)
- discovery options (website suggestions?)



DMOZ data structure
========================
**We have an output JSON from DMOZ with 1gb of these records (one per line):**

{"topic": "Top/Arts/Animation/Anime/Fandom/Fan_Subtitled/Web_Rings", "d:Description": "Open to actively trading website owners.", "d:Title": "The Fansub Traders Web Ring", "url": "http://d.webring.com/hub?index&ring=fansub_traders"}



Liscence
=========================
(c) iplanwebsites.com
