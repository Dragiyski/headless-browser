# Headless Browser

This browser can be used for scrapping web pages. It is a programmable web browser, that simulate the activity of an 
actual web browser by combining multiple components that work together.

The core the headless browser is the JSDOM. The JSDOM parses XML and HTML documents and returns a DOM three. The HTML 
documents include large number of APIs modern browser support. JSDOM also handles resources like frames, CSS,
JavaScript. However, JSDOM does not handle the network - as the name suggest, the functionality ends with creating the 
DOM tree and HTML API.

This browser builts on that and uses tough-cookie package to handle cookies properly. It also allow partial loading of 
resource based on URL matching.

This browser operates in two scopes: browser scope and tab scope. The browser scope is "global" in terms of cookie 
storage and cache (not implemented, yet), while tab handles a single page. The tab keep the page for further 
processing, as either web-page script or nodejs backend might request page change (e.g. form submission, location 
change, link clicking, etc). Alternatively, a free request might be issued, however, that request will not fulfill any 
page change (TODO).

**WARNING:** This web browser execute JSDOM loaded scripts "dangerously". The term dangerously means the web page 
script might take execution control over nodejs execution. In terms of security, it means there is availability issue. 
The web page scripts executes in different contexts from nodejs execution, which guarantees confidentiality and 
integrity. However, all context share a single timer queue. A web page script that makes ``while(1);`` will never enter 
idle state, so it will block not only the web page, but the nodejs script as well. For this reason, it is 
NOT RECOMMENDED to use this package as a part of a web server. A preferrable way is to use ``child_process`` to spawn a 
new nodejs process (even if v8 initialization is slow) then process the web page and use IPC to return data to the 
server process. The IPC can transfer file descriptors like sockets, so IPC can be used to transfer the HTTP(S) response.

# Future

This is version 0.x: it is under rapid development.