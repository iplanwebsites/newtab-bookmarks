function onFacebookLogin() {
                if (!localStorage.accessToken) {
                    chrome.tabs.getAllInWindow(null, function(tabs) {
                      var successURL = 'http://www.facebook.com/connect/login_success.html';
                        for (var i = 0; i < tabs.length; i++) {
                            if (tabs[i].url.indexOf(successURL) == 0) {
                                var params = tabs[i].url.split('#')[1];
                                console.log(params);
                                localStorage.accessToken = params;
                                //chrome.tabs.onUpdated.removeListener(onFacebookLogin);
                                console.log('got tha FB token!!'+params);
                                //TODO: we should close the SUCCESS TAB as well now...
                                return;
                            }
                        }
                    });
                }
            }
            chrome.tabs.onUpdated.addListener(onFacebookLogin);