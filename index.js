var phantom = require('node-phantom-simple');
var Q = require('q');
var _ = require('lodash');

var state = {
    debug: false,
    quiet: false,
    queue: [],
    visited: [],
    usedSelectors: [],
    unusedSelectors: [],
    errorSelectors: []
};

function createPage(error, page, browser, url, baseUrl, deferred) {
    
    if(error) {
        deferred.reject(error);
    }

    
    /**
     * Function for crawling this page for css selectors
     * @param  {[type]} error  [description]
     * @param  {[type]} status [description]
     * @return {[type]}        [description]
     */
    function onPageOpen(error, status) {

        if(error) {
            deferred.reject(error);
        }

        page.evaluate(getLocalLinks, function(error, links) {
            
            if(error) {
                deferred.reject(error);
            }

            var thisPageDone = Q.defer();
            // var allDone = [thisPageDone.promise];

            //analyze this page
            page.evaluate(getCssSelectors, function(error, selectors) {

                if(error) {
                    deferred.reject(error);
                }
                
                state.usedSelectors = _.union(state.usedSelectors, selectors.used);
                state.unusedSelectors = _.difference(_.union(state.unusedSelectors, selectors.unused), state.usedSelectors);
                state.errorSelectors = _.union(state.errorSelectors, selectors.errors);

                thisPageDone.resolve();

            }, state.usedSelectors);

            var linksToVisit = _.difference(links, state.visited, state.queue);
            // state.debug && console.log('New links found', linksToVisit)
            //get all linked pages not previously visited and analyze them
            for(var i = linksToVisit.length; i--;) {
                var link = linksToVisit[i];
                // state.debug && console.log('Enqueuing', link);
                // (function(link) {
                    // var pageDone = Q.defer();
                    state.queue.push(link)
                    // allDone.push(pageDone.promise);
                    //TODO: limit number of open pages, use a queue and get the urls from there instead of doing this
                    // setTimeout(function() {
                    //     browser.createPage(function(error, page) { createPage(error, page, browser, link, baseUrl, pageDone); });
                    // }, 0);
                // })(linksToVisit[i]);                
            }
            
            //when this page and all its linked pages have been analyzed, we tell the caller we're done
            thisPageDone.promise.then(function() {
                deferred.resolve();
            });

        }, baseUrl);

    };
    
    state.debug && console.log('Opening page', url);
    return page.open(url, onPageOpen);
}

function getCssSelectors(used) {
    var stylesheet, 
        cssRule, 
        //selectors
        temp, 
        unused = [],
        err = [],
        curr;
    for(var iss = document.styleSheets.length; iss--;) {
        stylesheet = document.styleSheets[iss];
        if(stylesheet.cssRules) {
            for(var ir = stylesheet.cssRules.length; ir--;) {
                cssRule = stylesheet.cssRules[ir];
                if(cssRule.selectorText) {
                    temp = cssRule.selectorText.split(',').map(function(sel) { return sel.trim(); });
                    for(var is = temp.length; is--;) {
                        curr = temp[is];
                        if(used.indexOf(curr) < 0) {
                            //not in use on other page
                            //check if in use on this page
                            //if so, add to used, if not add to unused
                            try {
                                if(document.querySelector(curr)) {
                                    used.push(curr)
                                } else if(unused.indexOf(curr) < 0) {
                                    unused.push(curr)
                                }
                            } catch(ex) {
                                if(err.indexOf(curr) < 0) {
                                    err.push((curr))
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    return { 
        used: used, 
        unused: unused,
        errors: err
    };
}

/**
 * Get a list of local links on page
 * @param  {String} baseUrl Links starting with this will be considered local in addition to links starting with /
 * @return {Array}         List of local URLs on page
 */
function getLocalLinks(baseUrl) {
    return Array.prototype.slice.call(document.querySelectorAll('a[href^="/"], a[href^="' + baseUrl + '"], a:not([href*="://"]):not([href^="mailto:"])'), 0)
        .map(function(a) {
            return a.href.replace(/#.*$/, '');
        });
};


function dequeueAndCrawl(browser, baseUrl, allDone) {
    var url = state.queue.shift();
    // state.debug && console.log('Queue', state.queue);
    if(url) {
        state.visited.push(url);
        var done = Q.defer();
        done.promise.then(function() {
            if(!state.quiet && !state.debug) {
                process.stdout.write('.');  
            }
            setTimeout(function() {
                dequeueAndCrawl(browser, baseUrl, allDone);
            }, 0);
        });
        browser.createPage(function(error, page) {
            createPage(error, page, null, url, baseUrl, done);
        });
    } else {
        if(!state.quiet && !state.debug) {
            process.stdout.write('\n');
        }
        allDone.resolve();
    }
}

function crawlItBaby(options, cb) {
    'use strict';
    phantom.create(function(error, browser) {

        var done = Q.defer();
        done.promise.then(function() {
            //todo: use done() to handle reject
            browser.exit();
            //create report
            cb({
                used: state.usedSelectors,
                unused: state.unusedSelectors,
                errors: state.errorSelectors,
                visited: state.visited
            });
        });

        state.queue.push(options.url);
        dequeueAndCrawl(browser, options.url, done);
        // return browser.createPage(function(error, page) { createPage(error, page, browser, options.url, options.url, done); });
        
    }, {
        phantomPath: require('phantomjs').path,
        // parameters: {
        //     proxy: '127.0.0.1:8888'
        // }
    });
}
module.exports = function(options) {
    'use strict';
    
    if (!'url' in options) throw new Error('No url to analyze');
    state.debug = 'verbose' in options;
    state.quiet = 'quiet' in options;

    var cb = options.done || function(report) {
        console.log(JSON.stringify(report, false, 2));
    };
    
    crawlItBaby(options, cb);
}